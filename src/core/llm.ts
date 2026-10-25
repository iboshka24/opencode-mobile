import { CODEX_BASE_URL, COPILOT_API_VERSION, formatHttpError } from "./auth";
import { chatCompletionsUrl, endpointFor, type CatalogModel } from "./catalog";
import { emptyUsage, type TokenUsage } from "./cost";
import { isZenProvider, missingKeyMessage, OPENCODE_USER_AGENT, PUBLIC_ZEN_KEY, resolveApiKey, sessionAffinity, zenHeaders, type ChatAuth } from "./identity";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ModelMessage =
  | { role: "user"; content: string; local?: boolean }
  | { role: "assistant"; content: string; reasoning?: string; toolCalls?: ToolCall[]; local?: boolean }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean; local?: boolean };

export interface JsonTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; finishReason: string };

export interface ChatRequest {
  model: CatalogModel;
  apiKey: string;
  baseUrl?: string;
  system: string;
  messages: ModelMessage[];
  tools: JsonTool[];
  signal?: AbortSignal;
  sessionId?: string;
  headers?: Record<string, string>;
  auth?: ChatAuth;
  accountId?: string;
}

export interface ScriptedStep {
  text?: string;
  reasoning?: string;
  tools?: ToolCall[];
  usage?: TokenUsage;
}

export function scriptedModel(steps: ScriptedStep[]) {
  let index = 0;
  return async function* (_request: ChatRequest): AsyncGenerator<ChatEvent> {
    const step = steps[index++] ?? { text: "Done." };
    if (step.reasoning) yield { type: "reasoning", text: step.reasoning };
    if (step.text) yield { type: "text", text: step.text };
    for (const tool of step.tools ?? []) yield { type: "tool_call", ...tool };
    if (step.usage) yield { type: "usage", usage: step.usage };
    yield { type: "done", finishReason: step.tools?.length ? "tool_calls" : "stop" };
  };
}

function outputTokens(model: CatalogModel): number {
  const limit = model.output && model.output > 0 ? model.output : 4096;
  return Math.max(256, Math.min(limit, 8192));
}

export function toOpenAIMessages(system: string, messages: ModelMessage[]) {
  const out: Array<Record<string, unknown>> = [{ role: "system", content: system }];
  for (const message of messages) {
    if (message.local) continue;
    if (message.role === "user") out.push({ role: "user", content: message.content });
    else if (message.role === "tool") {
      out.push({ role: "tool", tool_call_id: message.toolCallId, content: message.content });
    } else if (message.role === "assistant") {
      const entry: Record<string, unknown> = { role: "assistant", content: message.content || "" };
      if (message.toolCalls?.length) {
        entry.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        }));
      }
      out.push(entry);
    }
  }
  return out;
}

export function toAnthropicMessages(messages: ModelMessage[]) {
  const blocks: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const message of messages) {
    if (message.local) continue;
    if (message.role === "user") blocks.push({ role: "user", content: message.content });
    else if (message.role === "assistant") {
      const content: Array<Record<string, unknown>> = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.arguments || "{}");
        } catch {
          input = { raw: call.arguments };
        }
        content.push({ type: "tool_use", id: call.id, name: call.name, input });
      }
      blocks.push({ role: "assistant", content: content.length ? content : "" });
    } else {
      blocks.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: message.content,
            is_error: Boolean(message.isError),
          },
        ],
      });
    }
  }
  const merged: typeof blocks = [];
  for (const block of blocks) {
    const prev = merged.at(-1);
    if (prev && prev.role === block.role) {
      const left = Array.isArray(prev.content) ? prev.content : [{ type: "text", text: String(prev.content) }];
      const right = Array.isArray(block.content) ? block.content : [{ type: "text", text: String(block.content) }];
      prev.content = [...left, ...right];
    } else merged.push({ ...block });
  }
  return merged;
}

export function toGeminiContents(messages: ModelMessage[]) {
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
  for (const message of messages) {
    if (message.local) continue;
    if (message.role === "user") contents.push({ role: "user", parts: [{ text: message.content }] });
    else if (message.role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        let args: unknown = {};
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          args = { raw: call.arguments };
        }
        parts.push({ functionCall: { name: call.name, args } });
      }
      contents.push({ role: "model", parts });
    } else {
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name: message.name, response: { result: message.content } } }],
      });
    }
  }
  return contents;
}

async function readError(response: Response): Promise<string> {
  return formatHttpError(response.status, await response.text());
}

export async function* iterateSseData(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    yield* chunksFromText(await response.text());
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = dataFromLine(line);
      if (data) yield data;
    }
  }
  const tail = dataFromLine(buffer);
  if (tail) yield tail;
}

function dataFromLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return undefined;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return undefined;
  return data;
}

function* chunksFromText(text: string): Generator<string> {
  for (const line of text.split("\n")) {
    const data = dataFromLine(line);
    if (data) yield data;
  }
}

interface PartialTool {
  id: string;
  name: string;
  arguments: string;
}

