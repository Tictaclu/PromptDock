import * as assert from 'assert';
import { Storage } from '../storage';
import { FakeMemento } from './fakeMemento';
import { buildState, findRow } from '../webviewProvider';

function makeStorage(): Storage {
  return new Storage(new FakeMemento());
}

suite('buildState', () => {
  test('places filed templates and category-matched presets under their folder', async () => {
    const storage = makeStorage();
    const folder = await storage.createFolder('Testing');
    await storage.createTemplate('My Test Template', 'content', folder.id);
    await storage.createTemplate('Loose Template', 'content');

    const state = buildState(storage);

    const folderData = state.templates.folders.find((f) => f.name === 'Testing')!;
    assert.deepStrictEqual(folderData.templates.map((t) => t.name), ['My Test Template']);
    assert.ok(folderData.presets.some((p) => p.name === 'Generate Unit Tests'));
    assert.deepStrictEqual(state.templates.unfiled.map((t) => t.name), ['Loose Template']);
  });

  test('groups imported prompts by source, then project, then session, sorted by recent activity', async () => {
    const storage = makeStorage();
    await storage.importExternalPrompts([
      { id: 'a', name: 'First', content: 'a', usedAt: 1000, source: 'claude-code', project: 'PromptDock', sessionId: 's1' },
      { id: 'b', name: 'Second', content: 'b', usedAt: 2000, source: 'claude-code', project: 'PromptDock', sessionId: 's1' },
      { id: 'c', name: 'Other', content: 'c', usedAt: 1500, source: 'copilot-chat', project: 'Elsewhere', sessionId: 's2' },
    ]);

    const state = buildState(storage);

    const claude = state.sources.find((s) => s.source === 'claude-code')!;
    assert.strictEqual(claude.count, 2);
    assert.strictEqual(claude.projects.length, 1);
    assert.strictEqual(claude.projects[0].name, 'PromptDock');
    assert.strictEqual(claude.projects[0].sessions.length, 1);
    assert.strictEqual(claude.projects[0].sessions[0].title, 'First');
    assert.deepStrictEqual(
      claude.projects[0].sessions[0].prompts.map((p) => p.name),
      ['Second', 'First'],
    );

    const copilot = state.sources.find((s) => s.source === 'copilot-chat')!;
    assert.strictEqual(copilot.count, 1);

    const codex = state.sources.find((s) => s.source === 'codex')!;
    assert.strictEqual(codex.count, 0);
    assert.deepStrictEqual(codex.projects, []);
  });
});

suite('findRow', () => {
  test('finds a template row nested in a folder', async () => {
    const storage = makeStorage();
    const folder = await storage.createFolder('Testing');
    const template = await storage.createTemplate('My Test Template', 'content', folder.id);

    const state = buildState(storage);
    const row = findRow(state, `template:${template.id}`);

    assert.ok(row);
    assert.strictEqual(row!.name, 'My Test Template');
  });

  test('finds an unfiled template row', async () => {
    const storage = makeStorage();
    const template = await storage.createTemplate('Loose Template', 'content');

    const state = buildState(storage);
    const row = findRow(state, `template:${template.id}`);

    assert.ok(row);
    assert.strictEqual(row!.name, 'Loose Template');
  });

  test('finds an imported prompt row nested under source/project/session', async () => {
    const storage = makeStorage();
    await storage.importExternalPrompts([
      { id: 'a', name: 'Imported', content: 'a', usedAt: 1000, source: 'codex', project: 'PromptDock', sessionId: 's1' },
    ]);

    const state = buildState(storage);
    const row = findRow(state, 'imported:a');

    assert.ok(row);
    assert.strictEqual(row!.name, 'Imported');
  });

  test('returns undefined for an unknown id', () => {
    const storage = makeStorage();
    const state = buildState(storage);

    assert.strictEqual(findRow(state, 'template:missing'), undefined);
  });
});
