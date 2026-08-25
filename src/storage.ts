import * as vscode from 'vscode';
import { ImportedPrompt, PromptTemplate, TemplateFolder } from './types';

const TEMPLATES_KEY = 'promptdock.templates';
const FOLDERS_KEY = 'promptdock.templateFolders';
const FOLDERS_SEEDED_KEY = 'promptdock.foldersSeeded';
const IMPORTED_EXTERNAL_IDS_KEY = 'promptdock.importedExternalIds';
const IMPORTED_PROMPTS_KEY = 'promptdock.importedPrompts';
const FILE_SCAN_STATS_KEY = 'promptdock.fileScanStats';
const DISMISSED_PRESET_IDS_KEY = 'promptdock.dismissedPresetIds';

export interface FileStat {
  mtimeMs: number;
  size: number;
}

/** Default folders created once, the first time the extension activates. */
const DEFAULT_FOLDER_NAMES = [
  'Requirements',
  'Design',
  'Development',
  'Testing',
  'Deployment',
  'Maintenance',
  'Agents',
];

/** Name of the reserved system folder that soft-deleted templates/presets are moved into. */
const DELETED_FOLDER_NAME = 'Deleted';

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export class Storage {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly memento: vscode.Memento) {}

  private fireChange(): void {
    this.onDidChangeEmitter.fire();
  }

  // ---- Templates ----

  getTemplates(): PromptTemplate[] {
    return this.memento.get<PromptTemplate[]>(TEMPLATES_KEY, []);
  }

  private setTemplates(templates: PromptTemplate[]): Thenable<void> {
    return this.memento.update(TEMPLATES_KEY, templates);
  }

  async createTemplate(name: string, content: string, folderId?: string): Promise<PromptTemplate> {
    const now = Date.now();
    const template: PromptTemplate = {
      id: genId(),
      name,
      content,
      folderId,
      createdAt: now,
      updatedAt: now,
    };
    const templates = this.getTemplates();
    templates.push(template);
    await this.setTemplates(templates);
    this.fireChange();
    return template;
  }

  async updateTemplate(
    id: string,
    updates: Partial<Pick<PromptTemplate, 'name' | 'content' | 'folderId'>>,
  ): Promise<void> {
    const templates = this.getTemplates();
    const index = templates.findIndex((t) => t.id === id);
    if (index === -1) {
      return;
    }
    templates[index] = { ...templates[index], ...updates, updatedAt: Date.now() };
    await this.setTemplates(templates);
    this.fireChange();
  }

  async deleteTemplate(id: string): Promise<void> {
    const templates = this.getTemplates().filter((t) => t.id !== id);
    await this.setTemplates(templates);
    this.fireChange();
  }

  async importTemplate(name: string, content: string, folderId?: string): Promise<PromptTemplate> {
    return this.createTemplate(name, content, folderId);
  }

  // ---- Template folders ----

  getFolders(): TemplateFolder[] {
    return this.memento.get<TemplateFolder[]>(FOLDERS_KEY, []);
  }

  private setFolders(folders: TemplateFolder[]): Thenable<void> {
    return this.memento.update(FOLDERS_KEY, folders);
  }

  /** Seeds the default SDLC + Agents folders once, on first activation. No-op afterwards. */
  async ensureDefaultFolders(): Promise<void> {
    if (this.memento.get<boolean>(FOLDERS_SEEDED_KEY, false)) {
      return;
    }
    const now = Date.now();
    const defaults = DEFAULT_FOLDER_NAMES.map((name) => ({ id: genId(), name, createdAt: now }));
    await this.setFolders([...this.getFolders(), ...defaults]);
    await this.memento.update(FOLDERS_SEEDED_KEY, true);
    this.fireChange();
  }

  async createFolder(name: string): Promise<TemplateFolder> {
    const folder: TemplateFolder = { id: genId(), name, createdAt: Date.now() };
    await this.setFolders([...this.getFolders(), folder]);
    this.fireChange();
    return folder;
  }

  /**
   * Returns the reserved "Deleted" folder, creating it if it doesn't exist yet. Idempotent and
   * self-healing — call it wherever a soft-delete needs somewhere to put things, and on every
   * activation, so the folder can never simply be missing.
   */
  async ensureDeletedFolder(): Promise<TemplateFolder> {
    const existing = this.getFolders().find((f) => f.name === DELETED_FOLDER_NAME);
    if (existing) {
      return existing;
    }
    return this.createFolder(DELETED_FOLDER_NAME);
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const folders = this.getFolders();
    const index = folders.findIndex((f) => f.id === id);
    if (index === -1) {
      return;
    }
    folders[index] = { ...folders[index], name };
    await this.setFolders(folders);
    this.fireChange();
  }

  /**
   * Deletes a folder; templates inside it become unfiled rather than being deleted. No-op for the
   * reserved "Deleted" folder — it's a system fixture that soft-deletes rely on always existing.
   */
  async deleteFolder(id: string): Promise<void> {
    const folder = this.getFolders().find((f) => f.id === id);
    if (!folder || folder.name === DELETED_FOLDER_NAME) {
      return;
    }
    await this.setFolders(this.getFolders().filter((f) => f.id !== id));
    const templates = this.getTemplates().map((t) =>
      t.folderId === id ? { ...t, folderId: undefined } : t,
    );
    await this.setTemplates(templates);
    this.fireChange();
  }

  // ---- Imported prompts (Claude Code / Copilot Chat / Codex) ----

  getImportedExternalIds(): Set<string> {
    return new Set(this.memento.get<string[]>(IMPORTED_EXTERNAL_IDS_KEY, []));
  }

  getImportedPrompts(): ImportedPrompt[] {
    return this.memento.get<ImportedPrompt[]>(IMPORTED_PROMPTS_KEY, []);
  }

  /**
   * Appends genuinely new externally-sourced prompts (deduped by id, never re-added
   * once imported — these are a full browsable archive, not a capped rolling log like
   * History). Returns the number of new prompts imported.
   */
  async importExternalPrompts(candidates: ImportedPrompt[]): Promise<number> {
    const alreadyImported = this.getImportedExternalIds();
    const fresh = candidates.filter((c) => !alreadyImported.has(c.id));
    if (fresh.length === 0) {
      return 0;
    }

    await this.memento.update(IMPORTED_PROMPTS_KEY, [...this.getImportedPrompts(), ...fresh]);

    fresh.forEach((c) => alreadyImported.add(c.id));
    await this.memento.update(IMPORTED_EXTERNAL_IDS_KEY, Array.from(alreadyImported));

    this.fireChange();
    return fresh.length;
  }

  /**
   * Per-file (mtime, size) recorded the last time each Claude Code/Copilot/Codex session file was
   * fully read and parsed — lets the scanner skip files that haven't changed since last sync instead
   * of re-reading and re-parsing potentially many MB of unchanging history on every activation.
   */
  getFileScanStats(): Record<string, FileStat> {
    return this.memento.get<Record<string, FileStat>>(FILE_SCAN_STATS_KEY, {});
  }

  async setFileScanStats(stats: Record<string, FileStat>): Promise<void> {
    await this.memento.update(FILE_SCAN_STATS_KEY, stats);
  }

  async clearFileScanStats(): Promise<void> {
    await this.memento.update(FILE_SCAN_STATS_KEY, {});
  }

  // ---- Dismissed presets ----
  // Presets are read-only, built into the extension — "deleting" one just hides it per-user
  // rather than removing the definition, and can be undone via restoreDismissedPresets.

  getDismissedPresetIds(): Set<string> {
    return new Set(this.memento.get<string[]>(DISMISSED_PRESET_IDS_KEY, []));
  }

  async dismissPreset(presetId: string): Promise<void> {
    const dismissed = this.getDismissedPresetIds();
    if (dismissed.has(presetId)) {
      return;
    }
    dismissed.add(presetId);
    await this.memento.update(DISMISSED_PRESET_IDS_KEY, Array.from(dismissed));
    this.fireChange();
  }

  async restoreDismissedPresets(presetIds: string[]): Promise<void> {
    const dismissed = this.getDismissedPresetIds();
    let changed = false;
    for (const id of presetIds) {
      changed = dismissed.delete(id) || changed;
    }
    if (!changed) {
      return;
    }
    await this.memento.update(DISMISSED_PRESET_IDS_KEY, Array.from(dismissed));
    this.fireChange();
  }
}
