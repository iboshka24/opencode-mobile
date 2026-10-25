import type { CatalogModel } from "./catalog";
import { addUsage, emptyUsage, type TokenUsage } from "./cost";
import { streamChat, type ChatEvent, type ChatRequest, type ModelMessage, type ToolCall } from "./llm";
import { executeTool, type ToolContext } from "./tools";
import type { JsonTool } from "./tools";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-start"; id: string; name: string; arguments: string }
  | { type: "tool-end"; id: string; name: string; content: string; isError: boolean }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done" }
  | { type: "error"; message: string };

export interface AgentInput {
  system: string;
  messages: ModelMessage[];
  model: CatalogModel;
  apiKey: string;
  baseUrl?: string;
  tools: JsonTool[];
  ctx: ToolContext;
  chat?: (request: ChatRequest) => AsyncGenerator<ChatEvent>;
  signal?: AbortSignal;
  maxSteps?: number;
  onEvent?: (event: AgentEvent) => void;
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch (error) {
    throw new Error(`Tool arguments were not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runAgent(input: AgentInput): Promise<{ messages: ModelMessage[]; usage: TokenUsage }> {
  const chat = input.chat ?? streamChat;
  const messages = [...input.messages];
  const maxSteps = input.maxSteps ?? 12;
  let usage = emptyUsage();
  const emit = (event: AgentEvent) => input.onEvent?.(event);
  try {
    for (let step = 0; step < maxSteps; step += 1) {
      if (input.signal?.aborted) throw new Error("Stopped");
      let text = "";
      let reasoning = "";
      const calls: ToolCall[] = [];
      const request: ChatRequest = {
        model: input.model,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        system: input.system,
        messages,
        tools: input.model.toolCall ? input.tools : [],
        signal: input.signal,
      };
      for await (const event of chat(request)) {
        if (event.type === "text") {
          text += event.text;
          emit({ type: "text", text: event.text });
        } else if (event.type === "reasoning") {
          reasoning += event.text;
          emit({ type: "reasoning", text: event.text });
        } else if (event.type === "tool_call") {
          calls.push({ id: event.id, name: event.name, arguments: event.arguments });
        } else if (event.type === "usage") {
          usage = addUsage(usage, event.usage);
          emit({ type: "usage", usage: event.usage });
        }
      }
      messages.push({
        role: "assistant",
        content: text,
        reasoning: reasoning || undefined,
        toolCalls: calls.length ? calls : undefined,
      });
      if (calls.length === 0) {
        emit({ type: "done" });
        return { messages, usage };
      }
      const readOnly = new Set(["read", "glob", "grep", "webfetch", "websearch", "todowrite", "question"]);
      const parallel = calls.every((call) => readOnly.has(call.name));
      const runOne = async (call: ToolCall) => {
        emit({ type: "tool-start", id: call.id, name: call.name, arguments: call.arguments });
        let result: { content: string; isError: boolean };
        try {
          result = await executeTool(call.name, parseArgs(call.arguments), input.ctx);
        } catch (error) {
          result = { content: error instanceof Error ? error.message : String(error), isError: true };
        }
        emit({ type: "tool-end", id: call.id, name: call.name, content: result.content, isError: result.isError });
        return result;
      };
      const results = parallel ? await Promise.all(calls.map((call) => runOne(call))) : [];
      if (!parallel) {
        for (const call of calls) results.push(await runOne(call));
      }
      calls.forEach((call, index) => {
        const result = results[index]!;
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: result.content,
          isError: result.isError,
        });
      });
    }
    messages.push({
      role: "assistant",
      content: `Stopped after ${maxSteps} tool steps. Tell me if you want me to continue.`,
      local: true,
    });
    emit({ type: "done" });
    return { messages, usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "error", message });
    throw error;
  }
}
