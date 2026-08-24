export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  /** Folder this template lives in, or undefined for unfiled (shown directly under My Templates). */
  folderId?: string;
}

export interface TemplateFolder {
  id: string;
  name: string;
  createdAt: number;
}

export type PromptSource = 'claude-code' | 'copilot-chat' | 'codex';

export const SOURCE_LABELS: Record<PromptSource, string> = {
  'claude-code': 'Claude',
  'copilot-chat': 'Copilot',
  codex: 'Codex',
};

export interface PresetPrompt {
  id: string;
  name: string;
  content: string;
  category: string;
}

/** A prompt imported from an external tool's local session history (Claude Code / Copilot Chat / Codex). */
export interface ImportedPrompt {
  id: string;
  name: string;
  content: string;
  usedAt: number;
  source: PromptSource;
  /** Display name of the originating project/workspace folder, or "Unknown" if it couldn't be determined. */
  project: string;
  /** Identifier of the originating conversation/session, used to group prompts within a project. */
  sessionId: string;
}
