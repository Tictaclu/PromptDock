import { PresetPrompt } from './types';

/** Maps each preset's category to the default SDLC folder it's shown/imported into. */
export const PRESET_CATEGORY_TO_FOLDER: Record<string, string> = {
  Debugging: 'Development',
  Refactoring: 'Development',
  Testing: 'Testing',
  Documentation: 'Maintenance',
  'Code Review': 'Development',
  Performance: 'Development',
};

export const BUILTIN_PRESETS: PresetPrompt[] = [
  {
    id: 'preset.debug.explain-error',
    name: 'Explain This Error',
    category: 'Debugging',
    content:
      'Explain what is causing the following error and how to fix it. Show the corrected code.\n\n{selection}',
  },
  {
    id: 'preset.debug.find-bug',
    name: 'Find the Bug',
    category: 'Debugging',
    content:
      'Review the following code for bugs. Identify the root cause of any incorrect behavior and propose a fix.\n\n{selection}',
  },
  {
    id: 'preset.debug.add-logging',
    name: 'Add Debug Logging',
    category: 'Debugging',
    content:
      'Add helpful debug logging statements to the following code to make it easier to trace execution and diagnose issues.\n\n{selection}',
  },
  {
    id: 'preset.refactor.clean-up',
    name: 'Clean Up & Simplify',
    category: 'Refactoring',
    content:
      'Refactor the following code to be simpler and more readable, without changing its behavior. Explain the key changes.\n\n{selection}',
  },
  {
    id: 'preset.refactor.extract-function',
    name: 'Extract Function',
    category: 'Refactoring',
    content:
      'Refactor the following code by extracting reusable logic into well-named functions.\n\n{selection}',
  },
  {
    id: 'preset.refactor.rename',
    name: 'Improve Naming',
    category: 'Refactoring',
    content:
      'Suggest clearer, more descriptive names for the variables, functions, and types in the following code.\n\n{selection}',
  },
  {
    id: 'preset.test.unit-tests',
    name: 'Generate Unit Tests',
    category: 'Testing',
    content:
      'Write unit tests for the following code, covering typical cases and edge cases. Use the testing framework already used in this project if apparent.\n\n{selection}',
  },
  {
    id: 'preset.test.edge-cases',
    name: 'Identify Edge Cases',
    category: 'Testing',
    content:
      'List the edge cases and failure scenarios that should be tested for the following code.\n\n{selection}',
  },
  {
    id: 'preset.docs.add-comments',
    name: 'Add Documentation',
    category: 'Documentation',
    content:
      'Add clear documentation comments to the following code, explaining non-obvious behavior and parameters.\n\n{selection}',
  },
  {
    id: 'preset.docs.summarize',
    name: 'Summarize This Code',
    category: 'Documentation',
    content: 'Summarize what the following code does in plain language.\n\n{selection}',
  },
  {
    id: 'preset.review.code-review',
    name: 'Code Review',
    category: 'Code Review',
    content:
      'Perform a code review of the following code. Point out correctness issues, readability concerns, and potential improvements.\n\n{selection}',
  },
  {
    id: 'preset.perf.optimize',
    name: 'Optimize Performance',
    category: 'Performance',
    content:
      'Analyze the following code for performance issues and suggest concrete optimizations.\n\n{selection}',
  },
];
