import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { FileStat, Storage } from './storage';
import { ImportedPrompt, PromptSource, SOURCE_LABELS } from './types';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const NAME_MAX_LENGTH = 60;
const UNKNOWN_PROJECT = 'Unknown';

/**
 * Tracks (mtime, size) per scanned file so unchanged files can be skipped entirely on the next sync,
 * instead of re-reading and re-parsing every line again. Session files are effectively append-only,
 * so "unchanged on disk" reliably means "nothing new in this file" — safe to skip.
 */
export class FileScanCache {
  private readonly updates: Record<string, FileStat> = {};

  constructor(private readonly previous: Record<string, FileStat>) {}

  /** Stats the file; returns true if it can be skipped (unchanged since last scan, or too large). */
  async shouldSkip(filePath: string): Promise<boolean> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return true;
    }
    if (stat.size > MAX_FILE_BYTES) {
      return true;
    }
    const current: FileStat = { mtimeMs: stat.mtimeMs, size: stat.size };
    this.updates[filePath] = current;
    const cached = this.previous[filePath];
    return cached !== undefined && cached.mtimeMs === current.mtimeMs && cached.size === current.size;
  }

  /** Merges this scan's updates on top of the previous stats (files not touched this run are kept). */
  toMergedStats(): Record<string, FileStat> {
    return { ...this.previous, ...this.updates };
  }
}

function toName(text: string): string {
  const singleLine = text.trim().replace(/\s+/g, ' ');
  return singleLine.length > NAME_MAX_LENGTH ? `${singleLine.slice(0, NAME_MAX_LENGTH - 1)}…` : singleLine;
}

/** Cross-platform basename: `path.win32` splits on both `/` and `\`, so it handles POSIX paths too. */
export function folderName(rawPath: string | undefined | null): string {
  if (!rawPath) {
    return UNKNOWN_PROJECT;
  }
  const base = path.win32.basename(rawPath.trim());
  return base || UNKNOWN_PROJECT;
}

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      return null;
    }
    return await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function readDirSafe(dirPath: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(dirPath);
  } catch {
    return [];
  }
}

/** Parses one line of a Claude Code session transcript (~/.claude/projects/*\/*.jsonl). */
export function parseClaudeCodeLine(
  line: string,
): { id: string; text: string; timestamp: number; cwd?: string; sessionId: string } | null {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (obj?.type !== 'user' || obj?.origin?.kind !== 'human' || obj?.message?.role !== 'user' || !obj.uuid) {
    return null;
  }
  const content = obj.message.content;
  const text = Array.isArray(content)
    ? content
        .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
        .map((c: any) => c.text)
        .join('\n')
    : typeof content === 'string'
      ? content
      : '';
  if (!text.trim()) {
    return null;
  }
  const timestamp = Date.parse(obj.timestamp);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  const sessionId: string = obj.sessionId ?? 'unknown';
  return {
    id: `claude-code:${sessionId}:${obj.uuid}`,
    text,
    timestamp,
    cwd: typeof obj.cwd === 'string' ? obj.cwd : undefined,
    sessionId,
  };
}

/**
 * Best-effort extraction of a user prompt from a VS Code chat request object.
 * The chat storage format is undocumented and may change between VS Code versions.
 */
export function extractCopilotRequestText(request: any): string | null {
  if (!request) {
    return null;
  }
  const message = request.message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }
  if (typeof message?.text === 'string' && message.text.trim()) {
    return message.text;
  }
  if (Array.isArray(message?.parts)) {
    const text = message.parts
      .map((p: any) => (typeof p?.text === 'string' ? p.text : typeof p?.value === 'string' ? p.value : ''))
      .join('')
      .trim();
    if (text) {
      return text;
    }
  }
  if (typeof request.text === 'string' && request.text.trim()) {
    return request.text;
  }
  return null;
}

