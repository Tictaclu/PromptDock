import * as vscode from 'vscode';
import { Storage } from './storage';
import { BUILTIN_PRESETS, PRESET_CATEGORY_TO_FOLDER } from './presets';
import { ImportedPrompt, PromptSource, SOURCE_LABELS } from './types';

const SOURCE_ORDER: PromptSource[] = ['claude-code', 'copilot-chat', 'codex'];
const SOURCE_ICONS: Record<PromptSource, string> = { 'claude-code': '🟠', 'copilot-chat': '🔵', codex: '🟢' };

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
  await editor.edit((editBuilder) => editBuilder.insert(editor.selection.active, text));
  return true;
}

function getDefaultAction(): 'copyAndInsert' | 'copyOnly' | 'insertOnly' {
  return vscode.workspace
    .getConfiguration('promptdock')
    .get<'copyAndInsert' | 'copyOnly' | 'insertOnly'>('defaultAction', 'copyAndInsert');
}

async function usePromptContent(name: string, rawContent: string, action: 'copy' | 'insert' | 'default'): Promise<void> {
  const content = resolveContent(rawContent);
  const wantCopy = action === 'copy' || (action === 'default' && getDefaultAction() !== 'insertOnly');
  const wantInsert = action === 'insert' || (action === 'default' && getDefaultAction() !== 'copyOnly');

  if (wantCopy) {
    await copyToClipboard(content);
  }
  let inserted = false;
  if (wantInsert) {
    inserted = await insertAtCursor(content);
  }
  if (!wantCopy && !inserted) {
    await copyToClipboard(content);
  }

  const verb = wantInsert && inserted ? (wantCopy ? 'Copied & inserted' : 'Inserted') : 'Copied';
  vscode.window.setStatusBarMessage(`PromptDock: ${verb} "${name}"`, 3000);
}

interface PromptRow {
  id: string;
  name: string;
  content: string;
  meta?: string;
}

interface FolderData {
  id: string;
  name: string;
  presets: PromptRow[];
  templates: PromptRow[];
}

interface SessionData {
  id: string;
  title: string;
  count: number;
  lastActivity: number;
  prompts: PromptRow[];
}

interface ProjectData {
  name: string;
  count: number;
  sessions: SessionData[];
}

interface SourceData {
  source: PromptSource;
  label: string;
  icon: string;
  color: string;
  count: number;
  projects: ProjectData[];
}

interface WebviewState {
  templates: { folders: FolderData[]; unfiled: PromptRow[] };
  sources: SourceData[];
}