export async function* streamChat(request: ChatRequest): AsyncGenerator<ChatEvent> {
  const apiKey = resolveApiKey(request.model, request.apiKey);
  if (!apiKey) throw new Error(missingKeyMessage(request.model));
  const next: ChatRequest = {
    ...request,
    apiKey,
    auth: request.auth ?? (apiKey === PUBLIC_ZEN_KEY ? "public" : "api"),
  };
  if (next.auth === "codex") {
    yield* streamCodex(next);
    return;
  }
  if (next.model.protocol === "anthropic") yield* streamAnthropic(next);
  else if (next.model.protocol === "google") yield* streamGemini(next);
  else yield* streamOpenAI(next);
}

function requestHeaders(request: ChatRequest): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${request.apiKey}`,
    "Content-Type": "application/json",
  };
  if (isZenProvider(request.model.providerID)) {
    Object.assign(headers, zenHeaders(request.sessionId || "mobile"));
    headers.Authorization = `Bearer ${request.apiKey}`;
  }
  if (request.auth === "copilot") {
    headers["User-Agent"] = OPENCODE_USER_AGENT;
    headers["Openai-Intent"] = "conversation-edits";
    headers["X-GitHub-Api-Version"] = COPILOT_API_VERSION;
    headers["x-initiator"] = "user";
  }
  if (request.model.providerID === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/iboshka24/opencode-mobile";
    headers["X-Title"] = "OpenCode Mobile";
  }
  if (request.headers) Object.assign(headers, request.headers);
  return headers;
}

async function* streamOpenAI(request: ChatRequest): AsyncGenerator<ChatEvent> {
  const base = endpointFor(request.model, request.baseUrl);
  if (!base) throw new Error(`No API base URL for ${request.model.providerID}. Set a custom endpoint in Settings.`);
  const headers = requestHeaders(request);
  const body: Record<string, unknown> = {
    model: request.model.id,
    messages: toOpenAIMessages(request.system, request.messages),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (isZenProvider(request.model.providerID)) {
    const affinity = sessionAffinity(request.sessionId || "mobile");
    body.prompt_cache_key = affinity.startsWith("ses_") ? affinity.slice(4) : affinity;
  }
  if (request.model.temperature) body.temperature = 0.2;
  if (request.tools.length && request.model.toolCall) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
  }
  const response = await fetch(chatCompletionsUrl(base), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: request.signal,
  });
  if (!response.ok) throw new Error(`${request.model.providerID}: ${await readError(response)}`);
  const partials = new Map<number, PartialTool>();
  let finish = "stop";
  for await (const data of iterateSseData(response)) {
    const json = JSON.parse(data) as {
      choices?: Array<{
        finish_reason?: string | null;
        delta?: {
          content?: string;
          reasoning?: string;
          reasoning_content?: string;
          tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const choice = json.choices?.[0];
    const delta = choice?.delta;
    if (delta?.content) yield { type: "text", text: delta.content };
    const reasoning = delta?.reasoning_content || delta?.reasoning;
    if (reasoning) yield { type: "reasoning", text: reasoning };
    for (const call of delta?.tool_calls ?? []) {
      const current = partials.get(call.index) ?? { id: "", name: "", arguments: "" };
      if (call.id) current.id = call.id;
      if (call.function?.name) current.name += call.function.name;
      if (call.function?.arguments) current.arguments += call.function.arguments;
      partials.set(call.index, current);
    }
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (json.usage) {
      yield {
        type: "usage",
        usage: {
          input: json.usage.prompt_tokens ?? 0,
          output: json.usage.completion_tokens ?? 0,
          cacheRead: json.usage.prompt_tokens_details?.cached_tokens ?? 0,
        },
      };
    }
  }
  for (const call of partials.values()) {
    yield { type: "tool_call", id: call.id || `call_${call.name}`, name: call.name, arguments: call.arguments || "{}" };
  }
  yield { type: "done", finishReason: partials.size ? "tool_calls" : finish };
}

async function* streamAnthropic(request: ChatRequest): AsyncGenerator<ChatEvent> {
  const base = endpointFor(request.model, request.baseUrl);
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
  if (request.auth === "oauth") {
    headers.Authorization = `Bearer ${request.apiKey}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  } else {
    headers["x-api-key"] = request.apiKey;
  }
  const response = await fetch(`${base}/v1/messages`, {
    method: "POST",
    signal: request.signal,
    headers,
    body: JSON.stringify({
      model: request.model.id,
      max_tokens: outputTokens(request.model),
      system: request.system,
      messages: toAnthropicMessages(request.messages),
      stream: true,
      ...(request.tools.length && request.model.toolCall
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }
        : {}),
    }),
  });
  if (!response.ok) throw new Error(`Anthropic: ${await readError(response)}`);
  let current: PartialTool | null = null;
  let finish = "end_turn";
  const usage = emptyUsage();
  for await (const data of iterateSseData(response)) {
    const json = JSON.parse(data) as {
      type?: string;
      message?: { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } };
      content_block?: { type?: string; id?: string; name?: string; text?: string };
      delta?: {
        type?: string;
        text?: string;
        thinking?: string;
        partial_json?: string;
        stop_reason?: string;
      };
      usage?: { output_tokens?: number };
    };
    if (json.type === "message_start" && json.message?.usage) {
      usage.input += json.message.usage.input_tokens ?? 0;
      usage.cacheRead = (usage.cacheRead ?? 0) + (json.message.usage.cache_read_input_tokens ?? 0);
    }
    if (json.type === "content_block_start" && json.content_block?.type === "tool_use") {
      current = { id: json.content_block.id ?? "", name: json.content_block.name ?? "", arguments: "" };
    }
    if (json.type === "content_block_delta") {
      if (json.delta?.type === "text_delta" && json.delta.text) yield { type: "text", text: json.delta.text };
      if (json.delta?.type === "thinking_delta" && json.delta.thinking) yield { type: "reasoning", text: json.delta.thinking };
      if (json.delta?.type === "input_json_delta" && current) current.arguments += json.delta.partial_json ?? "";
    }
    if (json.type === "content_block_stop" && current) {
      yield { type: "tool_call", id: current.id, name: current.name, arguments: current.arguments || "{}" };
      current = null;
    }
    if (json.type === "message_delta") {
      if (json.delta?.stop_reason) finish = json.delta.stop_reason;
      usage.output += json.usage?.output_tokens ?? 0;
    }
  }
  if (usage.input || usage.output) yield { type: "usage", usage };
  yield { type: "done", finishReason: finish };
}

