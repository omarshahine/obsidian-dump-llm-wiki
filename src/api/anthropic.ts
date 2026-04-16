import { requestUrl } from "obsidian";
import type {
  DumpSettings,
  UnifiedMessage,
  UnifiedToolDef,
  UnifiedResponse,
  ContentBlock,
} from "../types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export async function sendAnthropicMessage(
  settings: DumpSettings,
  messages: UnifiedMessage[],
  tools: UnifiedToolDef[],
  systemPrompt: string
): Promise<UnifiedResponse> {
  const model = settings.apiModel || "claude-sonnet-4-6";
  const body: Record<string, unknown> = {
    model,
    max_tokens: 16384,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: messages.map(toAnthropicMessage),
  };

  // Enable thinking based on model generation
  const is46Model = model.includes("4-6") || model.includes("4.6");
  const supportsThinking =
    model.includes("claude-sonnet-4") ||
    model.includes("claude-opus") ||
    model.includes("claude-sonnet-3-7");

  if (is46Model) {
    body.thinking = { type: "adaptive" };
  } else if (supportsThinking) {
    body.thinking = { type: "enabled", budget_tokens: 8192 };
  }

  if (tools.length > 0) {
    body.tools = tools.map((t, i, arr) => {
      const tool: Record<string, unknown> = {
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      };
      if (i === arr.length - 1) {
        tool.cache_control = { type: "ephemeral" };
      }
      return tool;
    });
  }

  let response;
  try {
    response = await requestUrl({
      url: ANTHROPIC_API_URL,
      method: "POST",
      headers: {
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      throw: false,
    });
  } catch (e: unknown) {
    const err = e as { status?: number; json?: { error?: { message?: string } } };
    const apiMsg = err.json?.error?.message;
    if (apiMsg) {
      throw new Error(`Anthropic API error (${err.status}): ${apiMsg}`);
    }
    throw e;
  }

  if (response.status !== 200) {
    const errorText =
      typeof response.json?.error?.message === "string"
        ? response.json.error.message
        : `HTTP ${response.status}`;
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = response.json;

  return {
    content: (data.content as AnthropicContentBlock[])
      .map(fromAnthropicBlock)
      .filter((b): b is ContentBlock => b !== null),
    stopReason: data.stop_reason === "end_turn" ? "end_turn" : data.stop_reason,
    usage: data.usage
      ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
      : undefined,
  };
}

// ─── Format Conversions ─────────────────────────────────────────────────────

interface AnthropicContentBlock {
  type: "text" | "tool_use" | "thinking";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function toAnthropicMessage(msg: UnifiedMessage): Record<string, unknown> {
  if (typeof msg.content === "string") {
    return { role: msg.role, content: msg.content };
  }

  const blocks = msg.content
    .map((block) => {
      if (block.type === "tool_result") {
        return {
          type: "tool_result",
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error || false,
        };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }
      return { type: "text", text: block.text };
    })
    .filter((b) => !(b.type === "text" && !b.text));

  return { role: msg.role, content: blocks };
}

function fromAnthropicBlock(block: AnthropicContentBlock): ContentBlock | null {
  if (block.type === "tool_use") {
    return {
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input,
    };
  }
  if (block.type === "thinking") {
    return null;
  }
  if (!block.text) {
    return null;
  }
  return { type: "text", text: block.text };
}
