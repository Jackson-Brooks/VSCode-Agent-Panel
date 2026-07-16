import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';

export function activate(context: vscode.ExtensionContext) {
    const provider = new AgentWebviewViewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            AgentWebviewViewProvider.viewType,
            provider
        )
    );

    // Command to manually refresh the webview
    context.subscriptions.push(
        vscode.commands.registerCommand('agent-panel.refresh', async () => {
            await provider.refresh();
        })
    );

    // Command to create a default template
    context.subscriptions.push(
        vscode.commands.registerCommand('agent-panel.openTemplate', async () => {
            await provider.createDefaultTemplate();
        })
    );

    // Automatically refresh and initialize when workspace trust is granted
    context.subscriptions.push(
        vscode.workspace.onDidGrantWorkspaceTrust(async () => {
            await provider.refresh();
        })
    );
}

class AgentWebviewViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'agent-panel-view';
    private _view?: vscode.WebviewView;
    private _watcher?: vscode.FileSystemWatcher;
    
    // Paths to the active files in workspace .vscode/ directory
    private _htmlUri?: vscode.Uri;
    private _stateUri?: vscode.Uri;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                ...(vscode.workspace.workspaceFolders?.map(folder => folder.uri) || [])
            ]
        };

        await this.refresh();
        this.setupWatcher();

        // Listen for messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            try {
                await this.handleMessage(message);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Agent Panel Error: ${err.message}`);
            }
        });

        webviewView.onDidDispose(() => {
            if (this._watcher) {
                this._watcher.dispose();
                this._watcher = undefined;
            }
        });
    }

    public async refresh() {
        await this.initializePathsAndConfigs();
        this.updateWebviewHTML();
    }

    private async initializePathsAndConfigs() {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceRoot) {
            return;
        }

        // Define paths inside the workspace `.vscode` folder
        const vscodeFolderUri = vscode.Uri.joinPath(workspaceRoot, '.vscode');
        this._htmlUri = vscode.Uri.joinPath(vscodeFolderUri, 'agent-panel.html');
        this._stateUri = vscode.Uri.joinPath(vscodeFolderUri, 'agent-panel-state.json');

        // Do not perform file writes in an untrusted workspace
        if (!vscode.workspace.isTrusted) {
            return;
        }

        // Ensure .vscode/ parent directory exists in the workspace
        try {
            await vscode.workspace.fs.createDirectory(vscodeFolderUri);
        } catch (err) {
            // Folder might already exist
        }

        const configUri = vscode.Uri.joinPath(vscodeFolderUri, 'agent-panel-config.json');
        const htmlPath = this._htmlUri.fsPath;
        const statePath = this._stateUri.fsPath;

        const configData = {
            extension: "Custom Agent Panel",
            htmlPath: htmlPath,
            statePath: statePath,
            instructions: "This project uses the Custom Agent Panel VS Code extension. You can customize the user's sidebar UI by editing the HTML file specified in 'htmlPath'. The dimensions are saved in 'statePath'. Read the API documentation in '.vscode/agent-panel-instructions.md' to learn how to interact with VS Code and execute terminal commands from the webview."
        };

        const encoder = new TextEncoder();
        try {
            await vscode.workspace.fs.writeFile(configUri, encoder.encode(JSON.stringify(configData, null, 2)));
        } catch (err) {
            // Ignore config write failures (e.g. read-only folder)
        }

        // If the workspace HTML file doesn't exist yet, write the default template there
        try {
            await vscode.workspace.fs.stat(this._htmlUri);
        } catch {
            const template = await this.getDefaultTemplateHTML();
            await vscode.workspace.fs.writeFile(this._htmlUri, encoder.encode(template));
        }

        // If the workspace instructions file doesn't exist yet, write the template there
        const instructionsUri = vscode.Uri.joinPath(vscodeFolderUri, 'agent-panel-instructions.md');
        try {
            await vscode.workspace.fs.stat(instructionsUri);
        } catch {
            try {
                const instTemplateUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'agent-panel-instructions.md');
                const bytes = await vscode.workspace.fs.readFile(instTemplateUri);
                await vscode.workspace.fs.writeFile(instructionsUri, bytes);
            } catch (err) {
                // Ignore config write failures
            }
        }
    }

    private setupWatcher() {
        if (this._watcher) {
            this._watcher.dispose();
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceRoot || !this._htmlUri) {
            return;
        }

        // Watch the workspace agent-panel.html file using a RelativePattern
        const pattern = new vscode.RelativePattern(workspaceRoot, '.vscode/agent-panel.html');
        this._watcher = vscode.workspace.createFileSystemWatcher(pattern);

        this._watcher.onDidChange(() => this.updateWebviewHTML());
        this._watcher.onDidCreate(() => this.updateWebviewHTML());
        this._watcher.onDidDelete(() => this.updateWebviewHTML());

        // Reinitialize if workspace folders change
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            await this.initializePathsAndConfigs();
            this.setupWatcher();
            this.updateWebviewHTML();
        });
    }

    private async updateWebviewHTML() {
        if (!this._view) {
            return;
        }

        if (!vscode.workspace.isTrusted) {
            this._view.webview.html = this.getUntrustedWorkspaceHTML();
            return;
        }

        if (!this._htmlUri) {
            this._view.webview.html = this.getNoWorkspaceHTML();
            return;
        }

        try {
            try {
                await vscode.workspace.fs.stat(this._htmlUri);
                const fileBytes = await vscode.workspace.fs.readFile(this._htmlUri);
                const rawHtml = new TextDecoder('utf-8').decode(fileBytes);
                this._view.webview.html = this.injectBridgeScript(rawHtml);
            } catch (statError) {
                this._view.webview.html = this.getTemplateRequiredHTML();
            }
        } catch (err: any) {
            this._view.webview.html = this.getErrorHTML(err.message);
        }
    }

    private injectBridgeScript(html: string): string {
        const bridgeScript = `
        <!-- Agent API Bridge -->
        <script>
            (function() {
                const vscode = acquireVsCodeApi();
                const pendingRequests = new Map();
                let requestIdCounter = 0;

                window.agent = {
                    exec(command) {
                        const requestId = requestIdCounter++;
                        return new Promise((resolve, reject) => {
                            pendingRequests.set(requestId, { resolve, reject });
                            vscode.postMessage({ type: 'exec', command, requestId });
                        });
                    },
                    writeFile(relativePath, content) {
                        const requestId = requestIdCounter++;
                        return new Promise((resolve, reject) => {
                            pendingRequests.set(requestId, { resolve, reject });
                            vscode.postMessage({ type: 'writeFile', relativePath, content, requestId });
                        });
                    },
                    showNotification(message, notificationType = 'info') {
                        vscode.postMessage({ type: 'showNotification', message, notificationType });
                    },
                    showInputBox(options = {}) {
                        const requestId = requestIdCounter++;
                        return new Promise((resolve) => {
                            pendingRequests.set(requestId, { resolve });
                            vscode.postMessage({ type: 'showInputBox', options, requestId });
                        });
                    },
                    executeVSCodeCommand(commandName, args = []) {
                        const requestId = requestIdCounter++;
                        return new Promise((resolve, reject) => {
                            pendingRequests.set(requestId, { resolve, reject });
                            vscode.postMessage({ type: 'executeVSCodeCommand', commandName, args, requestId });
                        });
                    },
                    openFile(relativePath) {
                        vscode.postMessage({ type: 'openFile', relativePath });
                    },
                    createTemplate() {
                        vscode.postMessage({ type: 'createTemplate' });
                    },
                    runInTerminal(command) {
                        vscode.postMessage({ type: 'runInTerminal', command });
                    }
                };

                function sendDimensions() {
                    vscode.postMessage({
                        type: 'reportDimensions',
                        width: window.innerWidth,
                        height: window.innerHeight
                    });
                }

                // Send dimensions immediately, on load, and on window resize
                sendDimensions();
                window.addEventListener('resize', sendDimensions);
                window.addEventListener('load', sendDimensions);

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'execResponse': {
                            const req = pendingRequests.get(message.requestId);
                            if (req) {
                                pendingRequests.delete(message.requestId);
                                if (message.error) {
                                    req.reject(new Error(message.error));
                                } else {
                                    req.resolve({ stdout: message.stdout, stderr: message.stderr });
                                }
                            }
                            break;
                        }
                        case 'writeFileResponse': {
                            const req = pendingRequests.get(message.requestId);
                            if (req) {
                                pendingRequests.delete(message.requestId);
                                if (message.error) {
                                    req.reject(new Error(message.error));
                                } else {
                                    req.resolve();
                                }
                            }
                            break;
                        }
                        case 'showInputBoxResponse': {
                            const req = pendingRequests.get(message.requestId);
                            if (req) {
                                pendingRequests.delete(message.requestId);
                                req.resolve(message.value);
                            }
                            break;
                        }
                        case 'executeVSCodeCommandResponse': {
                            const req = pendingRequests.get(message.requestId);
                            if (req) {
                                pendingRequests.delete(message.requestId);
                                if (message.error) {
                                    req.reject(new Error(message.error));
                                } else {
                                    req.resolve(message.result);
                                }
                            }
                            break;
                        }
                    }
                });
            })();
        </script>
        `;

        // Inject script at the start of the head or body, using case-insensitive regex checks
        if (/<head>/i.test(html)) {
            return html.replace(/<head>/i, `<head>${bridgeScript}`);
        } else if (/<body>/i.test(html)) {
            return html.replace(/<body>/i, `<body>${bridgeScript}`);
        } else {
            return bridgeScript + html;
        }
    }

    private async handleMessage(message: any) {
        const view = this._view;
        if (!view) {
            return;
        }

        switch (message.type) {
            case 'reportDimensions': {
                const { width, height } = message;
                if (!vscode.workspace.isTrusted) {
                    break;
                }
                if (this._stateUri) {
                    const stateData = {
                        width,
                        height,
                        lastUpdated: new Date().toISOString()
                    };
                    const encoder = new TextEncoder();
                    try {
                        await vscode.workspace.fs.writeFile(this._stateUri, encoder.encode(JSON.stringify(stateData, null, 2)));
                    } catch (err) {
                        // Ignore errors if state writing fails
                    }
                }
                break;
            }



            case 'exec': {
                const { command, requestId } = message;
                if (!vscode.workspace.isTrusted) {
                    view.webview.postMessage({
                        type: 'execResponse',
                        requestId,
                        error: 'Executing commands is disabled in untrusted workspaces.'
                    });
                    return;
                }
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
                if (!workspaceRoot) {
                    view.webview.postMessage({
                        type: 'execResponse',
                        requestId,
                        error: 'No workspace folder is open.'
                    });
                    return;
                }

                if (!cp || typeof cp.exec !== 'function') {
                    view.webview.postMessage({
                        type: 'execResponse',
                        requestId,
                        error: 'Terminal command execution (child_process) is not supported in this environment.'
                    });
                    return;
                }

                const fsPath = workspaceRoot.fsPath;
                if (!fsPath) {
                    view.webview.postMessage({
                        type: 'execResponse',
                        requestId,
                        error: 'Workspace is not stored on a local or remote accessible filesystem.'
                    });
                    return;
                }

                // Added timeout (60s) and maxBuffer (10MB) limit for execution safety
                cp.exec(command, { cwd: fsPath, timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                    view.webview.postMessage({
                        type: 'execResponse',
                        requestId,
                        error: error ? error.message : null,
                        stdout,
                        stderr
                    });
                });
                break;
            }

            case 'writeFile': {
                const { relativePath, content, requestId } = message;
                if (!vscode.workspace.isTrusted) {
                    view.webview.postMessage({
                        type: 'writeFileResponse',
                        requestId,
                        error: 'Writing files is disabled in untrusted workspaces.'
                    });
                    break;
                }
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
                if (!workspaceRoot) {
                    view.webview.postMessage({
                        type: 'writeFileResponse',
                        requestId,
                        error: 'No workspace folder is open.'
                    });
                    break;
                }
                const fileUri = vscode.Uri.joinPath(workspaceRoot, relativePath);
                
                // Security check: prevent path traversal outside workspace
                const resolvedPath = fileUri.fsPath;
                const rootPath = workspaceRoot.fsPath;
                const relative = path.relative(rootPath, resolvedPath);
                if (relative.startsWith('..') || path.isAbsolute(relative)) {
                    view.webview.postMessage({
                        type: 'writeFileResponse',
                        requestId,
                        error: 'Path traversal detected. File path must be within the workspace folder.'
                    });
                    break;
                }
                try {
                    const encoder = new TextEncoder();
                    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(resolvedPath)));
                    await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));
                    view.webview.postMessage({
                        type: 'writeFileResponse',
                        requestId
                    });
                } catch (err: any) {
                    view.webview.postMessage({
                        type: 'writeFileResponse',
                        requestId,
                        error: err.message
                    });
                }
                break;
            }

            case 'runInTerminal': {
                const { command } = message;
                if (!vscode.workspace.isTrusted) {
                    vscode.window.showErrorMessage('Running terminal commands is disabled in untrusted workspaces.');
                    break;
                }
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceRoot) {
                    return;
                }
                const terminal = vscode.window.createTerminal({
                    name: 'Agent Terminal',
                    cwd: workspaceRoot.uri.fsPath
                });
                terminal.show();
                terminal.sendText(command);
                break;
            }

            case 'showNotification': {
                const { message: msgText, notificationType } = message;
                if (notificationType === 'error') {
                    vscode.window.showErrorMessage(msgText);
                } else if (notificationType === 'warning') {
                    vscode.window.showWarningMessage(msgText);
                } else {
                    vscode.window.showInformationMessage(msgText);
                }
                break;
            }

            case 'showInputBox': {
                const { options, requestId } = message;
                const value = await vscode.window.showInputBox(options);
                view.webview.postMessage({
                    type: 'showInputBoxResponse',
                    requestId,
                    value
                });
                break;
            }

            case 'executeVSCodeCommand': {
                const { commandName, args, requestId } = message;
                if (!vscode.workspace.isTrusted) {
                    view.webview.postMessage({
                        type: 'executeVSCodeCommandResponse',
                        requestId,
                        error: 'Executing commands is disabled in untrusted workspaces.'
                    });
                    break;
                }
                try {
                    const result = await vscode.commands.executeCommand(commandName, ...(args || []));
                    view.webview.postMessage({
                        type: 'executeVSCodeCommandResponse',
                        requestId,
                        result
                    });
                } catch (err: any) {
                    view.webview.postMessage({
                        type: 'executeVSCodeCommandResponse',
                        requestId,
                        error: err.message
                    });
                }
                break;
            }

            case 'openFile': {
                const { relativePath } = message;
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
                if (!workspaceRoot) {
                    return;
                }
                const fileUri = vscode.Uri.joinPath(workspaceRoot, relativePath);
                
                // Security check: prevent path traversal outside workspace
                const resolvedPath = fileUri.fsPath;
                const rootPath = workspaceRoot.fsPath;
                const relative = path.relative(rootPath, resolvedPath);
                if (relative.startsWith('..') || path.isAbsolute(relative)) {
                    vscode.window.showErrorMessage('Path traversal detected. Cannot open files outside the workspace folder.');
                    break;
                }
                try {
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    await vscode.window.showTextDocument(doc);
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to open file: ${err.message}`);
                }
                break;
            }

            case 'createTemplate': {
                if (!vscode.workspace.isTrusted) {
                    vscode.window.showErrorMessage('Creating templates is disabled in untrusted workspaces.');
                    break;
                }
                await this.createDefaultTemplate();
                break;
            }
        }
    }



    public async createDefaultTemplate() {
        if (!vscode.workspace.isTrusted) {
            vscode.window.showErrorMessage('Creating templates is disabled in untrusted workspaces.');
            return;
        }
        if (!this._htmlUri) {
            vscode.window.showErrorMessage('Please open a workspace before creating the template.');
            return;
        }

        try {
            await vscode.workspace.fs.stat(this._htmlUri);
            const openChoice = await vscode.window.showWarningMessage(
                'Custom agent HTML already exists. Do you want to overwrite it?',
                'Yes',
                'No'
            );
            if (openChoice !== 'Yes') {
                return;
            }
        } catch {
            // File does not exist, proceed to write
        }

        const template = await this.getDefaultTemplateHTML();
        const encoder = new TextEncoder();
        try {
            await vscode.workspace.fs.writeFile(this._htmlUri, encoder.encode(template));
            vscode.window.showInformationMessage('Created default template in your workspace (.vscode/agent-panel.html)!');
            this.updateWebviewHTML();
        } catch (writeErr: any) {
            vscode.window.showErrorMessage(`Failed to write template: ${writeErr.message}`);
        }
    }

    private getNoWorkspaceHTML(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <style>
                    body {
                        font-family: var(--vscode-font-family, sans-serif);
                        padding: 20px;
                        color: var(--vscode-sideBar-foreground);
                        background-color: var(--vscode-sideBar-background);
                        text-align: center;
                    }
                    h3 { color: var(--vscode-editorWarning-foreground); }
                </style>
            </head>
            <body>
                <h3>No Workspace Open</h3>
                <p>Please open a workspace folder to use the Custom Agent Panel.</p>
            </body>
            </html>
        `;
    }

    private getUntrustedWorkspaceHTML(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <style>
                    body {
                        font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
                        padding: 24px;
                        color: var(--vscode-sideBar-foreground, #cccccc);
                        background-color: var(--vscode-sideBar-background, #1e1e1e);
                        line-height: 1.5;
                        text-align: center;
                    }
                    .container {
                        border: 1px dashed var(--vscode-errorForeground, #f48771);
                        border-radius: 8px;
                        padding: 20px;
                        background: rgba(244, 135, 113, 0.05);
                        margin: 20px auto;
                        max-width: 320px;
                    }
                    .icon {
                        font-size: 40px;
                        margin-bottom: 12px;
                    }
                    h3 {
                        margin-top: 0;
                        color: var(--vscode-errorForeground, #f48771);
                        font-size: 14px;
                    }
                    p {
                        font-size: 12px;
                        opacity: 0.9;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="icon">🔒</div>
                    <h3>Workspace Not Trusted</h3>
                    <p>
                        Loading custom HTML panels is disabled in untrusted workspaces for security.
                        Please trust this workspace to enable the Agent Panel.
                    </p>
                </div>
            </body>
            </html>
        `;
    }

    private getTemplateRequiredHTML(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <style>
                    body {
                        font-family: var(--vscode-font-family, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif);
                        padding: 24px;
                        color: var(--vscode-sideBar-foreground, #cccccc);
                        background-color: var(--vscode-sideBar-background, #1e1e1e);
                        line-height: 1.5;
                    }
                    .container {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        text-align: center;
                        border: 1px dashed var(--vscode-focusBorder, #007acc);
                        border-radius: 8px;
                        padding: 20px;
                        background: rgba(255, 255, 255, 0.02);
                    }
                    .icon {
                        font-size: 40px;
                        margin-bottom: 12px;
                        animation: bounce 2s infinite ease-in-out;
                    }
                    h3 {
                        margin-top: 0;
                        color: var(--vscode-foreground, #ffffff);
                        font-size: 16px;
                    }
                    p {
                        font-size: 13px;
                        margin-bottom: 20px;
                        opacity: 0.8;
                    }
                    button {
                        background-color: var(--vscode-button-background, #007acc);
                        color: var(--vscode-button-foreground, #ffffff);
                        border: none;
                        padding: 8px 16px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: 500;
                        font-size: 13px;
                        transition: background-color 0.2s ease;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground, #0062a3);
                    }
                    @keyframes bounce {
                        0%, 100% { transform: translateY(0); }
                        50% { transform: translateY(-6px); }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="icon">🤖</div>
                    <h3>Setup Panel HTML</h3>
                    <p>
                        The custom panel HTML was not found. Please click below to generate a default template.
                    </p>
                    <button onclick="agent.createTemplate()">Create Default Template</button>
                </div>
            </body>
            </html>
        `;
    }

    private getErrorHTML(error: string): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <style>
                    body {
                        font-family: var(--vscode-font-family, sans-serif);
                        padding: 16px;
                        color: var(--vscode-errorForeground, #ff3333);
                        background-color: var(--vscode-sideBar-background);
                    }
                    pre {
                        background: rgba(255, 0, 0, 0.1);
                        padding: 12px;
                        border-radius: 4px;
                        white-space: pre-wrap;
                        font-family: var(--vscode-editor-font-family, monospace);
                        font-size: 12px;
                    }
                </style>
            </head>
            <body>
                <h3>Error loading panel</h3>
                <pre>${error}</pre>
            </body>
            </html>
        `;
    }

    private async getDefaultTemplateHTML(): Promise<string> {
        try {
            const templateUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'default.html');
            const fileBytes = await vscode.workspace.fs.readFile(templateUri);
            return new TextDecoder('utf-8').decode(fileBytes);
        } catch (err: any) {
            return `
                <!DOCTYPE html>
                <html>
                <body>
                    <h3>Failed to load default template</h3>
                    <p>${err.message}</p>
                </body>
                </html>
            `;
        }
    }
}
