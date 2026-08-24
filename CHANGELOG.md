# Changelog

## [1.0.0] — 2026-08-24

### Initial Release

**My Templates**
- Create, edit, rename, and delete prompt templates
- Organize templates into folders (Requirements, Design, Development, Testing, Deployment, Maintenance, Agents seeded on first run)
- Drag and drop prompts between folders
- Inline editing with Save / Cancel directly in the sidebar
- Delete sends templates to a "Deleted" folder rather than permanently removing them
- Duplicate guard — adding a prompt that already exists in My Templates is blocked
- Create new folders from the toolbar; create new prompts inside a specific folder
- Built-in presets mapped to matching SDLC folders (e.g. "Generate Unit Tests" under Testing)

**Prompt History (Claude / Copilot / Copilot Chat / Codex)**
- Syncs prompts from Claude Code, GitHub Copilot Chat, and Codex session files on your machine
- Prompts grouped by source → project → session, newest activity first
- Session dates shown on each group header
- Sync on demand via per-section Sync Prompts button; no automatic sync on startup

**New Session Panel**
- Detached panel showing all prompts for a source in a card layout
- Cards display full prompt text; folders collapsed by default
- Search bar filters cards across all folders instantly; empty folders hidden during search
- Expand All button to open every folder at once
- Per-card actions: ⎘ Copy, + Add (to My Templates), ✎ Edit
- Editing a card is local — modify the text before copying or saving to templates
- Copy and Add buttons turn green ✓ and grey out after use; reset after editing
- Add routes the prompt into a source-named folder (Claude / Copilot / Codex) automatically
- Duplicate check before adding to My Templates

**General**
- Activity bar icon (donut/ring shape)
- Hover tooltips on all interactive buttons
- Search bar with 🔍 icon in both sidebar and panel
- Default action configurable: Copy & Insert / Copy Only / Insert Only (`promptdock.defaultAction`)
- `{selection}` placeholder replaced with the active editor selection at use time
