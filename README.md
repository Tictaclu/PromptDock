# PromptDock

Manage, reuse, and reach for your favorite AI prompts without leaving VS Code. PromptDock lives in its own Activity Bar view and keeps three things in one place: prompt templates you write yourself, a built-in library of common presets, and prompt history it pulls automatically from Claude Code, GitHub Copilot Chat, and Codex.

## Features

### My Templates

Write and reuse your own prompt templates, organized into folders. PromptDock seeds a starter set of folders on first run — Requirements, Design, Development, Testing, Deployment, Maintenance, and Agents — and you can add, rename, or delete your own at any time. Deleting a folder never deletes what's inside it; the templates just fall back to unfiled.

### Built-in presets

Twelve ready-to-use prompts covering debugging, refactoring, testing, documentation, code review, and performance ship with the extension and show up automatically inside the folder they best fit (e.g. testing prompts appear under **Testing**, debugging and refactoring prompts under **Development**). Import a single preset or all of them into My Templates with one click — they land pre-filed in the matching folder.

### Imported history

PromptDock scans your local Claude Code, Copilot Chat, and Codex session files and surfaces every prompt you've sent through them, grouped by tool, then by project, then by conversation. It runs automatically on startup and re-scans only files that changed since the last sync, so it stays fast even with a large history. You can also trigger a manual sync at any time.

### Search everywhere

Every section of the sidebar has its own instant search box that filters by name and content as you type. For a search across everything at once — templates, presets, and imported history together — run **PromptDock: Search Prompts...** from the Command Palette; picking a result opens its full content in a separate panel with one-click Copy, Insert, and (for presets/imported prompts) Save to My Templates.

### Using a prompt

Click a prompt's name to copy it to the clipboard and insert it at your cursor in one step (configurable — see below), or use the dedicated copy button for clipboard-only. Any `{selection}` placeholder in a prompt's content is automatically replaced with your active editor's current text selection before it's copied or inserted.

### Pop-out windows

Use the **+ New Window** button on any section (My Templates or a source like Claude Code) to open just that section in its own detached panel — handy for keeping your prompt library visible alongside your code.

## Configuration

| Setting | Description | Default |
|---|---|---|
| `promptdock.defaultAction` | What happens when you click a prompt: `copyAndInsert`, `copyOnly`, or `insertOnly`. | `copyAndInsert` |

## Commands

All commands are available from the Command Palette under the **PromptDock** category, including:

- **Search Prompts...** — search every prompt at once and open a result in its own panel
- **Sync Prompts from Claude Code / Copilot Chat / Codex** — manually refresh imported history
- **New Prompt Template...** / **New Folder...** — add to My Templates from the sidebar
- **Import to My Templates** / **Import All Presets** — copy built-in presets into your own library

## Privacy

Everything PromptDock manages — your templates, folders, and imported history — is stored locally in VS Code's own extension storage. Nothing is sent anywhere; importing history only reads session files already on your machine.
