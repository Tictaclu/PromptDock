import * as vscode from 'vscode';
import { Storage } from './storage';
import { BUILTIN_PRESETS, PRESET_CATEGORY_TO_FOLDER } from './presets';
import { ImportedPrompt, PromptSource, PromptTemplate, SOURCE_LABELS, TemplateFolder } from './types';

export type GroupId = 'templates';

function presetsForFolder(folderName: string): typeof BUILTIN_PRESETS {
  return BUILTIN_PRESETS.filter((p) => PRESET_CATEGORY_TO_FOLDER[p.category] === folderName);
}

const SOURCE_ORDER: PromptSource[] = ['claude-code', 'copilot-chat', 'codex'];

const SOURCE_ICONS: Record<PromptSource, string> = {
  'claude-code': '🟠',
  'copilot-chat': '🔵',
  codex: '🟢',
};

const SOURCE_COLORS: Record<PromptSource, string> = {
  'claude-code': 'charts.orange',
  'copilot-chat': 'charts.blue',
  codex: 'charts.green',
};

export class GroupItem extends vscode.TreeItem {
  constructor(
    readonly groupId: GroupId,
    label: string,
    contextValue: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = contextValue;
  }
}

export class TemplateItem extends vscode.TreeItem {
  constructor(readonly template: PromptTemplate) {
    super(template.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'templatePrompt';
    this.tooltip = new vscode.MarkdownString(`**${template.name}**\n\n${template.content}`);
    this.iconPath = new vscode.ThemeIcon('symbol-text');
    this.command = {
      command: 'promptdock.usePrompt',
      title: 'Use Prompt',
      arguments: [this],
    };
  }
}

/** A user-manageable folder nested under My Templates (defaults follow the SDLC, plus Agents). */
export class FolderItem extends vscode.TreeItem {
  constructor(
    readonly folder: TemplateFolder,
    count: number,
  ) {
    super(folder.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'templateFolder';
    this.description = `${count}`;
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class PresetItem extends vscode.TreeItem {
  constructor(readonly preset: (typeof BUILTIN_PRESETS)[number]) {
    super(preset.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'presetPrompt';
    this.description = preset.category;
    this.tooltip = new vscode.MarkdownString(preset.content);
    this.iconPath = new vscode.ThemeIcon('package');
    this.command = {
      command: 'promptdock.usePrompt',
      title: 'Use Prompt',
      arguments: [this],
    };
  }
}

/** Top-level container for one external source (Claude Code / Copilot Chat / Codex). */
export class SourceGroupItem extends vscode.TreeItem {
  constructor(
    readonly source: PromptSource,
    count: number,
  ) {
    super(`${SOURCE_ICONS[source]} ${SOURCE_LABELS[source]}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'sourceGroup';
    this.description = `${count}`;
  }
}

/** Second-level container grouping one source's prompts by originating project/folder. */
export class ProjectGroupItem extends vscode.TreeItem {
  constructor(
    readonly source: PromptSource,
    readonly project: string,
    count: number,
  ) {
    super(project, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'projectGroup';
    this.description = `${count}`;
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

/** Third-level container grouping one project's prompts by originating conversation/session. */
export class SessionGroupItem extends vscode.TreeItem {
  constructor(
    readonly source: PromptSource,
    readonly project: string,
    readonly sessionId: string,
    title: string,
    lastActivity: number,
    count: number,
  ) {
    super(title, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'sessionGroup';
    this.description = `${count} · ${new Date(lastActivity).toLocaleString()}`;
    this.iconPath = new vscode.ThemeIcon('comment-discussion');
  }
}

export class ImportedPromptItem extends vscode.TreeItem {
  constructor(readonly prompt: ImportedPrompt) {
    super(prompt.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'importedPrompt';
    this.description = new Date(prompt.usedAt).toLocaleString();
    this.tooltip = new vscode.MarkdownString(prompt.content);
    this.iconPath = new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor(SOURCE_COLORS[prompt.source]));
    this.command = {
      command: 'promptdock.usePrompt',
      title: 'Use Prompt',
      arguments: [this],
    };
  }
}

export type PromptNode = TemplateItem | PresetItem | ImportedPromptItem;
type TreeNode = GroupItem | SourceGroupItem | ProjectGroupItem | SessionGroupItem | FolderItem | PromptNode;

export class PromptDockTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly storage: Storage) {
    storage.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      const imported = this.storage.getImportedPrompts();
      return [
        ...SOURCE_ORDER.map(
          (source) => new SourceGroupItem(source, imported.filter((p) => p.source === source).length),
        ),
        new GroupItem('templates', '⭐ My Templates', 'templatesGroup'),
      ];
    }

    if (element instanceof GroupItem) {
      switch (element.groupId) {
        case 'templates': {
          const templates = this.storage.getTemplates();
          const folders = [...this.storage.getFolders()].sort((a, b) => a.createdAt - b.createdAt);
          const unfiled = templates
            .filter((t) => !t.folderId)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((t) => new TemplateItem(t));
          return [
            ...folders.map(
              (f) =>
                new FolderItem(
                  f,
                  templates.filter((t) => t.folderId === f.id).length + presetsForFolder(f.name).length,
                ),
            ),
            ...unfiled,
          ];
        }
        default:
          return [];
      }
    }

    if (element instanceof FolderItem) {
      const presetItems = presetsForFolder(element.folder.name).map((p) => new PresetItem(p));
      const templateItems = this.storage
        .getTemplates()
        .filter((t) => t.folderId === element.folder.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((t) => new TemplateItem(t));
      return [...presetItems, ...templateItems];
    }

    if (element instanceof SourceGroupItem) {
      const prompts = this.storage.getImportedPrompts().filter((p) => p.source === element.source);
      const lastActivityByProject = new Map<string, number>();
      for (const p of prompts) {
        lastActivityByProject.set(p.project, Math.max(lastActivityByProject.get(p.project) ?? 0, p.usedAt));
      }
      return [...lastActivityByProject.keys()]
        .sort((a, b) => (lastActivityByProject.get(b) ?? 0) - (lastActivityByProject.get(a) ?? 0))
        .map(
          (project) =>
            new ProjectGroupItem(element.source, project, prompts.filter((p) => p.project === project).length),
        );
    }

    if (element instanceof ProjectGroupItem) {
      const prompts = this.storage
        .getImportedPrompts()
        .filter((p) => p.source === element.source && p.project === element.project);

      const bySession = new Map<string, ImportedPrompt[]>();
      for (const p of prompts) {
        const list = bySession.get(p.sessionId);
        if (list) {
          list.push(p);
        } else {
          bySession.set(p.sessionId, [p]);
        }
      }

      return [...bySession.entries()]
        .map(([sessionId, items]) => {
          const sorted = [...items].sort((a, b) => a.usedAt - b.usedAt);
          return {
            sessionId,
            count: sorted.length,
            title: sorted[0].name,
            lastActivity: sorted[sorted.length - 1].usedAt,
          };
        })
        .sort((a, b) => b.lastActivity - a.lastActivity)
        .map(
          (s) =>
            new SessionGroupItem(element.source, element.project, s.sessionId, s.title, s.lastActivity, s.count),
        );
    }

    if (element instanceof SessionGroupItem) {
      return this.storage
        .getImportedPrompts()
        .filter(
          (p) => p.source === element.source && p.project === element.project && p.sessionId === element.sessionId,
        )
        .sort((a, b) => b.usedAt - a.usedAt)
        .map((p) => new ImportedPromptItem(p));
    }

    return [];
  }
}
