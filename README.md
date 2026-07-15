# Agent Explorer Panel

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

## How to Test and Run

1. **Open this project in VS Code:**
   Make sure you are in this folder (`/home/claw/projects/personal/vscode-custom-extension`).

2. **Launch Extension Development Host:**
   - Press **`F5`** (or go to `Run and Debug` in the sidebar and click **Start Debugging**).
   - This opens a new window called **[Extension Development Host]**.

3. **Open a Workspace:**
   - In the new [Extension Development Host] window, open any folder (you can open this same `/home/claw/projects/personal/vscode-custom-extension` folder to test the Git management UI).

4. **Open the Agent Panel:**
   - Look at the Activity Bar on the far left. You should see a Robot icon (`🤖`).
   - Click it to open the **Agent Panel**.
   - You will see the default Git Management and Terminal Sandbox dashboard!

5. **Test AI Agent Dynamic Changes:**
   - With both windows open, edit `.vscode/agent-panel.html` in your main window (or ask me to edit it).
   - Save the file.
   - Watch the panel in the [Extension Development Host] window reload **instantly** with the new content and style!

---

## JavaScript Bridge API (`window.agent`)

The extension automatically injects a script into `.vscode/agent-panel.html` providing a `window.agent` global object:

### 1. `window.agent.exec(command: string): Promise<{ stdout: string, stderr: string }>`
Runs a terminal command in the workspace directory.
```javascript
const result = await agent.exec("git status -s");
console.log(result.stdout);
```

### 2. `window.agent.showNotification(message: string, type?: 'info' | 'warning' | 'error')`
Shows a native VS Code toaster notification.
```javascript
agent.showNotification("Operation completed successfully!");
agent.showNotification("An error occurred!", "error");
```

### 3. `window.agent.showInputBox(options?: object): Promise<string | undefined>`
Opens a VS Code text input prompt.
```javascript
const commitMessage = await agent.showInputBox({
    prompt: "Enter commit message",
    placeHolder: "feat: add new feature"
});
```

### 4. `window.agent.executeVSCodeCommand(commandName: string, args?: any[]): Promise<any>`
Triggers any registered VS Code command.
```javascript
// Open settings
await agent.executeVSCodeCommand("workbench.action.openSettings");
```

### 5. `window.agent.openFile(relativePath: string)`
Opens a file in the active editor pane.
```javascript
agent.openFile("package.json");
```
