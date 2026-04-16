import { requestUrl } from "obsidian";
import type {
  DumpSettings,
  UnifiedMessage,
  UnifiedToolDef,
  UnifiedResponse,
  ContentBlock,
} from "../types";

const DEFAULT_OPENAI_URL = "https://api.openai.com";

let previousResponseId: string | null = null;

export function clearOpenAIState(): void {
  previousResponseId = null;
}

export async function sendOpenAIMessage(
  settings: DumpSettings,
  messages: UnifiedMessage[],
  tools: UnifiedToolDef[],
  systemPrompt: string
): Promise<UnifiedResponse> {
  const baseUrl = DEFAULT_OPENAI_URL;
  const model = settings.apiModel || "gpt-4o";

  const input = buildCurrentTurnInput(messages, systemPrompt);

  const body: Record<string, unknown> = {
    model,
    input,
  };

  if (previousResponseId) {
    body.previous_response_id = previousResponseId;
  }

  if (/^o\d/.test(model) || /^gpt-5/.test(model)) {
    body.reasoning = { effort: "medium" };
  }

  const apiTools: Record<string, unknown>[] = tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));

  if (apiTools.length > 0) {
    body.tools = apiTools;
  }

  body.instructions = systemPrompt;

  let response;
  try {
    response = await requestUrl({
      url: `${baseUrl}/v1/responses`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      throw: false,
    });
  } catch (e: unknown) {
    const err = e as Record<string, unknown>;
    const apiMsg = (err.json as { error?: { message?: string } })?.error?.message;
    if (apiMsg) {
      throw new Error(`OpenAI API error (${err.status}): ${apiMsg}`);
    }
    throw new Error(
      `OpenAI request failed (${err.status || ""}): ${err.message || String(e)}`
    );
  }

  if (response.status !== 200) {
    const errorBody = response.json?.error?.message || `HTTP ${response.status}`;
    throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
  }

  const data = response.json;
  previousResponseId = data.id || null;

  return fromResponsesOutput(data);
}

// ─── Input Building ─────────────────────────────────────────────────────────

function buildCurrentTurnInput(
  messages: UnifiedMessage[],
  systemPrompt: string
): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];

  if (!previousResponseId) {
    items.push({
      type: "message",
      role: "developer",
      content: systemPrompt,
    });

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        items.push({
          type: "message",
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }
    return items;
  }

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return items;

  if (typeof lastMsg.content === "string") {
    items.push({
      type: "message",
      role: "user",
      content: lastMsg.content,
    });
    return items;
  }

  const toolResults = lastMsg.content.filter((b) => b.type === "tool_result");
  if (toolResults.length > 0) {
    for (const tr of toolResults) {
      items.push({
        type: "function_call_output",
        call_id: tr.tool_use_id,
        output: tr.content || "",
      });
    }
    return items;
  }

  const text = lastMsg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (text) {
    items.push({
      type: "message",
      role: lastMsg.role === "assistant" ? "assistant" : "user",
      content: text,
    });
  }

  return items;
}

// ─── Response Parsing ───────────────────────────────────────────────────────

function fromResponsesOutput(data: Record<string, unknown>): UnifiedResponse {
  const output = (data.output || []) as Array<Record<string, unknown>>;
  const content: ContentBlock[] = [];
  let hasToolCalls = false;

  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content as Array<Record<string, unknown>>) {
        if (part.type === "output_text" && typeof part.text === "string") {
          content.push({ type: "text", text: part.text });
        }
      }
    } else if (item.type === "function_call") {
      hasToolCalls = true;
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse((item.arguments as string) || "{}");
      } catch {
        input = { _raw: item.arguments };
      }
      content.push({
        type: "tool_use",
        id: (item.call_id || item.id) as string,
        name: item.name as string,
        input,
      });
    }
  }

  const stopReason = hasToolCalls ? "tool_use" : "end_turn";
  const usage = data.usage as
    | { input_tokens?: number; output_tokens?: number }
    | undefined;

  return {
    content,
    stopReason,
    usage: usage
      ? { inputTokens: usage.input_tokens || 0, outputTokens: usage.output_tokens || 0 }
      : undefined,
  };
}