export function buildState(storage: Storage): WebviewState {
  const templates = storage.getTemplates();
  const folders = [...storage.getFolders()].sort((a, b) => a.createdAt - b.createdAt);

  const folderData: FolderData[] = folders.map((f) => ({
    id: f.id,
    name: f.name,
    presets: BUILTIN_PRESETS.filter((p) => PRESET_CATEGORY_TO_FOLDER[p.category] === f.name).map((p) => ({
      id: `preset:${p.id}`,
      name: p.name,
      content: p.content,
      meta: p.category,
    })),
    templates: templates
      .filter((t) => t.folderId === f.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((t) => ({ id: `template:${t.id}`, name: t.name, content: t.content })),
  }));

  const unfiled: PromptRow[] = templates
    .filter((t) => !t.folderId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((t) => ({ id: `template:${t.id}`, name: t.name, content: t.content }));

  const imported = storage.getImportedPrompts();
  const sources: SourceData[] = SOURCE_ORDER.map((source) => {
    const prompts = imported.filter((p) => p.source === source);
    const byProject = new Map<string, ImportedPrompt[]>();
    for (const p of prompts) {
      const list = byProject.get(p.project);
      if (list) {
        list.push(p);
      } else {
        byProject.set(p.project, [p]);
      }
    }

    const projects: ProjectData[] = [...byProject.entries()]
      .map(([name, items]) => {
        const bySession = new Map<string, ImportedPrompt[]>();
        for (const p of items) {
          const list = bySession.get(p.sessionId);
          if (list) {
            list.push(p);
          } else {
            bySession.set(p.sessionId, [p]);
          }
        }
        const sessions: SessionData[] = [...bySession.entries()]
          .map(([id, sItems]) => {
            const sorted = [...sItems].sort((a, b) => a.usedAt - b.usedAt);
            return {
              id,
              title: sorted[0].name,
              count: sorted.length,
              lastActivity: sorted[sorted.length - 1].usedAt,
              prompts: [...sItems]
                .sort((a, b) => b.usedAt - a.usedAt)
                .map((p) => ({
                  id: `imported:${p.id}`,
                  name: p.name,
                  content: p.content,
                  meta: new Date(p.usedAt).toLocaleString(),
                })),
            };
          })
          .sort((a, b) => b.lastActivity - a.lastActivity);
        const lastActivity = sessions.reduce((max, s) => Math.max(max, s.lastActivity), 0);
        return { name, count: items.length, sessions, lastActivity };
      })
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .map(({ lastActivity: _unused, ...rest }) => rest);

    return {
      source,
      label: SOURCE_LABELS[source],
      icon: SOURCE_ICONS[source],
      color: source === 'claude-code' ? 'charts.orange' : source === 'copilot-chat' ? 'charts.blue' : 'charts.green',
      count: prompts.length,
      projects,
    };
  });

  return { templates: { folders: folderData, unfiled }, sources };
}

/**
 * Looks up one row's name/content directly by its "<kind>:<id>" webview id, without building the
 * full nested folder/project/session tree — buildState() does O(templates + presets×folders +
 * imported-prompts log n) work to group everything for rendering; a single click only needs one row.
 */
function findPromptById(storage: Storage, id: string): { name: string; content: string } | undefined {
  const separatorIndex = id.indexOf(':');
  if (separatorIndex === -1) {
    return undefined;
  }
  const kind = id.slice(0, separatorIndex);
  const rawId = id.slice(separatorIndex + 1);

  if (kind === 'template') {
    const template = storage.getTemplates().find((t) => t.id === rawId);
    return template && { name: template.name, content: template.content };
  }
  if (kind === 'preset') {
    const preset = BUILTIN_PRESETS.find((p) => p.id === rawId);
    return preset && { name: preset.name, content: preset.content };
  }
  if (kind === 'imported') {
    const prompt = storage.getImportedPrompts().find((p) => p.id === rawId);
    return prompt && { name: prompt.name, content: prompt.content };
  }
  return undefined;
}

export function findRow(state: WebviewState, id: string): PromptRow | undefined {
  for (const f of state.templates.folders) {
    const hit = [...f.presets, ...f.templates].find((r) => r.id === id);
    if (hit) {
      return hit;
    }
  }
  const unfiledHit = state.templates.unfiled.find((r) => r.id === id);
  if (unfiledHit) {
    return unfiledHit;
  }
  for (const s of state.sources) {
    for (const p of s.projects) {
      for (const session of p.sessions) {
        const hit = session.prompts.find((r) => r.id === id);
        if (hit) {
          return hit;
        }
      }
    }
  }
  return undefined;
}

function nonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function renderHtml(cspSource: string): string {
  const scriptNonce = nonce();
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 10px 10px 24px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    overflow-x: hidden;
    scrollbar-gutter: stable;
  }
  .title {
    font-weight: 600;
    letter-spacing: 0.08em;
    font-size: 12px;
    text-transform: uppercase;
    opacity: 0.75;
    margin: 4px 4px 12px;
  }
  .card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 8px;
    margin-bottom: 12px;
    overflow: hidden;
  }
  .card-header {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    background: var(--vscode-sideBarSectionHeader-background);
    cursor: pointer;
    user-select: none;
  }
  .card-header .left { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
  .card-header .name { font-weight: 600; }
  .card-header .count { opacity: 0.6; font-size: 12px; }
  .card-header .toggle { font-size: 16px; line-height: 1; margin-left: 8px; transition: transform 0.15s ease; }
  .card-sync-btn { background: transparent; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 4px; color: var(--vscode-foreground); cursor: pointer; font-family: inherit; font-size: 11px; opacity: 0.7; padding: 2px 8px; white-space: nowrap; }
  .card-sync-btn:hover { background: var(--vscode-list-hoverBackground); opacity: 1; }
  .card.collapsed .toggle { transform: rotate(-90deg); }
  .card-body { padding: 8px; }
  .card.collapsed .card-body { display: none; }
  .toolbar-container { display: flex; flex-direction: column; gap: 6px; padding: 0 2px 8px; }
  .sync-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 4px;
    padding: 5px 10px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    width: 100%;
  }
  .sync-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
  .sync-btn .sync-icon { font-size: 14px; line-height: 1; }
  .toolbar { display: flex; align-items: center; gap: 6px; }
  .search {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    padding: 4px 8px;
  }
  .search input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
  }
  .new-window-btn {
    background: transparent;
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 4px;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    line-height: 1;
    padding: 4px 8px;
    opacity: 0.7;
    white-space: nowrap;
  }
  .new-window-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
  .group { margin-bottom: 2px; }
  .group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    user-select: none;
    min-height: 30px;
  }
  .group-header:hover { background: var(--vscode-list-hoverBackground); }
  .group-header .chevron { font-size: 16px; line-height: 1; min-width: 16px; text-align: center; transition: transform 0.15s ease; }
  .group.collapsed > .group-children { display: none; }
  .group.collapsed .chevron { transform: rotate(-90deg); }
  .group-header .label { font-size: 13px; }
  .group-header .count { opacity: 0.6; font-size: 11px; margin-left: auto; }
  .group-children { margin-left: 16px; border-left: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); padding-left: 4px; }
  .row { display: flex; flex-direction: column; padding: 4px 8px; border-radius: 4px; gap: 0; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row-normal { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; }
  .row.editing .row-normal { display: none; }
  .row-name { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
  .row-meta { font-size: 11px; opacity: 0.6; white-space: nowrap; }
  .actions { display: inline-flex; gap: 2px; }
  .actions button {
    background: transparent;
    color: var(--vscode-icon-foreground, var(--vscode-foreground));
    border: none;
    border-radius: 4px;
    padding: 3px 5px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  .actions button:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .row-edit-form { display: none; flex-direction: column; gap: 6px; padding: 4px 0; width: 100%; }
  .row.editing .row-edit-form { display: flex; }
  .row-edit-form input, .row-edit-form textarea {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent));
    border-radius: 4px;
    padding: 4px 8px;
    font-family: inherit;
    font-size: 12px;
    width: 100%;
    box-sizing: border-box;
    outline: none;
  }
  .row-edit-form textarea { resize: vertical; min-height: 64px; }
  .row-edit-actions { display: flex; gap: 6px; justify-content: flex-end; }
  .save-btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    padding: 3px 10px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
  }
  .save-btn:hover { background: var(--vscode-button-hoverBackground); }
  .cancel-btn {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px;
    padding: 3px 10px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    opacity: 0.7;
  }
  .cancel-btn:hover { background: var(--vscode-list-hoverBackground); opacity: 1; }
  .empty { opacity: 0.5; font-size: 12px; padding: 6px 8px; }
  .row[draggable="true"] { cursor: grab; }
  .row.dragging { opacity: 0.35; }
  .group-header.drag-over { background: var(--vscode-list-dropBackground, var(--vscode-list-hoverBackground)); outline: 2px dashed var(--vscode-focusBorder); border-radius: 4px; }
