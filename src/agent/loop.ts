import { App } from "obsidian";
import type {
  DumpSettings,
  UnifiedMessage,
  ContentBlock,
  AgentCallbacks,
} from "../types";
import { sendMessage } from "../api/client";
import { clearOpenAIState } from "../api/openai";
import { TOOL_DEFINITIONS } from "../tools/registry";
import { executeTool } from "../tools/executor";

const MAX_CONVERSATION_LENGTH = 50;
const KEEP_RECENT = 40;

/**
 * The core agentic loop for dump operations:
 * 1. Send user message + history to API
 * 2. If response contains tool_use, execute tools, append results, loop
 * 3. If response is end_turn, deliver text to user, done
 * 4. Safety: stop after maxIterations to prevent runaway loops
 */
export class DumpAgentLoop {
  private messages: UnifiedMessage[] = [];
  private app: App;
  private settings: DumpSettings;
  private aborted = false;

  constructor(app: App, settings: DumpSettings) {
    this.app = app;
    this.settings = settings;
  }

  abort(): void {
    this.aborted = true;
  }

  clear(): void {
    this.messages = [];
    this.aborted = false;
    clearOpenAIState();
  }

  /** Run one operation through the agentic loop */
  async run(
    userMessage: string,
    systemPrompt: string,
    callbacks: AgentCallbacks
  ): Promise<void> {
    this.aborted = false;
    this.messages.push({ role: "user", content: userMessage });
    this.pruneHistory();

    const maxIterations = this.settings.maxIterations || 25;

    for (let i = 0; i < maxIterations; i++) {
      if (this.aborted) return;

      callbacks.onThinking();

      let response;
      try {
        response = await sendMessage(
          this.settings,
          this.messages,
          TOOL_DEFINITIONS,
          systemPrompt
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        callbacks.onError(msg);
        return;
      }

      if (this.aborted) return;

      const toolCalls: ContentBlock[] = [];
      const textParts: string[] = [];

      for (const block of response.content) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          toolCalls.push(block);
        }
      }

      // Emit intermediate text before tool calls
      if (textParts.length > 0 && toolCalls.length > 0) {
        callbacks.onResponse(textParts.join(""));
      }

      // Append assistant message to history
      this.messages.push({ role: "assistant", content: response.content });

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        if (textParts.length > 0) {
          callbacks.onResponse(textParts.join(""));
        }
        return;
      }

      // Execute tool calls and collect results
      const resultBlocks: ContentBlock[] = [];

      for (const tc of toolCalls) {
        if (this.aborted) return;

        callbacks.onToolCall(tc.name!, tc.input!);

        const result = await executeTool(
          this.app,
          tc.name!,
          tc.input!,
          this.settings.dumpFolder,
          this.settings.xBearerToken
        );

        callbacks.onToolResult(tc.name!, result);

        resultBlocks.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: result.result,
          is_error: result.isError,
        });
      }

      // Append tool results as user message
      this.messages.push({ role: "user", content: resultBlocks });
    }

    callbacks.onError(
      `Reached maximum iterations (${maxIterations}). The task may be too complex.`
    );
  }

  private pruneHistory(): void {
    if (this.messages.length > MAX_CONVERSATION_LENGTH) {
      this.messages = this.messages.slice(-KEEP_RECENT);
    }
  }
}
