# Custom Agent Panel: Developer Bridge API Reference

This workspace is integrated with the **Custom Agent Panel** VS Code extension. You can customize the user's sidebar UI by editing the HTML file specified in `.vscode/agent-panel-config.json` (usually `.vscode/agent-panel.html`).

Inside the custom HTML dashboard, the extension automatically injects a global `window.agent` object that acts as a secure bridge to trigger VS Code events, open files, and execute terminal commands.

---

## JavaScript Bridge API (`window.agent`)

### 1. `window.agent.runInTerminal(command: string): void`
Spawns a new native, interactive VS Code Terminal instance inside the IDE and executes the command. Use this for interactive prompts, long-running servers, or commands that require user input.
* **Example**:
  ```javascript
  agent.runInTerminal("npm run dev");
  ```

### 2. `window.agent.exec(command: string): Promise<{ stdout: string, stderr: string }>`
Runs a background shell command in the workspace directory. Backed by a safety timeout of `60 seconds` and a `10MB` buffer limit.
* **Example**:
  ```javascript
  const res = await agent.exec("git status -s");
  console.log(res.stdout);
  ```

### 3. `window.agent.writeFile(relativePath: string, content: string): Promise<void>`
Writes a file to the workspace directory. Automatically handles recursive parent folder creation. Safe from shell injection vulnerabilities.
* **Example**:
  ```javascript
  await agent.writeFile(".vscode/notes/log.txt", "Some note data");
  ```

### 4. `window.agent.showNotification(message: string, type?: 'info' | 'warning' | 'error'): void`
Displays a native VS Code toast notification.
* **Example**:
  ```javascript
  agent.showNotification("Database synchronized successfully!");
  agent.showNotification("Connection lost!", "error");
  ```

### 5. `window.agent.showInputBox(options?: object): Promise<string | undefined>`
Triggers a native VS Code text input prompt.
* **Example**:
  ```javascript
  const branchName = await agent.showInputBox({
      prompt: "Enter name of new Git branch",
      placeHolder: "feature/auth-screen"
  });
  ```

### 6. `window.agent.openFile(relativePath: string): void`
Opens a file in the active editor pane of VS Code.
* **Example**:
  ```javascript
  agent.openFile("package.json");
  ```

### 7. `window.agent.executeVSCodeCommand(commandName: string, args?: any[]): Promise<any>`
Triggers any registered VS Code action or command programmatically.
* **Example**:
  ```javascript
  // Trigger VS Code settings panel
  await agent.executeVSCodeCommand("workbench.action.openSettings");
  ```

---

## Workspace Layout & Dimensions

The current viewport size (width and height) of the active sidebar is periodically reported and written to `.vscode/agent-panel-state.json`. 

You can read this state file at any time to:
1. Discover the current dimensions of the sidebar.
2. Determine if the UI needs to hide wide components or switch to a single-column layout.
