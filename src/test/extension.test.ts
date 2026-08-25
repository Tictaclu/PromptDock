import * as assert from 'assert';
import * as vscode from 'vscode';

const EXPECTED_COMMANDS = [
  'promptdock.refresh',
  'promptdock.syncExternalHistory',
  'promptdock.createTemplate',
  'promptdock.editTemplate',
  'promptdock.renameTemplate',
  'promptdock.deleteTemplate',
  'promptdock.usePrompt',
  'promptdock.copyPrompt',
  'promptdock.insertPrompt',
  'promptdock.importPreset',
  'promptdock.importAllPresets',
  'promptdock.restoreHiddenPresets',
];

suite('Extension activation', () => {
  test('activates and registers all contributed commands', async () => {
    const extension = vscode.extensions.getExtension('promptdock.promptdock');
    assert.ok(extension, 'extension not found — is the id publisher.name correct?');

    await extension!.activate();
    assert.strictEqual(extension!.isActive, true);

    const allCommands = await vscode.commands.getCommands(true);
    for (const command of EXPECTED_COMMANDS) {
      assert.ok(allCommands.includes(command), `command not registered: ${command}`);
    }
  });
});
