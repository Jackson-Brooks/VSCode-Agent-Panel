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
        vscode.commands.registerCommand('agent-panel.refresh', () => {
            provider.refresh();
        })
    );

    // Command to create a default template
    context.subscriptions.push(
        vscode.commands.registerCommand('agent-panel.openTemplate', async () => {
            await provider.createDefaultTemplate();
        })
    );
}

class AgentWebviewViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'agent-panel-view';
    private _view?: vscode.WebviewView;
    private _watcher?: vscode.FileSystemWatcher;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
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

        this.setupWatcher();
        this.updateWebviewHTML();

        // Listen for messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            try {
                await this.handleMessage(message);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Agent Panel Error: ${err.message}`);
            }
        });
    }

    public refresh() {
        this.updateWebviewHTML();
    }

    private setupWatcher() {
        if (this._watcher) {
            this._watcher.dispose();
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceRoot) {
            return;
        }

        // Watch for changes to .vscode/agent-panel.html
        const pattern = new vscode.RelativePattern(workspaceRoot, '.vscode/agent-panel.html');
        this._watcher = vscode.workspace.createFileSystemWatcher(pattern);

        this._watcher.onDidChange(() => this.updateWebviewHTML());
        this._watcher.onDidCreate(() => this.updateWebviewHTML());
        this._watcher.onDidDelete(() => this.updateWebviewHTML());

        // Watch for workspace folder changes to reinitialize the watcher if needed
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.setupWatcher();
            this.updateWebviewHTML();
        });
    }

    private getPanelFileUri(): vscode.Uri | undefined {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceRoot) {
            return undefined;
        }
        return vscode.Uri.joinPath(workspaceRoot, '.vscode', 'agent-panel.html');
    }

    private async updateWebviewHTML() {
        if (!this._view) {
            return;
        }

        const fileUri = this.getPanelFileUri();
        if (!fileUri) {
            this._view.webview.html = this.getNoWorkspaceHTML();
            return;
        }

        try {
            // Check if file exists using VS Code's workspace FS API (compatible with code-server & web)
            try {
                await vscode.workspace.fs.stat(fileUri);
                const fileBytes = await vscode.workspace.fs.readFile(fileUri);
                const rawHtml = new TextDecoder('utf-8').decode(fileBytes);
                this._view.webview.html = this.injectBridgeScript(rawHtml);
            } catch (statError) {
                // File does not exist, show template setup button
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
                    }
                };

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

        // Inject script at the start of the head or body, or pre-pend if not found
        if (html.includes('<head>')) {
            return html.replace('<head>', `<head>${bridgeScript}`);
        } else if (html.includes('<body>')) {
            return html.replace('<body>', `<body>${bridgeScript}`);
        } else {
            return bridgeScript + html;
        }
    }

    private async handleMessage(message: any) {
        if (!this._view) {
            return;
        }

        switch (message.type) {
            case 'exec': {
                const { command, requestId } = message;
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
                if (!workspaceRoot) {
                    this._view.webview.postMessage({
                        type: 'execResponse',
                        requestId,
                        error: 'No workspace folder is open.'
                    });
                    return;
                }

                // Graceful check for non-Node environments (like pure Web worker hosts)
                if (!cp || typeof cp.exec !== 'function') {
                    this._view.webview.postMessage({
                        type: 'execResponse',
                        requestId,
                        error: 'Terminal command execution (child_process) is not supported in this environment.'
                    });
                    return;
                }

                // If running in a virtual filesystem (e.g. vscode.dev with virtual resources), fsPath might be empty or invalid.
                const fsPath = workspaceRoot.fsPath;
                if (!fsPath) {
                    this._view.webview.postMessage({
                        type: 'execResponse',
                        requestId,
                        error: 'Workspace is not stored on a local or remote accessible filesystem.'
                    });
                    return;
                }

                cp.exec(command, { cwd: fsPath }, (error, stdout, stderr) => {
                    this._view.webview.postMessage({
                        type: 'execResponse',
                        requestId,
                        error: error ? error.message : null,
                        stdout,
                        stderr
                    });
                });
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
                this._view.webview.postMessage({
                    type: 'showInputBoxResponse',
                    requestId,
                    value
                });
                break;
            }

            case 'executeVSCodeCommand': {
                const { commandName, args, requestId } = message;
                try {
                    const result = await vscode.commands.executeCommand(commandName, ...(args || []));
                    this._view.webview.postMessage({
                        type: 'executeVSCodeCommandResponse',
                        requestId,
                        result
                    });
                } catch (err: any) {
                    this._view.webview.postMessage({
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
                try {
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    await vscode.window.showTextDocument(doc);
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to open file: ${err.message}`);
                }
                break;
            }

            case 'createTemplate': {
                await this.createDefaultTemplate();
                break;
            }
        }
    }

    public async createDefaultTemplate() {
        const fileUri = this.getPanelFileUri();
        if (!fileUri) {
            vscode.window.showErrorMessage('Please open a workspace before creating the template.');
            return;
        }

        try {
            await vscode.workspace.fs.stat(fileUri);
            const openChoice = await vscode.window.showWarningMessage(
                '.vscode/agent-panel.html already exists. Do you want to overwrite it?',
                'Yes',
                'No'
            );
            if (openChoice !== 'Yes') {
                const doc = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(doc);
                return;
            }
        } catch {
            // File does not exist, proceed to write
        }

        const template = this.getDefaultTemplateHTML();
        const encoder = new TextEncoder();
        try {
            await vscode.workspace.fs.writeFile(fileUri, encoder.encode(template));
            vscode.window.showInformationMessage('Created default template in .vscode/agent-panel.html!');
            
            const doc = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(doc);
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
                <p>Please open a workspace folder to use the Agent Explorer Panel.</p>
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
                    code {
                        background: rgba(0, 0, 0, 0.3);
                        padding: 2px 4px;
                        border-radius: 4px;
                        font-family: var(--vscode-editor-font-family, monospace);
                        font-size: 12px;
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
                        This view displays the contents of <code>.vscode/agent-panel.html</code>.
                        Create this file in your project or generate a default one to begin.
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

    private getDefaultTemplateHTML(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agent Panel</title>
    <style>
        :root {
            --primary: #4f46e5;
            --primary-hover: #4338ca;
            --bg-glass: rgba(255, 255, 255, 0.03);
            --border-glass: rgba(255, 255, 255, 0.08);
            --transition-speed: 0.25s;
        }

        body {
            font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
            padding: 16px;
            color: var(--vscode-sideBar-foreground, #cccccc);
            background-color: var(--vscode-sideBar-background, #1e1e1e);
            margin: 0;
            user-select: none;
            overflow-x: hidden;
        }

        /* Sleek Modern Header */
        .header {
            position: relative;
            padding: 16px;
            background: linear-gradient(135deg, rgba(79, 70, 229, 0.15) 0%, rgba(147, 51, 234, 0.05) 100%);
            border: 1px solid var(--border-glass);
            border-radius: 12px;
            margin-bottom: 20px;
            overflow: hidden;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .header::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle, rgba(99, 102, 241, 0.1) 0%, transparent 60%);
            pointer-events: none;
        }

        .avatar-container {
            position: relative;
            width: 42px;
            height: 42px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 50%;
            box-shadow: 0 0 15px rgba(79, 70, 229, 0.2);
        }

        .avatar {
            font-size: 24px;
            animation: pulse 3s infinite ease-in-out;
        }

        .title-area {
            flex-grow: 1;
        }

        .title-area h2 {
            margin: 0;
            font-size: 15px;
            font-weight: 600;
            color: var(--vscode-foreground, #ffffff);
            letter-spacing: 0.5px;
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 10px;
            padding: 2px 8px;
            background: rgba(34, 197, 94, 0.15);
            color: #4ade80;
            border-radius: 9999px;
            margin-top: 4px;
            font-weight: 500;
        }

        .status-dot {
            width: 6px;
            height: 6px;
            background-color: #22c55e;
            border-radius: 50%;
            animation: blink 1.5s infinite ease-in-out;
        }

        /* Section Styling */
        .section {
            background: var(--bg-glass);
            border: 1px solid var(--border-glass);
            border-radius: 12px;
            padding: 14px;
            margin-bottom: 16px;
            transition: border-color var(--transition-speed);
        }

        .section:hover {
            border-color: rgba(99, 102, 241, 0.3);
        }

        .section-title {
            margin-top: 0;
            margin-bottom: 12px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--vscode-foreground, #ffffff);
            opacity: 0.85;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        /* Custom Interactive Elements */
        .btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            background-color: var(--vscode-button-background, var(--primary));
            color: var(--vscode-button-foreground, #ffffff);
            border: none;
            padding: 10px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 500;
            font-size: 12px;
            transition: all var(--transition-speed) cubic-bezier(0.4, 0, 0.2, 1);
            margin-bottom: 8px;
        }

        .btn:hover {
            background-color: var(--vscode-button-hoverBackground, var(--primary-hover));
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
        }

        .btn:active {
            transform: translateY(0);
        }

        .btn-secondary {
            background-color: rgba(255, 255, 255, 0.05);
            color: var(--vscode-foreground, #ffffff);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .btn-secondary:hover {
            background-color: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.2);
            box-shadow: none;
        }

        .input-group {
            margin-bottom: 12px;
        }

        .input-group label {
            display: block;
            font-size: 11px;
            margin-bottom: 6px;
            opacity: 0.8;
        }

        input[type="text"], textarea {
            width: 100%;
            box-sizing: border-box;
            background-color: var(--vscode-input-background, #252526);
            color: var(--vscode-input-foreground, #cccccc);
            border: 1px solid var(--vscode-input-border, rgba(255, 255, 255, 0.1));
            padding: 8px 10px;
            border-radius: 6px;
            font-family: inherit;
            font-size: 12px;
            transition: border-color var(--transition-speed);
        }

        input[type="text"]:focus, textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder, var(--primary));
        }

        textarea {
            resize: vertical;
            min-height: 50px;
        }

        /* Terminal Console Sandbox */
        .terminal-box {
            background: #0f0f11;
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            padding: 10px;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 11px;
            max-height: 120px;
            overflow-y: auto;
            white-space: pre-wrap;
            color: #38bdf8;
            margin-top: 10px;
        }

        .terminal-box.error {
            color: #f87171;
        }

        .terminal-box.empty {
            color: #6b7280;
            font-style: italic;
        }

        .badge-list {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 12px;
        }

        .badge {
            background: rgba(255, 255, 255, 0.05);
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-family: var(--vscode-editor-font-family, monospace);
        }

        /* Animations */
        @keyframes pulse {
            0%, 100% { transform: scale(1); filter: drop-shadow(0 0 2px rgba(99, 102, 241, 0.5)); }
            50% { transform: scale(1.08); filter: drop-shadow(0 0 10px rgba(99, 102, 241, 0.8)); }
        }

        @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }

        /* Scrollbar styling */
        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }
        ::-webkit-scrollbar-track {
            background: transparent;
        }
        ::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.2);
        }
    </style>
</head>
<body>

    <!-- Header Section -->
    <div class="header">
        <div class="avatar-container">
            <div class="avatar">🤖</div>
        </div>
        <div class="title-area">
            <h2>Agent Sandbox Panel</h2>
            <div class="status-badge">
                <span class="status-dot"></span>
                <span>Active & Listening</span>
            </div>
        </div>
    </div>

    <!-- Git Control Section -->
    <div class="section">
        <div class="section-title">📂 Git Management</div>
        
        <div class="input-group">
            <label for="commit-msg">Commit Message</label>
            <textarea id="commit-msg" placeholder="Work in progress..."></textarea>
        </div>

        <button class="btn" id="btn-push">
            🚀 Commit & Push to Main
        </button>
        
        <button class="btn btn-secondary" id="btn-status">
            🔍 Check Git Status
        </button>
    </div>

    <!-- Sandbox Command runner -->
    <div class="section">
        <div class="section-title">💻 Terminal Sandbox</div>
        <div class="input-group" style="display: flex; gap: 6px;">
            <input type="text" id="cmd-input" placeholder="e.g., npm run test" style="flex-grow: 1;">
            <button class="btn" id="btn-run-cmd" style="width: auto; margin: 0; padding: 0 12px;">Run</button>
        </div>
        <div class="terminal-box empty" id="term-output">Output will appear here...</div>
    </div>

    <!-- System Info & Agent Instructions -->
    <div class="section">
        <div class="section-title">ℹ️ System Info</div>
        <div style="font-size: 11px; opacity: 0.8; line-height: 1.4;">
            Modify this UI by asking your AI agent to change <code>.vscode/agent-panel.html</code>.
        </div>
        <div class="badge-list">
            <span class="badge">Ctrl+Shift+P</span>
            <span class="badge">Reload: agent-panel.refresh</span>
        </div>
    </div>

    <script>
        const pushBtn = document.getElementById('btn-push');
        const statusBtn = document.getElementById('btn-status');
        const commitMsg = document.getElementById('commit-msg');
        const cmdInput = document.getElementById('cmd-input');
        const runCmdBtn = document.getElementById('btn-run-cmd');
        const termOutput = document.getElementById('term-output');

        // Helper to output to the screen terminal
        function logTerm(text, isError = false) {
            termOutput.textContent = text;
            termOutput.className = 'terminal-box' + (isError ? ' error' : '') + (text ? '' : ' empty');
        }

        // Git Status Check
        statusBtn.addEventListener('click', async () => {
            logTerm('Running git status...');
            try {
                const res = await agent.exec('git status -s');
                logTerm(res.stdout || 'Workspace clean (no untracked changes).');
                agent.showNotification('Git status checked successfully');
            } catch (err) {
                logTerm(err.message, true);
            }
        });

        // Git Commit & Push
        pushBtn.addEventListener('click', async () => {
            const message = commitMsg.value.trim() || 'Agent auto-commit';
            logTerm('Starting Git workflow...');
            try {
                logTerm('Staging changes...');
                await agent.exec('git add .');
                
                logTerm('Committing changes...');
                const commitRes = await agent.exec('git commit -m "' + message.replace(/"/g, '\\"') + '"');
                
                logTerm('Pushing to main branch...');
                const pushRes = await agent.exec('git push origin main');
                
                logTerm('Successfully committed and pushed!\\n\\n' + commitRes.stdout + '\\n' + pushRes.stdout);
                agent.showNotification('Successfully committed & pushed!');
                commitMsg.value = '';
            } catch (err) {
                logTerm(err.message, true);
                agent.showNotification('Git operation failed: ' + err.message, 'error');
            }
        });

        // Arbitrary Command Runner
        runCmdBtn.addEventListener('click', async () => {
            const cmd = cmdInput.value.trim();
            if (!cmd) return;
            logTerm('Executing: ' + cmd);
            try {
                const res = await agent.exec(cmd);
                logTerm(res.stdout || res.stderr || 'Command executed with no output.');
            } catch (err) {
                logTerm(err.message, true);
            }
        });

        // Support triggering execution when pressing Enter in command input
        cmdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                runCmdBtn.click();
            }
        });
    </script>
</body>
</html>
`;
    }
}