async function* streamGemini(request: ChatRequest): AsyncGenerator<ChatEvent> {
  const base = endpointFor(request.model, request.baseUrl);
  const url = `${base}/models/${encodeURIComponent(request.model.id)}:streamGenerateContent?alt=sse`;
  const response = await fetch(url, {
    method: "POST",
    signal: request.signal,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": request.apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: toGeminiContents(request.messages),
      generationConfig: { maxOutputTokens: outputTokens(request.model) },
      ...(request.tools.length && request.model.toolCall
        ? {
            tools: [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                })),
              },
            ],
          }
        : {}),
    }),
  });
  if (!response.ok) throw new Error(`Google: ${await readError(response)}`);
  let finish = "STOP";
  for await (const data of iterateSseData(response)) {
    const json = JSON.parse(data) as {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: { name?: string; args?: unknown } }> };
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    const candidate = json.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.functionCall?.name) {
        yield {
          type: "tool_call",
          id: `gem_${part.functionCall.name}_${Math.random().toString(36).slice(2, 8)}`,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        };
      } else if (part.thought && part.text) yield { type: "reasoning", text: part.text };
      else if (part.text) yield { type: "text", text: part.text };
    }
    if (candidate?.finishReason) finish = candidate.finishReason;
    if (json.usageMetadata) {
      yield {
        type: "usage",
        usage: {
          input: json.usageMetadata.promptTokenCount ?? 0,
          output: json.usageMetadata.candidatesTokenCount ?? 0,
          reasoning: json.usageMetadata.thoughtsTokenCount ?? 0,
        },
      };
    }
  }
  yield { type: "done", finishReason: finish };
}

function toResponsesInput(messages: ModelMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  const input: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    if (message.local) continue;
    if (message.role === "user") input.push({ role: "user", content: message.content });
    else if (message.role === "assistant") {
      const tools = (message.toolCalls ?? []).map((call) => `${call.name} ${call.arguments}`).join("\n");
      const content = [message.content, tools].filter(Boolean).join("\n");
      if (content) input.push({ role: "assistant", content });
    } else input.push({ role: "user", content: `Tool ${message.name} result:\n${message.content}` });
  }
  return input;
}

async function* streamCodex(request: ChatRequest): AsyncGenerator<ChatEvent> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${request.apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": OPENCODE_USER_AGENT,
    originator: "opencode",
    "x-codex-beta-features": "remote_compaction_v2",
    ...(request.accountId ? { "chatgpt-account-id": request.accountId } : {}),
    ...(request.sessionId ? { "session-id": sessionAffinity(request.sessionId) } : {}),
    ...(request.headers ?? {}),
  };
  const response = await fetch(`${CODEX_BASE_URL}/responses`, {
    method: "POST",
    signal: request.signal,
    headers,
    body: JSON.stringify({
      model: request.model.id,
      instructions: request.system,
      input: toResponsesInput(request.messages),
      stream: true,
      store: false,
    }),
  });
  if (!response.ok) throw new Error(`ChatGPT: ${await readError(response)}`);
  for await (const data of iterateSseData(response)) {
    const json = JSON.parse(data) as {
      type?: string;
      delta?: string;
      response?: { usage?: { input_tokens?: number; output_tokens?: number } };
    };
    if ((json.type === "response.output_text.delta" || json.type === "response.reasoning_summary_text.delta") && json.delta) {
      yield { type: json.type.includes("reasoning") ? "reasoning" : "text", text: json.delta };
    }
    if (json.type === "response.completed" && json.response?.usage) {
      yield {
        type: "usage",
        usage: { input: json.response.usage.input_tokens ?? 0, output: json.response.usage.output_tokens ?? 0 },
      };
    }
  }
  yield { type: "done", finishReason: "stop" };
}
