# Custom Agent Panel

An AI-agent-customizable sidebar panel for VS Code. This extension renders the contents of `.vscode/agent-panel.html` directly in the VS Code sidebar and reloads it in real-time when the file changes. 

Because AI agents (like Google Antigravity, Claude, etc.) can read and write workspace files, you can tell your AI agent:
> *"Hey, update the agent panel to show a list of our active Docker containers, with start/stop buttons for each."*

And the agent will write the HTML, CSS, and JS to `.vscode/agent-panel.html`, updating your sidebar panel in real-time!

---

## Features
- **Hot Reloading:** Watches `.vscode/agent-panel.html` and automatically reloads the panel when the file is modified.
- **Secure Interaction Bridge:** Injects a `window.agent` interface into your custom HTML to let it securely trigger VS Code actions and run commands.
- **VS Code Theme Aware:** Pre-styled to inherit VS Code colors automatically, but fully customizable with any standard CSS/HTML.

---

## How to Use

1. **Install the Extension:**
   Install the **Custom Agent Panel** extension from the VS Code Marketplace.

2. **Open a Workspace:**
   Open any folder or workspace in VS Code.

3. **Reveal the Panel:**
   - Click the **Explorer** icon in the Activity Bar on the far left (the files/folders icon).
   - Find the **Custom Agent Panel** collapsible section (usually at the bottom of the Explorer sidebar) and click to expand it.
   - Click **Create Default Template** if prompted. You will immediately see the interactive User Guide & API Sandbox!
   - *(Optional)* Drag the "Custom Agent Panel" title header to the Activity Bar on the far left to make it a standalone tab.

4. **Customize Your Sidebar:**
   - Any modifications you make to the `.vscode/agent-panel.html` file in your workspace will reload in the sidebar **instantly** on save!
   - You can edit this file yourself, or ask your AI assistant to update the HTML/CSS/JS for you!

---

## JavaScript Bridge API (`window.agent`)

The extension automatically injects a script into `.vscode/agent-panel.html` providing a `window.agent` global object:

### 1. `window.agent.exec(command: string): Promise<{ stdout: string, stderr: string }>`
Runs a background shell command in the workspace directory.
```javascript
const result = await agent.exec("git status -s");
console.log(result.stdout);
```

### 2. `window.agent.runInTerminal(command: string)`
Spawns a new native, interactive VS Code Terminal instance inside the IDE and executes the command.
```javascript
agent.runInTerminal("npm run dev");
```

### 3. `window.agent.writeFile(relativePath: string, content: string): Promise<void>`
Safely writes a file in the workspace directory (creating nested parent directories if needed) without using command shells.
```javascript
await agent.writeFile(".vscode/notes/log.txt", "Hello World");
```

### 4. `window.agent.showNotification(message: string, type?: 'info' | 'warning' | 'error')`
Shows a native VS Code toaster notification.
```javascript
agent.showNotification("Operation completed successfully!");
agent.showNotification("An error occurred!", "error");
```

### 5. `window.agent.showInputBox(options?: object): Promise<string | undefined>`
Opens a VS Code text input prompt.
```javascript
const commitMessage = await agent.showInputBox({
    prompt: "Enter commit message",
    placeHolder: "feat: add new feature"
});
```

### 6. `window.agent.executeVSCodeCommand(commandName: string, args?: any[]): Promise<any>`
Triggers any registered VS Code command.
```javascript
// Open settings
await agent.executeVSCodeCommand("workbench.action.openSettings");
```

### 7. `window.agent.openFile(relativePath: string)`
Opens a file in the active editor pane.
```javascript
agent.openFile("package.json");
```
