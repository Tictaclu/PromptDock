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
