# PromptDock

**AI Prompt Management for VS Code**

PromptDock is a VS Code extension that gives you a dedicated home for every AI prompt you work with — templates you craft, built-in presets for common engineering tasks, and the full history of prompts you've already sent through Claude Code, GitHub Copilot Chat, and Codex. Stop rewriting the same prompts, stop losing good ones in chat history. Keep them organized, searchable, and one click away.

## Why PromptDock?

AI coding tools are only as good as the prompts you give them. Most developers end up repeating the same prompts from memory, hunting through chat histories, or keeping prompts in random text files. PromptDock puts your entire prompt library in the sidebar — structured, versioned in your own templates, and surfaced from every AI tool you already use.

## Features

### My Templates

Write and organize your own prompt templates in a folder structure that matches how you work. PromptDock seeds a starter set on first run — Requirements, Design, Development, Testing, Deployment, Maintenance, and Agents — and you can add, rename, or delete folders freely. Deleting a folder never deletes the templates inside; they fall back to unfiled.

### Built-in Presets

Twelve ready-to-use prompts ship with the extension, covering debugging, refactoring, testing, documentation, code review, and performance. They appear pre-sorted into the right folders and can be imported into My Templates — individually or all at once — with a single click.

### Prompt History from Your AI Tools

PromptDock automatically scans your local Claude Code, Copilot Chat, and Codex session files and surfaces every prompt you've sent, grouped by tool, project, and conversation. It runs on startup and re-scans only changed files, so it stays fast even with a large history. Trigger a manual sync anytime.

### Search Across Everything

Each section has its own instant search box. For a single search across all templates, presets, and imported history at once, run **PromptDock: Search Prompts...** from the Command Palette. Selecting a result opens its full content in a panel with one-click Copy, Insert, and Save to My Templates.

### Use a Prompt Instantly

Click a prompt name to copy it to the clipboard and insert it at your cursor in one step (configurable). Any `{selection}` placeholder is automatically replaced with your active editor's text selection before copying or inserting.

### Pop-out Panel

Open any section — My Templates or a specific tool source — in its own detached panel with **+ New Window**, so your prompt library stays visible alongside your code.

## Configuration

| Setting | Description | Default |
|---|---|---|
| `promptdock.defaultAction` | What happens when you click a prompt: `copyAndInsert`, `copyOnly`, or `insertOnly`. | `copyAndInsert` |

## Commands

All commands are available from the Command Palette under **PromptDock**:

- **Search Prompts...** — search every prompt at once
- **Sync Prompts from Claude Code / Copilot Chat / Codex** — manually refresh imported history
- **New Prompt Template...** / **New Folder...** — add to My Templates
- **Import to My Templates** / **Import All Presets** — copy built-in presets into your library

## Privacy

Everything PromptDock manages — templates, folders, imported history — is stored locally in VS Code's extension storage. Nothing is sent to any external service. History import only reads session files already on your machine.
