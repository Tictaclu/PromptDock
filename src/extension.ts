import * as vscode from 'vscode';
import { Storage } from './storage';
import { PromptDockTreeProvider } from './treeProvider';
import { PromptDockWebviewProvider } from './webviewProvider';
import { registerCommands } from './commands';
import { syncExternalPrompts } from './externalImport';
import { registerSearchCommand } from './search';

export function activate(context: vscode.ExtensionContext): void {
  const storage = new Storage(context.globalState);
  // Kept for registerCommands' API (e.g. the now-unused "Refresh" command) — not registered as the
  // active view provider. The webview below owns rendering and re-posts its own state on every change.
  const treeProvider = new PromptDockTreeProvider(storage);
  const outputChannel = vscode.window.createOutputChannel('PromptDock');
  context.subscriptions.push(outputChannel);

  const doSync = () => syncExternalPrompts(context, storage, outputChannel);
  const webviewProvider = new PromptDockWebviewProvider(context.extensionUri, storage, doSync);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('promptdock.view', webviewProvider));

  registerCommands(context, storage, treeProvider, outputChannel);
  registerSearchCommand(context, storage);

  void storage.ensureDefaultFolders();
  void storage.ensureDeletedFolder();
}

export function deactivate(): void {}
