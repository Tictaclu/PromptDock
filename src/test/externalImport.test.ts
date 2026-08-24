import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  extractCodexCwd,
  extractCodexUserText,
  extractCopilotRequestText,
  FileScanCache,
  folderName,
  parseClaudeCodeLine,
  parseCodexLine,
  resolveWorkspaceProjectName,
} from '../externalImport';

suite('parseClaudeCodeLine', () => {
  test('extracts text from a human-authored user turn', () => {
    const line = JSON.stringify({
      type: 'user',
      origin: { kind: 'human' },
      message: { role: 'user', content: [{ type: 'text', text: 'catch up this project' }] },
      uuid: 'abc-123',
      sessionId: 'session-1',
      timestamp: '2026-08-23T05:58:07.523Z',
    });

    const result = parseClaudeCodeLine(line);

    assert.ok(result);
    assert.strictEqual(result!.text, 'catch up this project');
    assert.strictEqual(result!.id, 'claude-code:session-1:abc-123');
    assert.strictEqual(result!.timestamp, Date.parse('2026-08-23T05:58:07.523Z'));
    assert.strictEqual(result!.sessionId, 'session-1');
  });

  test('falls back to "unknown" sessionId when sessionId is missing', () => {
    const line = JSON.stringify({
      type: 'user',
      origin: { kind: 'human' },
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      uuid: 'abc-127',
      timestamp: '2026-08-23T05:58:07.523Z',
    });

    assert.strictEqual(parseClaudeCodeLine(line)!.sessionId, 'unknown');
  });

  test('extracts the cwd field when present', () => {
    const line = JSON.stringify({
      type: 'user',
      origin: { kind: 'human' },
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      uuid: 'abc-126',
      sessionId: 'session-1',
      timestamp: '2026-08-23T05:58:07.523Z',
      cwd: 'd:\\AI\\PromptDock',
    });

    assert.strictEqual(parseClaudeCodeLine(line)!.cwd, 'd:\\AI\\PromptDock');
  });

  test('ignores synthetic tool-result user turns (origin.kind !== human)', () => {
    const line = JSON.stringify({
      type: 'user',
      origin: { kind: 'tool_result' },
      message: { role: 'user', content: [{ type: 'tool_result', text: 'irrelevant' }] },
      uuid: 'abc-124',
      sessionId: 'session-1',
      timestamp: '2026-08-23T05:58:07.523Z',
    });

    assert.strictEqual(parseClaudeCodeLine(line), null);
  });

  test('ignores non-user lines and malformed JSON', () => {
    assert.strictEqual(parseClaudeCodeLine('not json'), null);
    assert.strictEqual(parseClaudeCodeLine(JSON.stringify({ type: 'bridge-session' })), null);
  });

  test('ignores turns with only empty/whitespace text', () => {
    const line = JSON.stringify({
      type: 'user',
      origin: { kind: 'human' },
      message: { role: 'user', content: [{ type: 'text', text: '   ' }] },
      uuid: 'abc-125',
      sessionId: 'session-1',
      timestamp: '2026-08-23T05:58:07.523Z',
    });

    assert.strictEqual(parseClaudeCodeLine(line), null);
  });
});

suite('extractCopilotRequestText', () => {
  test('extracts a plain string message', () => {
    assert.strictEqual(extractCopilotRequestText({ message: 'fix this bug' }), 'fix this bug');
  });

  test('extracts message.text', () => {
    assert.strictEqual(extractCopilotRequestText({ message: { text: 'explain this' } }), 'explain this');
  });

  test('extracts and joins message.parts', () => {
    const request = { message: { parts: [{ text: 'hello ' }, { value: 'world' }] } };
    assert.strictEqual(extractCopilotRequestText(request), 'hello world');
  });

  test('falls back to request.text', () => {
    assert.strictEqual(extractCopilotRequestText({ text: 'fallback text' }), 'fallback text');
  });

  test('returns null when no recognizable text is found', () => {
    assert.strictEqual(extractCopilotRequestText({}), null);
    assert.strictEqual(extractCopilotRequestText(null), null);
    assert.strictEqual(extractCopilotRequestText({ message: { text: '   ' } }), null);
  });
});

suite('extractCodexUserText', () => {
  test('extracts text from the current response_item/message format', () => {
    const obj = {
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the build' }] },
    };
    assert.strictEqual(extractCodexUserText(obj), 'fix the build');
  });

  test('ignores assistant messages', () => {
    const obj = {
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] },
    };
    assert.strictEqual(extractCodexUserText(obj), null);
  });

  test('extracts text from the event_msg/user_message format', () => {
    const obj = { type: 'event_msg', payload: { type: 'user_message', message: 'hello codex' } };
    assert.strictEqual(extractCodexUserText(obj), 'hello codex');
  });

  test('extracts text from the older flat message format', () => {
    assert.strictEqual(
      extractCodexUserText({ type: 'message', role: 'user', content: [{ text: 'run the tests' }] }),
      'run the tests',
    );
    assert.strictEqual(extractCodexUserText({ type: 'message', role: 'user', content: 'plain string' }), 'plain string');
  });

  test('returns null for non-user or unrecognized shapes', () => {
    assert.strictEqual(extractCodexUserText({ type: 'session_meta', payload: {} }), null);
    assert.strictEqual(extractCodexUserText(null), null);
    assert.strictEqual(extractCodexUserText({}), null);
  });
});

