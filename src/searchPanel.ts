import * as vscode from 'vscode';
import { Storage } from './storage';
import { SearchResult } from './search';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveSelection(content: string): string {
  const editor = vscode.window.activeTextEditor;
  const selectionText = editor ? editor.document.getText(editor.selection) : '';
  return content.replace(/\{selection\}/g, selectionText);
}

async function insertAtCursor(text: string): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return false;
  }
  await editor.edit((editBuilder) => {
    editBuilder.insert(editor.selection.active, text);
  });
  return true;
}

function nonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function renderHtml(webview: vscode.Webview, result: SearchResult): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce()}'`,
  ].join('; ');
  const scriptNonce = csp.match(/'nonce-([^']+)'/)![1];

  const showSaveButton = result.kind !== 'template';

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      padding: 1.5rem;
    }
    h1 {
      font-size: 1.3em;
      margin-bottom: 0.2em;
    }
    .meta {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 1rem;
    }
    pre {
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 4px;
      padding: 1rem;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--vscode-editor-font-family);
    }
    .actions {
      margin-top: 1rem;
      display: flex;
      gap: 0.5rem;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 14px;
      border-radius: 2px;
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(result.name)}</h1>
  <div class="meta">${escapeHtml(result.meta)}</div>
  <pre>${escapeHtml(result.content)}</pre>
  <div class="actions">
    <button id="copy">Copy to Clipboard</button>
    <button id="insert" class="secondary">Insert at Cursor</button>
    ${showSaveButton ? `<button id="save" class="secondary">Save to My Templates</button>` : ''}
  </div>
  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy' }));
    document.getElementById('insert').addEventListener('click', () => vscode.postMessage({ type: 'insert' }));
    const saveBtn = document.getElementById('save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => vscode.postMessage({ type: 'save' }));
    }
  </script>
</body>
</html>`;
}

const openPanels = new Map<string, vscode.WebviewPanel>();

export function showPromptDetailPanel(storage: Storage, result: SearchResult): void {
  const key = `${result.kind}:${result.id}`;
  const existing = openPanels.get(key);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'promptdock.promptDetail',
    result.name,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.iconPath = new vscode.ThemeIcon(result.icon.id);
  panel.webview.html = renderHtml(panel.webview, result);
  openPanels.set(key, panel);
  panel.onDidDispose(() => openPanels.delete(key));

  panel.webview.onDidReceiveMessage(async (message: { type: string }) => {
    const content = resolveSelection(result.content);

    if (message.type === 'copy') {
      await vscode.env.clipboard.writeText(content);
      vscode.window.setStatusBarMessage(`PromptDock: Copied "${result.name}"`, 3000);
      return;
    }

    if (message.type === 'insert') {
      const inserted = await insertAtCursor(content);
      if (!inserted) {
        await vscode.env.clipboard.writeText(content);
        vscode.window.setStatusBarMessage('PromptDock: No active editor — copied to clipboard instead.', 3000);
      } else {
        vscode.window.setStatusBarMessage(`PromptDock: Inserted "${result.name}"`, 3000);
      }
      return;
    }

    if (message.type === 'save') {
      await storage.createTemplate(result.name, result.content);
      vscode.window.showInformationMessage(`Saved "${result.name}" to My Templates.`);
    }
  });
}