/** Resolves a workspaceStorage folder's project display name from its sibling workspace.json. */
export function resolveWorkspaceProjectName(workspaceJsonContent: string | null): string {
  if (!workspaceJsonContent) {
    return UNKNOWN_PROJECT;
  }
  try {
    const data = JSON.parse(workspaceJsonContent);
    const folderUri: string | undefined = data.folder ?? data.workspace;
    if (!folderUri) {
      return UNKNOWN_PROJECT;
    }
    const decoded = decodeURIComponent(folderUri).replace(/^[a-z0-9.+-]+:\/\//i, '');
    return folderName(decoded);
  } catch {
    return UNKNOWN_PROJECT;
  }
}

/**
 * Best-effort extraction of a user-typed message from a Codex CLI rollout JSONL line.
 * Codex's on-disk format has changed across versions and isn't officially documented,
 * so this tries several known/plausible shapes rather than relying on one.
 */
export function extractCodexUserText(obj: any): string | null {
  if (!obj || typeof obj !== 'object') {
    return null;
  }

  const fromContentBlocks = (content: unknown): string | null => {
    if (!Array.isArray(content)) {
      return null;
    }
    const text = content
      .filter((c: any) => typeof c?.text === 'string')
      .map((c: any) => c.text)
      .join('\n')
      .trim();
    return text || null;
  };

  // Current format: {type:"response_item", payload:{type:"message", role:"user", content:[{type:"input_text", text:"..."}]}}
  if (obj.type === 'response_item' && obj.payload?.type === 'message' && obj.payload?.role === 'user') {
    const text = fromContentBlocks(obj.payload.content);
    if (text) {
      return text;
    }
  }

  // Alternate format: {type:"event_msg", payload:{type:"user_message", message:"..."}}
  if (obj.type === 'event_msg' && obj.payload?.type === 'user_message' && typeof obj.payload?.message === 'string') {
    const text = obj.payload.message.trim();
    if (text) {
      return text;
    }
  }

  // Older/flat format: {type:"message", role:"user", content:[...] | "..."}
  if (obj.type === 'message' && obj.role === 'user') {
    const text = fromContentBlocks(obj.content);
    if (text) {
      return text;
    }
    if (typeof obj.content === 'string' && obj.content.trim()) {
      return obj.content.trim();
    }
  }

  return null;
}

export function parseCodexLine(line: string): { text: string; timestamp: number } | null {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  const text = extractCodexUserText(obj);
  if (!text) {
    return null;
  }
  const timestamp = Date.parse(obj.timestamp);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return { text, timestamp };
}

/** Best-effort search for a working-directory hint anywhere in a Codex rollout line's JSON. */
export function extractCodexCwd(obj: any): string | undefined {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }
  const candidates = [obj.cwd, obj.payload?.cwd, obj.payload?.cwd_path, obj.payload?.workspace];
  const found = candidates.find((c) => typeof c === 'string' && c.trim());
  return found;
}

async function findCodexSessionFiles(): Promise<string[]> {
  const files: string[] = [];
  const root = path.join(os.homedir(), '.codex', 'sessions');
  for (const year of await readDirSafe(root)) {
    const yearPath = path.join(root, year);
    for (const month of await readDirSafe(yearPath)) {
      const monthPath = path.join(yearPath, month);
      for (const day of await readDirSafe(monthPath)) {
        const dayPath = path.join(monthPath, day);
        for (const entry of await readDirSafe(dayPath)) {
          if (entry.endsWith('.jsonl')) {
            files.push(path.join(dayPath, entry));
          }
        }
      }
    }
  }
  return files;
}

export async function scanCodexPrompts(
  alreadyImported: ReadonlySet<string>,
  cache: FileScanCache,
): Promise<ImportedPrompt[]> {
  const results: ImportedPrompt[] = [];
  const files = await findCodexSessionFiles();

  for (const filePath of files) {
    if (await cache.shouldSkip(filePath)) {
      continue;
    }
    const content = await readFileSafe(filePath);
    if (!content) {
      continue;
    }
    const lines = content.split('\n').filter((l) => l.trim());

    let cwd: string | undefined;
    for (const line of lines) {
      try {
        const found = extractCodexCwd(JSON.parse(line));
        if (found) {
          cwd = found;
          break;
        }
      } catch {
        // ignore malformed lines during the cwd pre-scan
      }
    }
    const project = folderName(cwd);

    lines.forEach((line, index) => {
      const parsed = parseCodexLine(line);
      if (!parsed) {
        return;
      }
      const id = `codex:${filePath}:${index}`;
      if (alreadyImported.has(id)) {
        return;
      }
      results.push({
        id,
        name: toName(parsed.text),
        content: parsed.text,
        usedAt: parsed.timestamp,
        source: 'codex',
        project,
        sessionId: filePath,
      });
    });
  }
  return results;
}

export async function scanClaudeCodePrompts(
  alreadyImported: ReadonlySet<string>,
  cache: FileScanCache,
): Promise<ImportedPrompt[]> {
  const results: ImportedPrompt[] = [];
  const root = path.join(os.homedir(), '.claude', 'projects');
  const projectDirs = await readDirSafe(root);

  for (const projectDir of projectDirs) {
    const projectPath = path.join(root, projectDir);
    const entries = await readDirSafe(projectPath);
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) {
        continue;
      }
      const filePath = path.join(projectPath, entry);
      if (await cache.shouldSkip(filePath)) {
        continue;
      }
      const content = await readFileSafe(filePath);
      if (!content) {
        continue;
      }
      for (const line of content.split('\n')) {
        if (!line.trim()) {
          continue;
        }
        const parsed = parseClaudeCodeLine(line);
        if (!parsed || alreadyImported.has(parsed.id)) {
          continue;
        }
        results.push({
          id: parsed.id,
          name: toName(parsed.text),
          content: parsed.text,
          usedAt: parsed.timestamp,
          source: 'claude-code',
          project: folderName(parsed.cwd),
          sessionId: parsed.sessionId,
        });
      }
    }
  }
  return results;
}