suite('parseCodexLine', () => {
  test('parses a valid line with a timestamp', () => {
    const line = JSON.stringify({
      timestamp: '2026-08-23T09:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'add tests' },
    });
    const result = parseCodexLine(line);
    assert.ok(result);
    assert.strictEqual(result!.text, 'add tests');
    assert.strictEqual(result!.timestamp, Date.parse('2026-08-23T09:00:00.000Z'));
  });

  test('returns null for malformed JSON or missing/invalid timestamp', () => {
    assert.strictEqual(parseCodexLine('not json'), null);
    assert.strictEqual(
      parseCodexLine(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'x' } })),
      null,
    );
  });
});

suite('folderName', () => {
  test('extracts the last segment from a Windows-style path', () => {
    assert.strictEqual(folderName('d:\\AI\\PromptDock'), 'PromptDock');
  });

  test('extracts the last segment from a POSIX-style path', () => {
    assert.strictEqual(folderName('/home/user/my-project'), 'my-project');
  });

  test('returns Unknown for undefined, null, or empty input', () => {
    assert.strictEqual(folderName(undefined), 'Unknown');
    assert.strictEqual(folderName(null), 'Unknown');
    assert.strictEqual(folderName(''), 'Unknown');
  });
});

suite('resolveWorkspaceProjectName', () => {
  test('extracts the folder name from a file:// workspace.json', () => {
    const content = JSON.stringify({ folder: 'file:///d%3A/AI/PromptDock' });
    assert.strictEqual(resolveWorkspaceProjectName(content), 'PromptDock');
  });

  test('extracts the folder name from a vscode-remote:// workspace.json', () => {
    const content = JSON.stringify({ folder: 'vscode-remote://ssh-remote%2Bhost/d%3A/MirServer' });
    assert.strictEqual(resolveWorkspaceProjectName(content), 'MirServer');
  });

  test('returns Unknown for null content, malformed JSON, or a missing folder field', () => {
    assert.strictEqual(resolveWorkspaceProjectName(null), 'Unknown');
    assert.strictEqual(resolveWorkspaceProjectName('not json'), 'Unknown');
    assert.strictEqual(resolveWorkspaceProjectName(JSON.stringify({})), 'Unknown');
  });
});

suite('extractCodexCwd', () => {
  test('finds a top-level cwd field', () => {
    assert.strictEqual(extractCodexCwd({ cwd: '/home/user/project' }), '/home/user/project');
  });

  test('finds a payload.cwd field', () => {
    assert.strictEqual(extractCodexCwd({ payload: { cwd: '/home/user/project' } }), '/home/user/project');
  });

  test('returns undefined when no cwd hint is present', () => {
    assert.strictEqual(extractCodexCwd({ type: 'session_meta', payload: {} }), undefined);
    assert.strictEqual(extractCodexCwd(null), undefined);
  });
});

suite('FileScanCache', () => {
  let tmpFile: string;

  setup(() => {
    tmpFile = path.join(os.tmpdir(), `promptdock-filescan-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(tmpFile, 'initial content');
  });

  teardown(() => {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // already removed
    }
  });

  test('does not skip a file with no prior recorded stat', async () => {
    const cache = new FileScanCache({});
    assert.strictEqual(await cache.shouldSkip(tmpFile), false);
  });

  test('skips a file whose (mtime, size) matches what was previously recorded', async () => {
    const first = new FileScanCache({});
    await first.shouldSkip(tmpFile);
    const recorded = first.toMergedStats();

    const second = new FileScanCache(recorded);
    assert.strictEqual(await second.shouldSkip(tmpFile), true);
  });

  test('does not skip a file whose size changed since it was recorded', async () => {
    const first = new FileScanCache({});
    await first.shouldSkip(tmpFile);
    const recorded = first.toMergedStats();

    fs.appendFileSync(tmpFile, ' plus more content');

    const second = new FileScanCache(recorded);
    assert.strictEqual(await second.shouldSkip(tmpFile), false);
  });

  test('treats a missing file as skippable rather than throwing', async () => {
    const cache = new FileScanCache({});
    assert.strictEqual(await cache.shouldSkip(path.join(os.tmpdir(), 'promptdock-does-not-exist.txt')), true);
  });

  test('toMergedStats preserves untouched entries from the previous run', async () => {
    const previous = { 'some/other/file.jsonl': { mtimeMs: 123, size: 456 } };
    const cache = new FileScanCache(previous);
    await cache.shouldSkip(tmpFile);

    const merged = cache.toMergedStats();
    assert.deepStrictEqual(merged['some/other/file.jsonl'], { mtimeMs: 123, size: 456 });
    assert.ok(merged[tmpFile]);
  });
});
