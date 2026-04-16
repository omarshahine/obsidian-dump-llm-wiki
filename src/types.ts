// ─── Settings ───────────────────────────────────────────────────────────────

export type CliProvider = "none" | "claude" | "github-copilot";
export type ApiProvider = "anthropic" | "openai";

export interface DumpSettings {
  // CLI settings
  primaryCli: CliProvider;
  cliModel: string;
  useCli: boolean;

  // API fallback settings
  apiProvider: ApiProvider;
  apiKey: string;
  apiModel: string;

  // Knowledge base
  dumpFolder: string;
  lintInterval: "disabled" | "daily" | "weekly" | "monthly";
  maxFilesPerSession: number;
  autoProcessDelay: number;
  maxIterations: number;

  // Transcription
  whisperModel: string;
  openaiApiKey: string;
}

export const DEFAULT_SETTINGS: DumpSettings = {
  primaryCli: "claude",
  cliModel: "opus",
  useCli: true,

  apiProvider: "anthropic",
  apiKey: "",
  apiModel: "claude-sonnet-4-6",

  dumpFolder: "Dump",
  lintInterval: "weekly",
  maxFilesPerSession: 3,
  autoProcessDelay: 0.25,
  maxIterations: 25,

  whisperModel: "whisper-1",
  openaiApiKey: "",
};

/** CLI availability detected at runtime */
export interface CliStatus {
  claude: boolean;
  claudePath: string;
  ghCopilot: boolean;
  ghCopilotPath: string;
}

// ─── Unified Message Format ─────────────────────────────────────────────────

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface UnifiedMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

export interface UnifiedToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ─── API Response ───────────────────────────────────────────────────────────

export interface UnifiedResponse {
  content: ContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop" | string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ─── Tool Execution ─────────────────────────────────────────────────────────

export interface ToolResult {
  result: string;
  isError: boolean;
}

// ─── Agent Callbacks ────────────────────────────────────────────────────────

export interface AgentCallbacks {
  onThinking: () => void;
  onToolCall: (name: string, input: Record<string, unknown>) => void;
  onToolResult: (name: string, result: ToolResult) => void;
  onResponse: (text: string) => void;
  onError: (error: string) => void;
}

// ─── Dump-Specific Types ────────────────────────────────────────────────────

export type InputType = "url" | "podcast" | "text" | "image";

export interface IngestResult {
  title: string;
  source: string;
  rawFile: string;
  wikiPages: string[];
  updatedPages: string[];
}

export interface WikiStats {
  rawCount: number;
  wikiCount: number;
  outputCount: number;
  categories: string[];
  recentLog: string[];
  orphanedRaw: number;
}
