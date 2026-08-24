import * as assert from 'assert';
import { BUILTIN_PRESETS } from '../presets';

suite('BUILTIN_PRESETS', () => {
  test('is non-empty', () => {
    assert.ok(BUILTIN_PRESETS.length > 0);
  });

  test('every preset has a unique id', () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  test('every preset has a unique name', () => {
    const names = BUILTIN_PRESETS.map((p) => p.name);
    assert.strictEqual(new Set(names).size, names.length);
  });

  test('every preset has non-empty name, category, and content', () => {
    for (const preset of BUILTIN_PRESETS) {
      assert.ok(preset.name.trim().length > 0, `preset ${preset.id} has an empty name`);
      assert.ok(preset.category.trim().length > 0, `preset ${preset.id} has an empty category`);
      assert.ok(preset.content.trim().length > 0, `preset ${preset.id} has empty content`);
    }
  });

  test('every preset uses the {selection} placeholder', () => {
    for (const preset of BUILTIN_PRESETS) {
      assert.ok(
        preset.content.includes('{selection}'),
        `preset ${preset.id} is missing the {selection} placeholder`,
      );
    }
  });
});