export async function scanCopilotChatPrompts(
  vsCodeUserDir: string,
  alreadyImported: ReadonlySet<string>,
  cache: FileScanCache,
): Promise<ImportedPrompt[]> {
  const results: ImportedPrompt[] = [];
  const workspaceStorageDir = path.join(vsCodeUserDir, 'workspaceStorage');
  const workspaceDirs = await readDirSafe(workspaceStorageDir);

  for (const wsDir of workspaceDirs) {
    const wsDirPath = path.join(workspaceStorageDir, wsDir);
    const project = resolveWorkspaceProjectName(await readFileSafe(path.join(wsDirPath, 'workspace.json')));

    const chatSessionsDir = path.join(wsDirPath, 'chatSessions');
    const files = await readDirSafe(chatSessionsDir);
    for (const file of files) {
      if (!file.endsWith('.jsonl') && !file.endsWith('.json')) {
        continue;
      }
      const filePath = path.join(chatSessionsDir, file);
      if (await cache.shouldSkip(filePath)) {
        continue;
      }
      const content = await readFileSafe(filePath);
      if (!content) {
        continue;
      }
      let data: any;
      try {
        const firstLine = content.trimStart().split('\n')[0];
        const parsed = JSON.parse(firstLine);
        data = parsed?.v ?? parsed;
      } catch {
        continue;
      }
      const requests: any[] = Array.isArray(data?.requests) ? data.requests : [];
      const fallbackTimestamp = typeof data?.lastMessageDate === 'number' ? data.lastMessageDate : Date.now();
      const sessionId: string = data.sessionId ?? file;
      requests.forEach((request, index) => {
        const text = extractCopilotRequestText(request);
        if (!text) {
          return;
        }
        const id = `copilot-chat:${sessionId}:${request.requestId ?? index}`;
        if (alreadyImported.has(id)) {
          return;
        }
        const timestamp = typeof request.timestamp === 'number' ? request.timestamp : fallbackTimestamp;
        results.push({ id, name: toName(text), content: text, usedAt: timestamp, source: 'copilot-chat', project, sessionId });
      });
    }
  }
  return results;
}

function summarizeByDate(candidates: ImportedPrompt[]): string {
  const byDate = new Map<string, Map<PromptSource, number>>();
  for (const c of candidates) {
    const date = new Date(c.usedAt).toISOString().slice(0, 10);
    const bySource = byDate.get(date) ?? new Map<PromptSource, number>();
    bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1);
    byDate.set(date, bySource);
  }
  return [...byDate.keys()]
    .sort()
    .reverse()
    .map((date) => {
      const bySource = byDate.get(date)!;
      const total = [...bySource.values()].reduce((a, b) => a + b, 0);
      const bySourceText = [...bySource.entries()].map(([source, count]) => `${count} ${SOURCE_LABELS[source]}`).join(', ');
      return `  ${date}: ${total} (${bySourceText})`;
    })
    .join('\n');
}

/** Scans Claude Code, Copilot Chat, and Codex's local history and imports any new prompts, grouped by project. */
export async function syncExternalPrompts(
  context: vscode.ExtensionContext,
  storage: Storage,
  outputChannel: vscode.OutputChannel,
): Promise<number> {
  try {
    const alreadyImported = storage.getImportedExternalIds();
    const vsCodeUserDir = path.join(context.globalStorageUri.fsPath, '..', '..');
    const cache = new FileScanCache(storage.getFileScanStats());

    const [claudeCode, copilot, codex] = await Promise.all([
      scanClaudeCodePrompts(alreadyImported, cache),
      scanCopilotChatPrompts(vsCodeUserDir, alreadyImported, cache),
      scanCodexPrompts(alreadyImported, cache),
    ]);
    const found = [...claudeCode, ...copilot, ...codex];

    const imported = await storage.importExternalPrompts(found);
    await storage.setFileScanStats(cache.toMergedStats());
    const now = new Date().toISOString();

    if (imported > 0) {
      const importedCandidates = found.filter((c) => !alreadyImported.has(c.id)).slice(0, imported);
      outputChannel.appendLine(`[${now}] Delta sync — ${imported} new prompt(s) imported:`);
      outputChannel.appendLine(summarizeByDate(importedCandidates));
      vscode.window.setStatusBarMessage(
        `PromptDock: Imported ${imported} prompt(s) from Claude Code / Copilot Chat / Codex`,
        5000,
      );
    } else {
      outputChannel.appendLine(`[${now}] Delta sync — no new prompts found (Claude Code, Copilot Chat, Codex).`);
    }
    return imported;
  } catch (err) {
    outputChannel.appendLine(`[${new Date().toISOString()}] Delta sync failed: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}
