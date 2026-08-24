import * as vscode from 'vscode';
import { Storage } from './storage';
import { BUILTIN_PRESETS } from './presets';
import { SOURCE_LABELS } from './types';
import { showPromptDetailPanel } from './searchPanel';

export type SearchResultKind = 'template' | 'preset' | 'imported';

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  name: string;
  content: string;
  /** Short badge shown next to the result: folder name, preset category, or source/project. */
  meta: string;
  icon: vscode.ThemeIcon;
}

function collectSearchablePrompts(storage: Storage): SearchResult[] {
  const folderNameById = new Map(storage.getFolders().map((f) => [f.id, f.name]));

  const templates: SearchResult[] = storage.getTemplates().map((t) => ({
    kind: 'template',
    id: t.id,
    name: t.name,
    content: t.content,
    meta: t.folderId ? (folderNameById.get(t.folderId) ?? 'Unfiled') : 'Unfiled',
    icon: new vscode.ThemeIcon('symbol-text'),
  }));

  const presets: SearchResult[] = BUILTIN_PRESETS.map((p) => ({
    kind: 'preset',
    id: p.id,
    name: p.name,
    content: p.content,
    meta: p.category,
    icon: new vscode.ThemeIcon('package'),
  }));

  const imported: SearchResult[] = storage.getImportedPrompts().map((p) => ({
    kind: 'imported',
    id: p.id,
    name: p.name,
    content: p.content,
    meta: `${SOURCE_LABELS[p.source]} · ${p.project}`,
    icon: new vscode.ThemeIcon('comment-discussion'),
  }));

  return [...templates, ...presets, ...imported];
}

function matches(result: SearchResult, query: string): boolean {
  const q = query.toLowerCase();
  return result.name.toLowerCase().includes(q) || result.content.toLowerCase().includes(q);
}

interface ResultQuickPickItem extends vscode.QuickPickItem {
  result: SearchResult;
}

function toQuickPickItem(result: SearchResult): ResultQuickPickItem {
  const snippet = result.content.replace(/\s+/g, ' ').trim();
  return {
    result,
    label: `$(${result.icon.id}) ${result.name}`,
    description: result.meta,
    detail: snippet.length > 120 ? `${snippet.slice(0, 120)}…` : snippet,
  };
}

export function registerSearchCommand(context: vscode.ExtensionContext, storage: Storage): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('promptdock.searchPrompts', () => {
      const all = collectSearchablePrompts(storage);

      const quickPick = vscode.window.createQuickPick<ResultQuickPickItem>();
      quickPick.placeholder = 'Search prompts by name or content…';
      quickPick.matchOnDescription = false;
      quickPick.matchOnDetail = false;
      quickPick.items = all.map(toQuickPickItem);

      quickPick.onDidChangeValue((value) => {
        const query = value.trim();
        const filtered = query ? all.filter((r) => matches(r, query)) : all;
        quickPick.items = filtered.map(toQuickPickItem);
      });

      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
          showPromptDetailPanel(storage, selected.result);
        }
        quickPick.hide();
      });

      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();
    }),
  );
}
