import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Storage } from './storage';
import { BUILTIN_PRESETS, PRESET_CATEGORY_TO_FOLDER } from './presets';
import { syncExternalPrompts } from './externalImport';
import {
  FolderItem,
  ImportedPromptItem,
  PresetItem,
  PromptNode,
  PromptDockTreeProvider,
  TemplateItem,
} from './treeProvider';

function resolveContent(content: string): string {
  const editor = vscode.window.activeTextEditor;
  const selectionText = editor ? editor.document.getText(editor.selection) : '';
  return content.replace(/\{selection\}/g, selectionText);
}

async function copyToClipboard(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
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

function getDefaultAction(): 'copyAndInsert' | 'copyOnly' | 'insertOnly' {
  return vscode.workspace
    .getConfiguration('promptdock')
    .get<'copyAndInsert' | 'copyOnly' | 'insertOnly'>('defaultAction', 'copyAndInsert');
}

export function registerCommands(
  context: vscode.ExtensionContext,
  storage: Storage,
  treeProvider: PromptDockTreeProvider,
  outputChannel: vscode.OutputChannel,
): void {
  const register = <T extends (...args: never[]) => unknown>(command: string, callback: T) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  };

  register('promptdock.refresh', () => treeProvider.refresh());

  register('promptdock.syncExternalHistory', async () => {
    const imported = await syncExternalPrompts(context, storage, outputChannel);
    if (imported === 0) {
      vscode.window.setStatusBarMessage('PromptDock: No new prompts found.', 3000);
    }
  });

  register('promptdock.createTemplate', async (node?: FolderItem) => {
    const name = await vscode.window.showInputBox({
      prompt: 'Template name',
      placeHolder: 'e.g. Explain this code',
    });
    if (!name) {
      return;
    }
    const content = await vscode.window.showInputBox({
      prompt: 'Prompt content (use {selection} to insert the selected code)',
      placeHolder: 'Explain what this code does:\n\n{selection}',
    });
    if (content === undefined) {
      return;
    }
    const folder = node instanceof FolderItem ? node.folder : undefined;
    await storage.createTemplate(name, content, folder?.id);
    vscode.window.showInformationMessage(
      folder ? `Created template "${name}" in "${folder.name}".` : `Created template "${name}".`,
    );
  });

  register('promptdock.createFolder', async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Folder name',
      placeHolder: 'e.g. Deployment',
    });
    if (!name) {
      return;
    }
    await storage.createFolder(name);
  });

  register('promptdock.renameFolder', async (node: FolderItem) => {
    if (!(node instanceof FolderItem)) {
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: 'New folder name',
      value: node.folder.name,
    });
    if (!name) {
      return;
    }
    await storage.renameFolder(node.folder.id, name);
  });

  register('promptdock.deleteFolder', async (node: FolderItem) => {
    if (!(node instanceof FolderItem)) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Delete folder "${node.folder.name}"? Templates inside it will move to My Templates (unfiled), not be deleted.`,
      { modal: true },
      'Delete',
    );
    if (confirm !== 'Delete') {
      return;
    }
    await storage.deleteFolder(node.folder.id);
  });

  register('promptdock.editTemplate', async (node: TemplateItem) => {
    if (!(node instanceof TemplateItem)) {
      return;
    }
    const content = await vscode.window.showInputBox({
      prompt: `Edit content for "${node.template.name}"`,
      value: node.template.content,
    });
    if (content === undefined) {
      return;
    }
    await storage.updateTemplate(node.template.id, { content });
  });

  register('promptdock.renameTemplate', async (node: TemplateItem) => {
    if (!(node instanceof TemplateItem)) {
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: 'New name',
      value: node.template.name,
    });
    if (!name) {
      return;
    }
    await storage.updateTemplate(node.template.id, { name });
  });

  register('promptdock.deleteTemplate', async (node: TemplateItem) => {
    if (!(node instanceof TemplateItem)) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Delete template "${node.template.name}"?`,
      { modal: true },
      'Delete',
    );
    if (confirm !== 'Delete') {
      return;
    }
    await storage.deleteTemplate(node.template.id);
  });

  register('promptdock.usePrompt', async (node: PromptNode) => {
    const action = getDefaultAction();
    await useNode(node, {
      copy: action !== 'insertOnly',
      insert: action !== 'copyOnly',
    });
  });

  register('promptdock.copyPrompt', async (node: PromptNode) => {
    await useNode(node, { copy: true, insert: false });
  });

  register('promptdock.insertPrompt', async (node: PromptNode) => {
    await useNode(node, { copy: false, insert: true });
  });

  const folderIdForPresetCategory = (category: string): string | undefined => {
    const folderName = PRESET_CATEGORY_TO_FOLDER[category];
    return folderName ? storage.getFolders().find((f) => f.name === folderName)?.id : undefined;
  };

  register('promptdock.importPreset', async (node: PresetItem) => {
    if (!(node instanceof PresetItem)) {
      return;
    }
    await storage.importTemplate(node.preset.name, node.preset.content, folderIdForPresetCategory(node.preset.category));
    vscode.window.showInformationMessage(`Imported "${node.preset.name}" to My Templates.`);
  });

  register('promptdock.importAllPresets', async () => {
    const existingNames = new Set(storage.getTemplates().map((t) => t.name));
    const toImport = BUILTIN_PRESETS.filter((p) => !existingNames.has(p.name));
    if (toImport.length === 0) {
      vscode.window.showInformationMessage('All presets are already in My Templates.');
      return;
    }
    for (const preset of toImport) {
      await storage.importTemplate(preset.name, preset.content, folderIdForPresetCategory(preset.category));
    }
    vscode.window.showInformationMessage(`Imported ${toImport.length} preset prompt(s).`);
  });

  register('promptdock.exportMyTemplates', async () => {
    const templates = storage.getTemplates();
    const folders = storage.getFolders();
    const dateStr = new Date().toLocaleDateString();
    const lines: string[] = [`# My Templates\n\n*Exported ${dateStr}*\n`];

    const folderMap = new Map(folders.map((f) => [f.id, f]));
    const sorted = [...folders].sort((a, b) => a.createdAt - b.createdAt);

    for (const folder of sorted) {
      const folderTemplates = templates.filter((t) => t.folderId === folder.id).sort((a, b) => b.updatedAt - a.updatedAt);
      lines.push(`\n## 📁 ${folder.name}\n`);
      if (folderTemplates.length === 0) {
        lines.push('*No templates.*\n');
      }
      for (const t of folderTemplates) {
        lines.push(`### ${t.name}\n\n${t.content}\n`);
      }
    }

    const unfiled = templates.filter((t) => !t.folderId || !folderMap.has(t.folderId)).sort((a, b) => b.updatedAt - a.updatedAt);
    if (unfiled.length > 0) {
      lines.push('\n## 📄 Unfiled\n');
      for (const t of unfiled) {
        lines.push(`### ${t.name}\n\n${t.content}\n`);
      }
    }

    const dest = path.join(os.homedir(), 'Desktop', 'myTemplates.md');
    fs.writeFileSync(dest, lines.join('\n'), 'utf8');
    vscode.window.showInformationMessage(`Exported ${templates.length} template(s) to ${dest}`);
  });

  register('promptdock.exportAllPrompts', async () => {
    const imported = storage.getImportedPrompts();
    const dateStr = new Date().toLocaleDateString();
    const lines: string[] = [`# PromptDock — All Prompts\n\n*Exported ${dateStr}*\n`];

    const bySource = new Map<string, typeof imported>();
    for (const p of imported) {
      const list = bySource.get(p.source);
      if (list) list.push(p); else bySource.set(p.source, [p]);
    }

    const SOURCE_ORDER_LOCAL = ['claude-code', 'copilot-chat', 'codex'];
    const SOURCE_LABELS_LOCAL: Record<string, string> = { 'claude-code': '🟠 Claude', 'copilot-chat': '🔵 Copilot', codex: '🟢 Codex' };

    for (const source of SOURCE_ORDER_LOCAL) {
      const prompts = bySource.get(source) ?? [];
      lines.push(`\n---\n\n## ${SOURCE_LABELS_LOCAL[source]} — ${prompts.length} prompts\n`);
      if (prompts.length === 0) { lines.push('*Nothing imported yet.*\n'); continue; }

      const byProject = new Map<string, typeof prompts>();
      for (const p of prompts) {
        const list = byProject.get(p.project);
        if (list) list.push(p); else byProject.set(p.project, [p]);
      }

      for (const [project, items] of byProject) {
        lines.push(`\n### 📁 ${project}\n`);
        const bySession = new Map<string, typeof items>();
        for (const p of items) {
          const list = bySession.get(p.sessionId);
          if (list) list.push(p); else bySession.set(p.sessionId, [p]);
        }
        for (const [, sessionItems] of bySession) {
          const sorted = [...sessionItems].sort((a, b) => a.usedAt - b.usedAt);
          lines.push(`\n#### 💬 ${sorted[0].name}\n`);
          for (const p of sorted) {
            lines.push(`**${p.name}**\n*${new Date(p.usedAt).toLocaleString()}*\n\n${p.content}\n`);
          }
        }
      }
    }

    const dest = path.join(os.homedir(), 'Desktop', 'promptdeck.md');
    fs.writeFileSync(dest, lines.join('\n'), 'utf8');
    vscode.window.showInformationMessage(`Exported ${imported.length} prompt(s) to ${dest}`);
  });

  register('promptdock.restoreHiddenPresets', async () => {
    const dismissedIds = storage.getDismissedPresetIds();
    if (dismissedIds.size === 0) {
      vscode.window.showInformationMessage('No hidden presets to restore.');
      return;
    }
    const hidden = BUILTIN_PRESETS.filter((p) => dismissedIds.has(p.id));
    const picked = await vscode.window.showQuickPick(
      hidden.map((p) => ({ label: p.name, description: p.category, id: p.id })),
      { canPickMany: true, placeHolder: 'Select hidden presets to restore' },
    );
    if (!picked || picked.length === 0) {
      return;
    }
    await storage.restoreDismissedPresets(picked.map((p) => p.id));
    vscode.window.showInformationMessage(`Restored ${picked.length} preset(s).`);
  });
}

async function useNode(
  node: PromptNode,
  actions: { copy: boolean; insert: boolean },
): Promise<void> {
  let name: string;
  let rawContent: string;

  if (node instanceof TemplateItem) {
    name = node.template.name;
    rawContent = node.template.content;
  } else if (node instanceof PresetItem) {
    name = node.preset.name;
    rawContent = node.preset.content;
  } else if (node instanceof ImportedPromptItem) {
    name = node.prompt.name;
    rawContent = node.prompt.content;
  } else {
    return;
  }

  const content = resolveContent(rawContent);

  if (actions.copy) {
    await copyToClipboard(content);
  }
  let inserted = false;
  if (actions.insert) {
    inserted = await insertAtCursor(content);
  }

  if (!actions.copy && !inserted) {
    // Insert-only was requested but there was no active editor; fall back to clipboard.
    await copyToClipboard(content);
  }

  const verb = actions.insert && inserted ? (actions.copy ? 'Copied & inserted' : 'Inserted') : 'Copied';
  vscode.window.setStatusBarMessage(`PromptDock: ${verb} "${name}"`, 3000);
}