</style>
</head>
<body>
  <div class="title">Prompt Dock</div>
  <div id="app"></div>
  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    // Store which cards are EXPANDED — empty set means all collapsed on first open
    const expandedCards = new Set(JSON.parse((vscode.getState() && vscode.getState().expandedCards) || '[]'));
    const collapsedGroups = new Set(JSON.parse((vscode.getState() && vscode.getState().collapsedGroups) || '[]'));
    let state = null;

    function saveUiState() {
      vscode.setState({
        expandedCards: JSON.stringify([...expandedCards]),
        collapsedGroups: JSON.stringify([...collapsedGroups]),
      });
    }

    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    }

    function matches(text, query) {
      return !query || text.toLowerCase().includes(query.toLowerCase());
    }

    function renderRow(row) {
      const isTemplate = row.id && row.id.startsWith('template:');
      const isImported = row.id && row.id.startsWith('imported:');
      const r = el('div', 'row');

      // Normal view
      const normal = el('div', 'row-normal');
      const name = el('div', 'row-name', row.name);
      name.title = row.name;
      name.addEventListener('click', () => vscode.postMessage({ type: 'openDetail', id: row.id }));
      normal.appendChild(name);
      if (row.meta) normal.appendChild(el('div', 'row-meta', row.meta));

      const actions = el('div', 'actions');

      if (isImported) {
        const copyBtn = el('button', '', '⧉');
        copyBtn.title = 'Copy to Clipboard';
        copyBtn.addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ type: 'use', id: row.id, action: 'copy' }); });
        actions.appendChild(copyBtn);
      }

      if (isTemplate) {
        const delBtn = el('button', '', '🗑');
        delBtn.title = 'Move to Deleted folder';
        delBtn.addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ type: 'deleteTemplate', id: row.id }); });
        actions.appendChild(delBtn);

        r.setAttribute('draggable', 'true');
        r.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', row.id);
          e.dataTransfer.effectAllowed = 'move';
          setTimeout(() => r.classList.add('dragging'), 0);
        });
        r.addEventListener('dragend', () => r.classList.remove('dragging'));
      }

      normal.appendChild(actions);
      r.appendChild(normal);

      if (isTemplate) {
        const form = el('div', 'row-edit-form');

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = row.name;
        nameInput.placeholder = 'Template name';
        form.appendChild(nameInput);

        const contentArea = document.createElement('textarea');
        contentArea.value = row.content;
        contentArea.placeholder = 'Template content';
        form.appendChild(contentArea);

        const editActions = el('div', 'row-edit-actions');

        const saveBtn = el('button', 'save-btn', 'Save');
        saveBtn.title = 'Save changes to this template';
        saveBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'updateTemplate', id: row.id, name: nameInput.value, content: contentArea.value });
        });
        editActions.appendChild(saveBtn);

        const cancelBtn = el('button', 'cancel-btn', 'Cancel');
        cancelBtn.title = 'Discard changes';
        cancelBtn.addEventListener('click', () => r.classList.remove('editing'));
        editActions.appendChild(cancelBtn);

        form.appendChild(editActions);
        r.appendChild(form);
      }

      return r;
    }

    function renderGroup(groupKey, label, count, childrenBuilder) {
      const g = el('div', 'group' + (collapsedGroups.has(groupKey) ? ' collapsed' : ''));
      const header = el('div', 'group-header');
      header.appendChild(el('span', 'chevron', '▾'));
      header.appendChild(el('span', 'label', label));
      header.appendChild(el('span', 'count', String(count)));
      header.title = 'Click to expand or collapse';
      header.addEventListener('click', () => {
        g.classList.toggle('collapsed');
        if (g.classList.contains('collapsed')) collapsedGroups.add(groupKey); else collapsedGroups.delete(groupKey);
        saveUiState();
      });
      g.appendChild(header);
      const childrenEl = el('div', 'group-children');
      childrenBuilder(childrenEl);
      g.appendChild(childrenEl);
      return g;
    }

    function cardMatchesQuery(rows, query) {
      return !query || rows.some((r) => matches(r.name, query) || matches(r.content, query));
    }

    // Sub-group collapse-state keys that belong to one card, so expanding the card can also expand
    // everything nested inside it (folders for My Templates; projects+sessions for a source card).
    function groupPrefixesFor(sectionKey) {
      return sectionKey === 'templates'
        ? ['folder:']
        : ['project:' + sectionKey + ':', 'session:' + sectionKey + ':'];
    }

    function renderCardHeader(sectionKey, name, count) {
      const header = el('div', 'card-header');
      const left = el('div', 'left');
      left.appendChild(el('span', 'name', name));
      left.appendChild(el('span', 'count', String(count)));
      header.appendChild(left);
      if (sectionKey !== 'templates') {
        const syncBtn = el('button', 'card-sync-btn', 'Sync Prompts');
        syncBtn.title = 'Re-fetch prompts from this source';
        syncBtn.addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ type: 'sync', section: sectionKey }); });
        header.appendChild(syncBtn);
      }
      header.appendChild(el('span', 'toggle', '▾'));
      header.title = 'Click to expand or collapse';
      header.addEventListener('click', () => {
        const card = header.closest('.card');
        const wasCollapsed = card.classList.contains('collapsed');
        if (wasCollapsed) {
          expandedCards.add(sectionKey);
          const prefixes = groupPrefixesFor(sectionKey);
          for (const key of [...collapsedGroups]) {
            if (prefixes.some((p) => key.startsWith(p))) collapsedGroups.delete(key);
          }
          saveUiState();
          rerenderCard(sectionKey);
        } else {
          expandedCards.delete(sectionKey);
          card.classList.add('collapsed');
          saveUiState();
        }
      });
      return header;
    }

    function renderTemplatesCard(query) {
      const card = el('div', 'card' + (expandedCards.has('templates') ? '' : ' collapsed'));
      const header = renderCardHeader('templates', '⭐ My Templates', state.templates.unfiled.length + state.templates.folders.reduce((n, f) => n + f.templates.length + f.presets.length, 0));
      card.appendChild(header);

      const body = el('div', 'card-body');
      body.appendChild(renderToolbar('templates', query));

      let any = false;
      for (const folder of state.templates.folders) {
        const allRows = [...folder.presets, ...folder.templates];
        const filteredPresets = folder.presets.filter((r) => matches(r.name, query) || matches(r.content, query));
        const filteredTemplates = folder.templates.filter((r) => matches(r.name, query) || matches(r.content, query));
        if (query && filteredPresets.length === 0 && filteredTemplates.length === 0) continue;
        any = true;
        const groupEl = renderGroup('folder:' + folder.id, '📁 ' + folder.name, allRows.length, (c) => {
          for (const r of filteredPresets) c.appendChild(renderRow(r));
          for (const r of filteredTemplates) c.appendChild(renderRow(r));
        });
        const gh = groupEl.querySelector('.group-header');
        gh.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; gh.classList.add('drag-over'); });
        gh.addEventListener('dragleave', (e) => { if (!gh.contains(e.relatedTarget)) gh.classList.remove('drag-over'); });
        gh.addEventListener('drop', (e) => { e.preventDefault(); gh.classList.remove('drag-over'); const id = e.dataTransfer.getData('text/plain'); if (id && id.startsWith('template:')) vscode.postMessage({ type: 'moveTemplate', id, targetFolderId: folder.id }); });
        body.appendChild(groupEl);
      }
      const filteredUnfiled = state.templates.unfiled.filter((r) => matches(r.name, query) || matches(r.content, query));
      for (const r of filteredUnfiled) { body.appendChild(renderRow(r)); any = true; }
      if (!any) body.appendChild(el('div', 'empty', query ? 'No matches.' : 'No templates yet.'));

      card.appendChild(body);
      return card;
    }

    function renderSourceCard(source, query) {
      const card = el('div', 'card' + (expandedCards.has(source.source) ? '' : ' collapsed'));
      const header = renderCardHeader(source.source, source.icon + ' ' + source.label, source.count);
      card.appendChild(header);

      const body = el('div', 'card-body');
      body.appendChild(renderToolbar(source.source, query));

      let any = false;
      for (const project of source.projects) {
        const matchingSessions = project.sessions
          .map((s) => ({ session: s, prompts: s.prompts.filter((r) => matches(r.name, query) || matches(r.content, query)) }))
          .filter(({ prompts }) => !query || prompts.length > 0);
        if (matchingSessions.length === 0) continue;
        any = true;
        body.appendChild(renderGroup('project:' + source.source + ':' + project.name, '📁 ' + project.name, project.count, (c) => {
          for (const { session, prompts } of matchingSessions) {
            c.appendChild(renderGroup(
              'session:' + source.source + ':' + project.name + ':' + session.id,
              '💬 ' + session.title,
              session.count,
              (sc) => { for (const r of prompts) sc.appendChild(renderRow(r)); },
            ));
          }
        }));
      }
      if (!any) body.appendChild(el('div', 'empty', query ? 'No matches.' : 'Nothing imported yet.'));

      card.appendChild(body);
      return card;
    }

    function renderToolbar(sectionKey, currentQuery) {
      const container = el('div', 'toolbar-container');

      const bar = el('div', 'toolbar');
      const search = el('div', 'search');
      search.appendChild(el('span', '', '🔍'));
      const input = document.createElement('input');
      input.placeholder = 'Search Prompts';
      input.value = currentQuery || '';
      input.dataset.section = sectionKey;
      // Re-render only this one card, not the whole tree — with hundreds of imported prompts,
      // rebuilding every other card (and losing focus) on every keystroke doesn't scale.
      input.addEventListener('input', () => { queries[sectionKey] = input.value; rerenderCard(sectionKey); });
      search.appendChild(input);
      bar.appendChild(search);
      if (sectionKey === 'templates') {
        const newFolderBtn = el('button', 'new-window-btn', '📁');
        newFolderBtn.title = 'Create a new folder in My Templates';
        newFolderBtn.addEventListener('click', () => vscode.postMessage({ type: 'createFolder' }));
        bar.appendChild(newFolderBtn);
      }
      container.appendChild(bar);

      return container;
    }

    const queries = {};

    function buildCard(sectionKey) {
      const card = sectionKey === 'templates'
        ? renderTemplatesCard(queries['templates'])
        : renderSourceCard(state.sources.find((s) => s.source === sectionKey), queries[sectionKey]);
      card.dataset.sectionKey = sectionKey;
      return card;
    }

    function rerenderCard(sectionKey) {
      const existing = document.querySelector('.card[data-section-key="' + sectionKey + '"]');
      if (!existing) return render();

      const focused = document.activeElement;
      const wasFocused = focused && focused.tagName === 'INPUT' && focused.dataset.section === sectionKey;
      const caret = wasFocused ? focused.selectionStart : null;

      const fresh = buildCard(sectionKey);
      existing.replaceWith(fresh);

      if (wasFocused) {
        const input = fresh.querySelector('.search input');
        if (input) { input.focus(); if (caret !== null) input.setSelectionRange(caret, caret); }
      }
    }

    function render() {
      const app = document.getElementById('app');
      const focused = document.activeElement;
      const focusedSectionKey = focused && focused.tagName === 'INPUT' ? focused.dataset.section : null;
      const caret = focusedSectionKey ? focused.selectionStart : null;

      app.innerHTML = '';
      if (!state) { app.appendChild(el('div', 'empty', 'Loading…')); return; }
      app.appendChild(buildCard('templates'));
      for (const source of state.sources) app.appendChild(buildCard(source.source));

      if (focusedSectionKey) {
        const input = document.querySelector('input[data-section="' + focusedSectionKey + '"]');
        if (input) { input.focus(); if (caret !== null) input.setSelectionRange(caret, caret); }
      }
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'state') { state = msg.state; render(); }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

