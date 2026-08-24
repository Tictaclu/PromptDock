import * as assert from 'assert';
import { Storage } from '../storage';
import { FakeMemento } from './fakeMemento';
import {
  FolderItem,
  GroupItem,
  ImportedPromptItem,
  PresetItem,
  ProjectGroupItem,
  PromptDockTreeProvider,
  SessionGroupItem,
  SourceGroupItem,
  TemplateItem,
} from '../treeProvider';

function makeProvider(): { storage: Storage; provider: PromptDockTreeProvider } {
  const storage = new Storage(new FakeMemento());
  return { storage, provider: new PromptDockTreeProvider(storage) };
}

suite('PromptDockTreeProvider — imported prompt grouping', () => {
  test('root includes one SourceGroupItem per source, with a count, and no History group', async () => {
    const { storage, provider } = makeProvider();
    await storage.importExternalPrompts([
      { id: 'a', name: 'A', content: 'a', usedAt: 1, source: 'claude-code', project: 'PromptDock', sessionId: 's1' },
      { id: 'b', name: 'B', content: 'b', usedAt: 2, source: 'claude-code', project: 'PromptDock', sessionId: 's1' },
      { id: 'c', name: 'C', content: 'c', usedAt: 3, source: 'copilot-chat', project: 'OtherProject', sessionId: 's2' },
    ]);

    const root = provider.getChildren();
    const sourceGroups = root.filter((n): n is SourceGroupItem => n instanceof SourceGroupItem);

    assert.strictEqual(sourceGroups.length, 3);
    const claudeGroup = sourceGroups.find((g) => g.source === 'claude-code')!;
    const copilotGroup = sourceGroups.find((g) => g.source === 'copilot-chat')!;
    const codexGroup = sourceGroups.find((g) => g.source === 'codex')!;
    assert.strictEqual(claudeGroup.description, '2');
    assert.strictEqual(copilotGroup.description, '1');
    assert.strictEqual(codexGroup.description, '0');

    const groupItems = root.filter((n): n is GroupItem => n instanceof GroupItem);
    assert.deepStrictEqual(
      groupItems.map((g) => g.groupId),
      ['templates'],
    );
  });

  test('My Templates nests default SDLC/Agents folders (no separate Common group), then unfiled templates', async () => {
    const { storage, provider } = makeProvider();
    await storage.ensureDefaultFolders();
    await storage.createTemplate('Loose Template', 'content');

    const templatesGroup = new GroupItem('templates', 'My Templates', 'templatesGroup');
    const children = provider.getChildren(templatesGroup);

    assert.strictEqual(children.some((c) => c instanceof GroupItem), false);

    const folderNames = children.filter((c): c is FolderItem => c instanceof FolderItem).map((f) => f.folder.name);
    assert.deepStrictEqual(folderNames, [
      'Requirements',
      'Design',
      'Development',
      'Testing',
      'Deployment',
      'Maintenance',
      'Agents',
    ]);

    const templateItems = children.filter((c): c is TemplateItem => c instanceof TemplateItem);
    assert.deepStrictEqual(templateItems.map((t) => t.template.name), ['Loose Template']);
  });

  test('a FolderItem lists its mapped built-in presets alongside filed templates; deleting the folder unfiles the templates', async () => {
    const { storage, provider } = makeProvider();
    const folder = await storage.createFolder('Testing');
    const filed = await storage.createTemplate('Filed', 'content', folder.id);
    await storage.createTemplate('Unfiled', 'content');

    const folderItem = new FolderItem(folder, 1);
    const children = provider.getChildren(folderItem);

    const presetItems = children.filter((c): c is PresetItem => c instanceof PresetItem);
    assert.deepStrictEqual(
      presetItems.map((p) => p.preset.name).sort(),
      ['Generate Unit Tests', 'Identify Edge Cases'].sort(),
    );

    const templateItems = children.filter((c): c is TemplateItem => c instanceof TemplateItem);
    assert.deepStrictEqual(templateItems.map((t) => t.template.name), ['Filed']);

    await storage.deleteFolder(folder.id);
    assert.strictEqual(storage.getFolders().length, 0);
    assert.strictEqual(storage.getTemplates().find((t) => t.id === filed.id)!.folderId, undefined);
  });

  test("a folder with no mapped preset category (e.g. Requirements) lists only filed templates", async () => {
    const { storage, provider } = makeProvider();
    const folder = await storage.createFolder('Requirements');
    await storage.createTemplate('Filed', 'content', folder.id);

    const folderItem = new FolderItem(folder, 1);
    const children = provider.getChildren(folderItem);

    assert.strictEqual(children.some((c) => c instanceof PresetItem), false);
    assert.strictEqual((children.filter((c): c is TemplateItem => c instanceof TemplateItem)).length, 1);
  });

  test('a SourceGroupItem groups its prompts into one ProjectGroupItem per project, newest-activity first', async () => {
    const { storage, provider } = makeProvider();
    await storage.importExternalPrompts([
      { id: 'a', name: 'A', content: 'a', usedAt: 1000, source: 'claude-code', project: 'OldProject', sessionId: 's1' },
      { id: 'b', name: 'B', content: 'b', usedAt: 3000, source: 'claude-code', project: 'RecentProject', sessionId: 's2' },
      { id: 'c', name: 'C', content: 'c', usedAt: 2000, source: 'claude-code', project: 'OldProject', sessionId: 's1' },
    ]);

    const claudeGroup = new SourceGroupItem('claude-code', 0);
    const projectGroups = provider.getChildren(claudeGroup) as ProjectGroupItem[];

    assert.deepStrictEqual(
      projectGroups.map((g) => g.project),
      ['RecentProject', 'OldProject'],
    );
    assert.strictEqual(
      projectGroups.find((g) => g.project === 'OldProject')!.description,
      `2 · ${new Date(2000).toLocaleDateString()}`,
    );
  });

  test('a ProjectGroupItem groups its prompts into one SessionGroupItem per session, titled by the earliest prompt, newest-activity first', async () => {
    const { storage, provider } = makeProvider();
    await storage.importExternalPrompts([
      { id: 'a', name: 'First in s1', content: 'a', usedAt: 1000, source: 'claude-code', project: 'PromptDock', sessionId: 's1' },
      { id: 'b', name: 'Second in s1', content: 'b', usedAt: 2000, source: 'claude-code', project: 'PromptDock', sessionId: 's1' },
      { id: 'c', name: 'Only in s2', content: 'c', usedAt: 1500, source: 'claude-code', project: 'PromptDock', sessionId: 's2' },
      { id: 'd', name: 'OtherProject', content: 'd', usedAt: 1800, source: 'claude-code', project: 'Elsewhere', sessionId: 's1' },
      { id: 'e', name: 'OtherSource', content: 'e', usedAt: 1800, source: 'codex', project: 'PromptDock', sessionId: 's1' },
    ]);

    const group = new ProjectGroupItem('claude-code', 'PromptDock', 0, 0);
    const sessions = provider.getChildren(group) as SessionGroupItem[];

    assert.deepStrictEqual(
      sessions.map((s) => s.sessionId),
      ['s1', 's2'],
    );
    const s1 = sessions.find((s) => s.sessionId === 's1')!;
    assert.strictEqual(s1.label, 'First in s1');
    assert.strictEqual(s1.description, `2 · ${new Date(2000).toLocaleDateString()}`);
  });

  test('a SessionGroupItem lists only that session\'s prompts, newest-first', async () => {
    const { storage, provider } = makeProvider();
    await storage.importExternalPrompts([
      { id: 'a', name: 'Older', content: 'a', usedAt: 1000, source: 'claude-code', project: 'PromptDock', sessionId: 's1' },
      { id: 'b', name: 'Newer', content: 'b', usedAt: 2000, source: 'claude-code', project: 'PromptDock', sessionId: 's1' },
      { id: 'c', name: 'OtherSession', content: 'c', usedAt: 1500, source: 'claude-code', project: 'PromptDock', sessionId: 's2' },
    ]);

    const group = new SessionGroupItem('claude-code', 'PromptDock', 's1', 'Older', 2000, 2);
    const items = provider.getChildren(group) as ImportedPromptItem[];

    assert.deepStrictEqual(
      items.map((i) => i.prompt.name),
      ['Newer', 'Older'],
    );
  });
});
