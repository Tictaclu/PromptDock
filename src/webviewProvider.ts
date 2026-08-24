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
  .card.collapsed .toggle { transform: rotate(-90deg); }
  .card-body { padding: 8px; }
  .card.collapsed .card-body { display: none; }
  .toolbar { display: flex; align-items: center; gap: 6px; padding: 0 2px 8px; }
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
    border: none;
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    font-size: 12px;
    padding: 4px 6px;
    white-space: nowrap;
  }
  .new-window-btn:hover { text-decoration: underline; }
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
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 4px;
  }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row .row-name { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
  .row .row-meta { font-size: 11px; opacity: 0.6; white-space: nowrap; }
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
  .empty { opacity: 0.5; font-size: 12px; padding: 6px 8px; }
</style>
</head>
<body>
  <div class="title">Prompt Dock</div>
  <div id="app"></div>
  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    const collapsedCards = new Set(JSON.parse((vscode.getState() && vscode.getState().collapsedCards) || '[]'));
    const collapsedGroups = new Set(JSON.parse((vscode.getState() && vscode.getState().collapsedGroups) || '[]'));
    let state = null;

    function saveUiState() {
      vscode.setState({
        collapsedCards: JSON.stringify([...collapsedCards]),
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
      const r = el('div', 'row');
      const name = el('div', 'row-name', row.name);
      name.title = row.content;
      name.addEventListener('click', () => vscode.postMessage({ type: 'use', id: row.id, action: 'default' }));
      r.appendChild(name);
      if (row.meta) r.appendChild(el('div', 'row-meta', row.meta));
      const actions = el('div', 'actions');
      const copyBtn = el('button', '', '⧉');
      copyBtn.title = 'Copy to Clipboard';
      copyBtn.addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ type: 'use', id: row.id, action: 'copy' }); });
      actions.appendChild(copyBtn);
      r.appendChild(actions);
      return r;
    }

    function renderGroup(groupKey, label, count, childrenBuilder) {
      const g = el('div', 'group' + (collapsedGroups.has(groupKey) ? ' collapsed' : ''));
      const header = el('div', 'group-header');
      header.appendChild(el('span', 'chevron', '▾'));
      header.appendChild(el('span', 'label', label));
      header.appendChild(el('span', 'count', String(count)));
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
      header.appendChild(el('span', 'toggle', '▾'));
      header.addEventListener('click', () => {
        const card = header.closest('.card');
        const wasCollapsed = card.classList.contains('collapsed');
        if (wasCollapsed) {
          collapsedCards.delete(sectionKey);
          const prefixes = groupPrefixesFor(sectionKey);
          for (const key of [...collapsedGroups]) {
            if (prefixes.some((p) => key.startsWith(p))) collapsedGroups.delete(key);
          }
          saveUiState();
          rerenderCard(sectionKey);
        } else {
          collapsedCards.add(sectionKey);
          card.classList.add('collapsed');
          saveUiState();
        }
      });
      return header;
    }

    function renderTemplatesCard(query) {
      const card = el('div', 'card' + (collapsedCards.has('templates') ? ' collapsed' : ''));
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
        body.appendChild(renderGroup('folder:' + folder.id, '📁 ' + folder.name, allRows.length, (c) => {
          for (const r of filteredPresets) c.appendChild(renderRow(r));
          for (const r of filteredTemplates) c.appendChild(renderRow(r));
        }));
      }
      const filteredUnfiled = state.templates.unfiled.filter((r) => matches(r.name, query) || matches(r.content, query));
      for (const r of filteredUnfiled) { body.appendChild(renderRow(r)); any = true; }
      if (!any) body.appendChild(el('div', 'empty', query ? 'No matches.' : 'No templates yet.'));

      card.appendChild(body);
      return card;
    }

    function renderSourceCard(source, query) {
      const card = el('div', 'card' + (collapsedCards.has(source.source) ? ' collapsed' : ''));
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
      const newWindowBtn = el('button', 'new-window-btn', '+ New Session');
      newWindowBtn.addEventListener('click', () => vscode.postMessage({ type: 'newWindow', section: sectionKey }));
      bar.appendChild(newWindowBtn);
      return bar;
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
      }
    });
  }

  private postState(): void {
    this.view?.webview.postMessage({ type: 'state', state: buildState(this.storage) });
  }
}

/** Opens a single section (My Templates, or one source) as its own detached webview panel/tab. */
function openSectionPanel(extensionUri: vscode.Uri, storage: Storage, section: string): void {
  const panel = vscode.window.createWebviewPanel(
    'promptdock.section',
    `PromptDock: ${section === 'templates' ? 'My Templates' : SOURCE_LABELS[section as PromptSource]}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, localResourceRoots: [extensionUri], retainContextWhenHidden: true },
  );
  panel.webview.html = renderHtml(panel.webview.cspSource);

  const post = () => panel.webview.postMessage({ type: 'state', state: buildState(storage) });
  post();
  const changeListener = storage.onDidChange(post);
  panel.onDidDispose(() => changeListener.dispose());

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.type === 'use') {
      const row = findPromptById(storage, message.id);
      if (row) {
        await usePromptContent(row.name, row.content, message.action);
      }
    }
  });
}