export class PromptDockWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly storage: Storage,
    private readonly onSync?: () => Promise<number>,
  ) {
    storage.onDidChange(() => this.postState());
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = renderHtml(webviewView.webview.cspSource);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === 'ready') {
        this.postState();
        return;
      }
      if (message?.type === 'use') {
        const row = findPromptById(this.storage, message.id);
        if (row) {
          await usePromptContent(row.name, row.content, message.action);
        }
        return;
      }
      if (message?.type === 'newWindow') {
        openSectionPanel(this.extensionUri, this.storage, message.section);
        return;
      }
      if (message?.type === 'sync') {
        vscode.window.setStatusBarMessage('PromptDock: Syncing prompts…', 2000);
        void this.onSync?.();
        return;
      }
      if (message?.type === 'deleteTemplate') {
        const rawId = (message.id as string).slice('template:'.length);
        const template = this.storage.getTemplates().find((t) => t.id === rawId);
        const deletedFolder = this.storage.getFolders().find((f) => f.name === 'Deleted');
        if (template && deletedFolder && template.folderId === deletedFolder.id) {
          await this.storage.deleteTemplate(rawId);
        } else {
          const folder = deletedFolder ?? await this.storage.createFolder('Deleted');
          await this.storage.updateTemplate(rawId, { folderId: folder.id });
        }
        return;
      }
      if (message?.type === 'updateTemplate') {
        const rawId = (message.id as string).slice('template:'.length);
        await this.storage.updateTemplate(rawId, { name: message.name, content: message.content });
        return;
      }
      if (message?.type === 'moveTemplate') {
        const rawId = (message.id as string).slice('template:'.length);
        await this.storage.updateTemplate(rawId, { folderId: message.targetFolderId as string });
        return;
      }
      if (message?.type === 'openDetail') {
        const id = message.id as string;
        if (id.startsWith('imported:')) {
          const source = id.slice('imported:'.length).split(':')[0] as PromptSource;
          openSectionPanel(this.extensionUri, this.storage, source, id);
        } else {
          openSectionPanel(this.extensionUri, this.storage, 'templates', id);
        }
        return;
      }
      if (message?.type === 'createFolder') {
        const name = await vscode.window.showInputBox({
          prompt: 'New folder name',
          placeHolder: 'e.g. My Prompts',
          validateInput: (v) => v.trim() ? null : 'Name cannot be empty',
        });
        if (name?.trim()) {
          await this.storage.createFolder(name.trim());
        }
        return;
      }
    });
  }

  private postState(): void {
    this.view?.webview.postMessage({ type: 'state', state: buildState(this.storage) });
  }
}

