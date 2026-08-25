import * as assert from 'assert';
import { Storage } from '../storage';
import { FakeMemento } from './fakeMemento';

function makeStorage(): Storage {
  return new Storage(new FakeMemento());
}

suite('Storage', () => {
  suite('templates', () => {
    test('createTemplate adds a template', async () => {
      const storage = makeStorage();
      const template = await storage.createTemplate('Explain', 'Explain {selection}');

      assert.strictEqual(template.name, 'Explain');
      assert.strictEqual(template.content, 'Explain {selection}');
      assert.deepStrictEqual(
        storage.getTemplates().map((t) => t.id),
        [template.id],
      );
    });

    test('updateTemplate changes name/content and bumps updatedAt', async () => {
      const storage = makeStorage();
      const template = await storage.createTemplate('Explain', 'v1');

      await storage.updateTemplate(template.id, { content: 'v2' });

      const [updated] = storage.getTemplates();
      assert.strictEqual(updated.content, 'v2');
      assert.strictEqual(updated.name, 'Explain');
      assert.ok(updated.updatedAt >= template.updatedAt);
    });

    test('deleteTemplate removes only the targeted template', async () => {
      const storage = makeStorage();
      const a = await storage.createTemplate('A', 'a');
      const b = await storage.createTemplate('B', 'b');

      await storage.deleteTemplate(a.id);

      assert.deepStrictEqual(
        storage.getTemplates().map((t) => t.id),
        [b.id],
      );
    });

    test('operations on an unknown id are no-ops', async () => {
      const storage = makeStorage();
      await storage.createTemplate('A', 'a');

      await storage.updateTemplate('missing-id', { name: 'X' });
      await storage.deleteTemplate('missing-id');

      assert.strictEqual(storage.getTemplates().length, 1);
      assert.strictEqual(storage.getTemplates()[0].name, 'A');
    });
  });

  suite('Deleted folder', () => {
    test('ensureDeletedFolder creates it once and is idempotent on repeat calls', async () => {
      const storage = makeStorage();

      const first = await storage.ensureDeletedFolder();
      const second = await storage.ensureDeletedFolder();

      assert.strictEqual(first.id, second.id);
      assert.strictEqual(storage.getFolders().filter((f) => f.name === 'Deleted').length, 1);
    });

    test('deleteFolder is a no-op for the Deleted folder', async () => {
      const storage = makeStorage();
      const deletedFolder = await storage.ensureDeletedFolder();

      await storage.deleteFolder(deletedFolder.id);

      assert.ok(storage.getFolders().some((f) => f.id === deletedFolder.id));
    });

    test('deleteFolder still works normally for any other folder', async () => {
      const storage = makeStorage();
      const folder = await storage.createFolder('Testing');

      await storage.deleteFolder(folder.id);

      assert.strictEqual(storage.getFolders().length, 0);
    });
  });

  suite('importExternalPrompts', () => {
    test('appends genuinely new prompts and reports how many were added', async () => {
      const storage = makeStorage();

      const imported = await storage.importExternalPrompts([
        { id: 'a', name: 'Older', content: 'a', usedAt: 1000, source: 'claude-code', project: 'Foo', sessionId: 's1' },
        { id: 'b', name: 'Newer', content: 'b', usedAt: 3000, source: 'copilot-chat', project: 'Bar', sessionId: 's2' },
      ]);

      assert.strictEqual(imported, 2);
      assert.deepStrictEqual(
        storage.getImportedPrompts().map((p) => p.name),
        ['Older', 'Newer'],
      );
    });

    test('does not re-import candidates with an id already imported', async () => {
      const storage = makeStorage();
      await storage.importExternalPrompts([
        { id: 'a', name: 'First', content: 'a', usedAt: 1000, source: 'claude-code', project: 'Foo', sessionId: 's1' },
      ]);

      const imported = await storage.importExternalPrompts([
        { id: 'a', name: 'First', content: 'a', usedAt: 1000, source: 'claude-code', project: 'Foo', sessionId: 's1' },
        { id: 'b', name: 'Second', content: 'b', usedAt: 2000, source: 'claude-code', project: 'Foo', sessionId: 's1' },
      ]);

      assert.strictEqual(imported, 1);
      assert.strictEqual(storage.getImportedPrompts().length, 2);
    });

    test('does not cap the imported prompt archive (unlike History)', async () => {
      const storage = makeStorage();
      const candidates = Array.from({ length: 5 }, (_, i) => ({
        id: `id-${i}`,
        name: `Entry ${i}`,
        content: `content ${i}`,
        usedAt: i,
        source: 'claude-code' as const,
        project: 'Foo',
        sessionId: 's1',
      }));

      const imported = await storage.importExternalPrompts(candidates);

      assert.strictEqual(imported, 5);
      assert.strictEqual(storage.getImportedPrompts().length, 5);
    });

    test('returns 0 and is a no-op for an empty candidate list', async () => {
      const storage = makeStorage();
      const imported = await storage.importExternalPrompts([]);

      assert.strictEqual(imported, 0);
      assert.strictEqual(storage.getImportedPrompts().length, 0);
    });

  });

  suite('dismissed presets', () => {
    test('dismissPreset hides a preset id, restoreDismissedPresets brings it back', async () => {
      const storage = makeStorage();
      assert.deepStrictEqual(storage.getDismissedPresetIds(), new Set());

      await storage.dismissPreset('preset.debug.explain-error');
      assert.deepStrictEqual(storage.getDismissedPresetIds(), new Set(['preset.debug.explain-error']));

      await storage.restoreDismissedPresets(['preset.debug.explain-error']);
      assert.deepStrictEqual(storage.getDismissedPresetIds(), new Set());
    });

    test('dismissPreset is idempotent for an already-dismissed id', async () => {
      const storage = makeStorage();
      await storage.dismissPreset('preset.debug.explain-error');
      await storage.dismissPreset('preset.debug.explain-error');

      assert.deepStrictEqual(storage.getDismissedPresetIds(), new Set(['preset.debug.explain-error']));
    });

    test('restoreDismissedPresets only restores ids that were actually dismissed', async () => {
      const storage = makeStorage();
      await storage.dismissPreset('preset.a');
      await storage.dismissPreset('preset.b');

      await storage.restoreDismissedPresets(['preset.a', 'preset.never-dismissed']);

      assert.deepStrictEqual(storage.getDismissedPresetIds(), new Set(['preset.b']));
    });

    test('onDidChange fires on dismiss and on a restore that changes something', async () => {
      const storage = makeStorage();
      let fireCount = 0;
      storage.onDidChange(() => { fireCount += 1; });

      await storage.dismissPreset('preset.a');
      await storage.restoreDismissedPresets(['preset.a']);
      await storage.restoreDismissedPresets(['preset.a']); // no-op, nothing left to restore

      assert.strictEqual(fireCount, 2);
    });
  });

  suite('onDidChange', () => {
    test('fires after mutating operations', async () => {
      const storage = makeStorage();
      let fireCount = 0;
      storage.onDidChange(() => {
        fireCount += 1;
      });

      await storage.createTemplate('A', 'a');
      await storage.importExternalPrompts([
        { id: 'a', name: 'A', content: 'a', usedAt: 1, source: 'claude-code', project: 'Foo', sessionId: 's1' },
      ]);

      assert.strictEqual(fireCount, 2);
    });
  });
});
