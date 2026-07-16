# Changelog

All notable changes to the "Custom Agent Panel" extension will be documented in this file.

## 0.1.0

- **Initial Public Release**
- **AI-Agent Customizable Dashboard**: Instantly renders the workspace `.vscode/agent-panel.html` template in the VS Code sidebar view.
- **Dynamic Hot Reloading**: Watches `.vscode/agent-panel.html` and reloads the active webview panel immediately on save.
- **Secure JS Bridge API (`window.agent`)**:
  - `runInTerminal(command)`: Launches interactive commands in a native terminal instance.
  - `exec(command)`: Safely executes background commands with timeout constraints.
  - `writeFile(relativePath, content)`: Platform-agnostic file writer with path-traversal safety checks.
  - `showNotification(message, type)`: Triggers native VS Code info/warning/error toasts.
  - `showInputBox(options)`: Captures text input using the native input panel.
  - `openFile(relativePath)`: Opens workspace documents in the active text editor pane.
  - `executeVSCodeCommand(command, args)`: Executes built-in VS Code commands programmatically.