function renderPanelHtml(cspSource: string): string {
  const scriptNonce = nonce();
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 20px 24px 40px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  .section-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 18px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  }
  .section-title { font-size: 17px; font-weight: 700; }
  .badge {
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 10px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
  }
  .search-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 6px;
    padding: 6px 12px;
    margin-bottom: 20px;
  }
  .search-bar input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--vscode-input-foreground);
    font-family: inherit;
    font-size: 13px;
  }
  .search-bar-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    padding: 3px 6px;
    color: inherit;
    opacity: 0.6;
    white-space: nowrap;
    flex-shrink: 0;
    font-family: inherit;
  }
  .search-bar-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground); border-color: var(--vscode-widget-border, transparent); }
  .folder-section { margin-bottom: 20px; }
  .folder-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 4px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    cursor: pointer;
    user-select: none;
  }
  .folder-title:hover { background: var(--vscode-list-hoverBackground); border-radius: 4px; }
  .folder-title .chevron { font-size: 14px; min-width: 16px; text-align: center; transition: transform 0.15s ease; }
  .folder-title .folder-sync-btn {
    margin-left: auto;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    padding: 2px 6px;
    color: inherit;
    opacity: 0.55;
  }
  .folder-title .folder-sync-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground); border-color: var(--vscode-widget-border, transparent); }
  .folder-section.collapsed .chevron { transform: rotate(-90deg); }
  .folder-section.collapsed .folder-body { display: none; }
  .session-group { margin-bottom: 16px; }
  .session-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    opacity: 0.6;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .session-label .session-date { margin-left: auto; font-weight: 400; }
  .prompt-card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 8px;
    transition: border-color 0.1s ease;
  }
  .prompt-card:hover { border-color: var(--vscode-focusBorder); }
  .prompt-card.highlight { border-color: var(--vscode-focusBorder); box-shadow: 0 0 0 2px var(--vscode-focusBorder); }
  .prompt-content {
    font-size: 13px;
    line-height: 1.55;
    margin-bottom: 10px;
    white-space: pre-wrap;
    word-break: break-word;
    cursor: pointer;
  }
  .prompt-content:hover { color: var(--vscode-textLink-foreground); }
  .prompt-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .prompt-meta { font-size: 11px; opacity: 0.45; white-space: nowrap; }
  .prompt-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .action-btn {
    background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .action-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
  .action-btn.done {
    opacity: 0.75;
    cursor: not-allowed;
    color: var(--vscode-testing-iconPassed, #4ec9b0);
    border-color: var(--vscode-testing-iconPassed, #4ec9b0);
    background: transparent;
  }
  .action-btn.done:hover { background: transparent; }
  .action-btn:disabled { cursor: not-allowed; opacity: 0.45; }
  .action-btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent;
  }
  .action-btn.primary:hover { background: var(--vscode-button-hoverBackground); }
  .action-btn.action-btn-danger:hover { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-errorForeground, #f48771); border-color: var(--vscode-inputValidation-errorBorder, #be1100); }
  .empty { opacity: 0.5; font-size: 13px; padding: 24px 0; text-align: center; }
  .card-edit-form { display: none; flex-direction: column; gap: 6px; padding: 8px 0 4px; }
  .card-editing .card-edit-form { display: flex; }
  .card-editing .prompt-content { display: none; }
  .card-edit-form textarea {
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    box-sizing: border-box;
    color: var(--vscode-input-foreground);
    font: inherit;
    font-size: 12px;
    min-height: 80px;
    padding: 6px;
    resize: vertical;
    width: 100%;
  }
  .card-edit-actions { display: flex; gap: 6px; justify-content: flex-end; }
  .card-edit-save, .card-edit-cancel {
    background: transparent;
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 3px;
    color: var(--vscode-foreground);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    padding: 2px 8px;
  }
  .card-edit-save { border-color: var(--vscode-button-background); color: var(--vscode-button-background); }
  .card-edit-cancel:hover, .card-edit-save:hover { opacity: 0.8; }
</style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    let state = null;
    let sectionKey = null;
    let query = '';

    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    }

    function matches(text, q) {
      return !q || text.toLowerCase().includes(q.toLowerCase());
    }

    function scrollToPrompt(promptId) {
      document.querySelectorAll('.folder-section.collapsed').forEach((s) => s.classList.remove('collapsed'));
      requestAnimationFrame(() => {
        document.querySelectorAll('.prompt-card.highlight').forEach((c) => c.classList.remove('highlight'));
        const card = document.querySelector('[data-prompt-id="' + promptId + '"]');
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        card.classList.add('highlight');
      });
    }

    function renderPromptCard(row) {
      const card = el('div', 'prompt-card');
      card.dataset.promptId = row.id;
      card.dataset.content = row.content;

      const content = el('div', 'prompt-content', row.content);
      content.title = 'Click to copy & insert at cursor';
      content.addEventListener('click', () => vscode.postMessage({ type: 'use', id: row.id, action: 'default', content: card.dataset.content }));
      card.appendChild(content);

      // Inline edit form
      const editForm = el('div', 'card-edit-form');
      const editArea = document.createElement('textarea');
      editArea.value = row.content;
      editForm.appendChild(editArea);
      const editActions = el('div', 'card-edit-actions');
      const saveBtn = el('button', 'card-edit-save', 'Save');
      saveBtn.title = 'Apply edits to this card';
      saveBtn.addEventListener('click', () => {
        const newContent = editArea.value.trim();
        if (newContent) {
          card.dataset.content = newContent;
          content.textContent = newContent;
        }
        card.classList.remove('card-editing');
        addedPromptIds.delete(row.id);
      });
      const cancelBtn = el('button', 'card-edit-cancel', 'Cancel');
      cancelBtn.title = 'Discard edits';
      cancelBtn.addEventListener('click', () => { editArea.value = card.dataset.content; card.classList.remove('card-editing'); });
      editActions.appendChild(saveBtn);
      editActions.appendChild(cancelBtn);
      editForm.appendChild(editActions);
      card.appendChild(editForm);

      const footer = el('div', 'prompt-footer');
      footer.appendChild(el('div', 'prompt-meta', row.meta || ''));

      const actions = el('div', 'prompt-actions');

      function makeBtn(cls, icon, label) {
        const b = document.createElement('button');
        b.className = cls;
        const i = el('span', 'btn-icon', icon);
        const t = el('span', '', label);
        b.appendChild(i); b.appendChild(t);
        return b;
      }

      const copyBtn = makeBtn('action-btn', '⎘', 'Copy');
      copyBtn.title = 'Copy prompt to clipboard';
      copyBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'use', id: row.id, action: 'copy', content: card.dataset.content });
      });

      const alreadyTemplate = row.id.startsWith('template:') || row.id.startsWith('preset:');
      if (!alreadyTemplate) {
        const isAdded = addedPromptIds.has(row.id);
        const insertBtn = makeBtn(isAdded ? 'action-btn done' : 'action-btn', isAdded ? '✓' : '+', isAdded ? '' : 'Add');
        insertBtn.title = isAdded ? 'Already added to My Templates' : 'Save this prompt to My Templates';
        insertBtn.disabled = isAdded;
        if (!isAdded) {
          insertBtn.addEventListener('click', () => {
            addedPromptIds.add(row.id);
            vscode.postMessage({ type: 'addTemplate', id: row.id, content: card.dataset.content });
            insertBtn.disabled = true;
            insertBtn.querySelector('.btn-icon').textContent = '✓';
            insertBtn.querySelector('span:last-child').textContent = '';
            insertBtn.className = 'action-btn done';
            insertBtn.title = 'Already added to My Templates';
          });
        }
        actions.appendChild(insertBtn);
      }

      const editBtn = makeBtn('action-btn', '✎', 'Edit');
      editBtn.title = 'Edit prompt text';
      editBtn.addEventListener('click', () => { editArea.value = card.dataset.content; card.classList.toggle('card-editing'); });

      actions.appendChild(copyBtn);
      if (row.id.startsWith('template:')) {
        const delBtn = makeBtn('action-btn action-btn-danger', '🗑', 'Delete');
        delBtn.title = 'Delete this template';
        delBtn.addEventListener('click', () => vscode.postMessage({ type: 'deleteTemplate', id: row.id }));
        actions.appendChild(delBtn);
      }
      actions.appendChild(editBtn);
      footer.appendChild(actions);
      card.appendChild(footer);
      return card;
    }

    function renderFolderSection(icon, title, rows, key) {
      const section = el('div', 'folder-section' + (expandedSections.has(key) ? '' : ' collapsed'));

      const titleEl = el('div', 'folder-title');
      titleEl.title = 'Click to expand or collapse';
      titleEl.appendChild(el('span', 'chevron', '▾'));
      titleEl.appendChild(el('span', '', icon + ' ' + title));
      titleEl.appendChild(el('span', 'badge', String(rows.length)));
      titleEl.addEventListener('click', () => {
        section.classList.toggle('collapsed');
        if (section.classList.contains('collapsed')) expandedSections.delete(key); else expandedSections.add(key);
      });
      section.appendChild(titleEl);

      const body = el('div', 'folder-body');
      const filtered = rows.filter((r) => matches(r.name, query) || matches(r.content, query));
      if (filtered.length === 0) {
        body.appendChild(el('div', 'empty', query ? 'No matching prompts.' : 'No prompts here.'));
      } else {
        for (const r of filtered) body.appendChild(renderPromptCard(r));
      }
      section.appendChild(body);
      return section;
    }

    function renderSessionGroup(session, rows) {
      const g = el('div', 'session-group');

      const label = el('div', 'session-label');
      label.appendChild(el('span', '', '💬 ' + session.title));
      label.appendChild(el('span', 'session-date', new Date(session.lastActivity).toLocaleDateString()));
      g.appendChild(label);

      if (rows.length === 0) {
        g.appendChild(el('div', 'empty', 'No matching prompts.'));
      } else {
        for (const r of rows) g.appendChild(renderPromptCard(r));
      }
      return g;
    }

    const addedPromptIds = new Set();
    const expandedSections = new Set();

    function render() {
      const app = document.getElementById('app');
      app.innerHTML = '';
      if (!state) { app.appendChild(el('div', 'empty', 'Loading…')); return; }

      const searchBar = el('div', 'search-bar');
      searchBar.appendChild(el('span', '', '🔍'));
      const input = document.createElement('input');
      input.placeholder = 'Search prompts…';
      input.value = query;
      input.addEventListener('input', () => { query = input.value; render(); });
      searchBar.appendChild(input);
      const expandAllBtn = el('button', 'search-bar-btn', 'Expand All');
      expandAllBtn.title = 'Expand all folders';
      expandAllBtn.addEventListener('click', () => {
        if (sectionKey === 'templates') {
          for (const folder of state.templates.folders) expandedSections.add('folder:' + folder.id);
          if (state.templates.unfiled.length > 0) expandedSections.add('unfiled');
        } else {
          const source = state.sources.find((s) => s.source === sectionKey);
          if (source) for (const project of source.projects) expandedSections.add('project:' + project.name);
        }
        render();
      });
      searchBar.appendChild(expandAllBtn);

      if (sectionKey === 'templates') {
        const total = state.templates.unfiled.length + state.templates.folders.reduce((n, f) => n + f.templates.length + f.presets.length, 0);
        const header = el('div', 'section-header');
        header.appendChild(el('span', 'section-title', '⭐ My Templates'));
        header.appendChild(el('span', 'badge', String(total)));
        app.appendChild(header);
        app.appendChild(searchBar);

        for (const folder of state.templates.folders) {
          const rows = [...folder.presets, ...folder.templates];
          app.appendChild(renderFolderSection('📁', folder.name, rows, 'folder:' + folder.id));
        }
        if (state.templates.unfiled.length > 0) {
          app.appendChild(renderFolderSection('📄', 'Unfiled', state.templates.unfiled, 'unfiled'));
        }
      } else {
        const source = state.sources.find((s) => s.source === sectionKey);
        if (!source) return;

        const header = el('div', 'section-header');
        header.appendChild(el('span', 'section-title', source.icon + ' ' + source.label));
        header.appendChild(el('span', 'badge', String(source.count)));
        app.appendChild(header);
        app.appendChild(searchBar);

        let any = false;
        for (const project of source.projects) {
          const projectKey = 'project:' + project.name;
          const projectSection = el('div', 'folder-section' + (expandedSections.has(projectKey) ? '' : ' collapsed'));

          const projectTitle = el('div', 'folder-title');
          projectTitle.title = 'Click to expand or collapse';
          projectTitle.appendChild(el('span', 'chevron', '▾'));
          projectTitle.appendChild(el('span', '', '📁 ' + project.name));
          projectTitle.appendChild(el('span', 'badge', String(project.count)));
          const folderSyncBtn = el('button', 'folder-sync-btn', '↻');
          folderSyncBtn.title = 'Sync prompts from ' + (source ? source.label : 'this source');
          folderSyncBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'sync', section: sectionKey });
          });
          projectTitle.appendChild(folderSyncBtn);
          projectTitle.addEventListener('click', () => {
            projectSection.classList.toggle('collapsed');
            if (projectSection.classList.contains('collapsed')) expandedSections.delete(projectKey); else expandedSections.add(projectKey);
          });
          projectSection.appendChild(projectTitle);

          const projectBody = el('div', 'folder-body');
          let projectHasMatch = false;
          for (const session of project.sessions) {
            const filtered = session.prompts.filter((r) => matches(r.name, query) || matches(r.content, query));
            if (query && filtered.length === 0) continue;
            projectHasMatch = true;
            projectBody.appendChild(renderSessionGroup(session, filtered));
          }
          if (!projectHasMatch) {
            if (query) continue;
            projectBody.appendChild(el('div', 'empty', 'No prompts here.'));
          }
          projectSection.appendChild(projectBody);
          app.appendChild(projectSection);
          any = true;
        }
        if (!any) app.appendChild(el('div', 'empty', query ? 'No matching prompts.' : 'Nothing imported yet.'));
      }

      if (query) input.focus();
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'state') {
        state = msg.state;
        sectionKey = msg.section;
        render();
        if (msg.scrollTo) scrollToPrompt(msg.scrollTo);
      }
      if (msg.type === 'scrollTo') scrollToPrompt(msg.promptId);
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

