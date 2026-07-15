# Instruction for AI Agents: Managing the Sidebar UI

Welcome! This workspace is equipped with the **Agent Explorer Panel** VS Code extension. This extension allows you (the AI agent) to customize the user's sidebar interface in real-time.

## How to Customize the Sidebar

1. **Write to the HTML File:**
   The sidebar renders the contents of the file:
   `.vscode/agent-panel.html`
   Whenever you edit this file, the sidebar view in the user's editor will reload **instantly**.

2. **Adapt to Sidebar Dimensions:**
   Before updating the HTML, read the current size of the sidebar from:
   `.vscode/agent-panel-state.json`
   This file is updated in real-time by the extension as the user resizes their sidebar. Use these width and height values to optimize your design (e.g. font sizes, column grid structures, compact margins) so it fits beautifully.

3. **Use the JavaScript Bridge (`window.agent`):**
   A global `window.agent` helper is automatically injected into the webview. You can use it in your `<script>` tags inside `agent-panel.html` to run shell commands or trigger editor actions:

   * **Execute terminal commands:**
     ```javascript
     const { stdout, stderr } = await agent.exec("git status -s");
     ```
   * **Show notifications:**
     ```javascript
     agent.showNotification("Task complete!", "info");
     ```
   * **Prompt for text input:**
     ```javascript
     const branchName = await agent.showInputBox({ prompt: "New branch name" });
     ```
   * **Open a file in the editor:**
     ```javascript
     agent.openFile("package.json");
     ```
   * **Run VS Code commands:**
     ```javascript
     await agent.executeVSCodeCommand("git.publish");
     ```

## Core Design Principles
- **Sidebar Constraints:** Keep elements stacked vertically. Avoid wide horizontal tables.
- **VS Code Look and Feel:** Use VS Code theme CSS variables (e.g., `var(--vscode-sideBar-background)`, `var(--vscode-button-background)`) to blend in seamlessly.
- **Glassmorphism:** Use clean border outlines (`rgba(255,255,255,0.08)`) and high contrast text.