let sharedSectionPanel: vscode.WebviewPanel | undefined;
let sharedSectionCurrentSection = 'templates';

/** Opens the shared detached webview panel. Reuses the existing panel and switches its section if already open. */
function openSectionPanel(extensionUri: vscode.Uri, storage: Storage, section: string, scrollToId?: string): void {
  const sectionChanged = section !== sharedSectionCurrentSection;
  sharedSectionCurrentSection = section;
  const panelTitle = `PromptDock: ${section === 'templates' ? 'My Templates' : SOURCE_LABELS[section as PromptSource]}`;

  if (sharedSectionPanel) {
    sharedSectionPanel.title = panelTitle;
    sharedSectionPanel.reveal(undefined, true);
    if (sectionChanged) sharedSectionPanel.webview.postMessage({ type: 'state', state: buildState(storage), section });
    if (scrollToId) sharedSectionPanel.webview.postMessage({ type: 'scrollTo', promptId: scrollToId });
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'promptdock.section',
    panelTitle,
    vscode.ViewColumn.Beside,
    { enableScripts: true, localResourceRoots: [extensionUri], retainContextWhenHidden: true },
  );
  sharedSectionPanel = panel;
  panel.webview.html = renderPanelHtml(panel.webview.cspSource);

  const post = () => panel.webview.postMessage({ type: 'state', state: buildState(storage), section: sharedSectionCurrentSection });
  post();
  if (scrollToId) panel.webview.postMessage({ type: 'scrollTo', promptId: scrollToId });
  const changeListener = storage.onDidChange(post);
  panel.onDidDispose(() => { changeListener.dispose(); sharedSectionPanel = undefined; });

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.type === 'use') {
      const base = findPromptById(storage, message.id);
      if (base) {
        const content = (message.content as string | undefined) ?? base.content;
        await usePromptContent(base.name, content, message.action);
      }
      return;
    }
    if (message?.type === 'addTemplate') {
      const base = findPromptById(storage, message.id);
      if (base) {
        const content = (message.content as string | undefined) ?? base.content;
        const isDuplicate = storage.getTemplates().some((t) => t.name === base.name && t.content === content);
        if (isDuplicate) {
          vscode.window.setStatusBarMessage(`PromptDock: "${base.name}" is already in My Templates`, 3000);
          return;
        }
        let folderId: string | undefined;
        if (sharedSectionCurrentSection !== 'templates') {
          const folderName = SOURCE_LABELS[sharedSectionCurrentSection as PromptSource];
          let folder = storage.getFolders().find((f) => f.name === folderName);
          if (!folder) {
            folder = await storage.createFolder(folderName);
          }
          folderId = folder.id;
        }
        await storage.createTemplate(base.name, content, folderId);
        vscode.window.setStatusBarMessage(`PromptDock: "${base.name}" added to My Templates`, 3000);
      }
      return;
    }
    if (message?.type === 'deleteTemplate') {
      const rawId = (message.id as string).replace(/^template:/, '');
      await storage.deleteTemplate(rawId);
      return;
    }
    if (message?.type === 'sync') {
      post();
      vscode.window.setStatusBarMessage('PromptDock: Prompts synced', 2000);
    }
  });
}
