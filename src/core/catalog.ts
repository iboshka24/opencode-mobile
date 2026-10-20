import snapshot from "./models.snapshot.json";

export type Protocol = "openai" | "anthropic" | "google";

export interface ModelCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface CatalogModel {
  providerID: string;
  providerName: string;
  id: string;
  name: string;
  api?: string;
  npm?: string;
  env: string[];
  doc?: string;
  family?: string;
  toolCall: boolean;
  reasoning: boolean;
  temperature: boolean;
  cost?: ModelCost;
  context?: number;
  output?: number;
  protocol: Protocol;
}

interface RawProvider {
  id?: string;
  name?: string;
  npm?: string;
  api?: string;
  env?: string[];
  doc?: string;
  models?: Record<string, RawModel> | RawModel[];
}

interface RawModel {
  id?: string;
  name?: string;
  family?: string;
  tool_call?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  cost?: ModelCost;
  limit?: { context?: number; output?: number };
}

const DEFAULT_APIS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  xai: "https://api.x.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api/v1",
  opencode: "https://opencode.ai/inference/openai/v1",
  "opencode-go": "https://opencode.ai/inference/go/openai/v1",
};

export const BUILTIN_PROVIDER_IDS = [
  "opencode",
  "opencode-go",
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "deepseek",
  "groq",
  "xai",
  "mistral",
] as const;

export function protocolFor(npm: string | undefined, providerID: string): Protocol {
  if (npm === "@ai-sdk/anthropic" || providerID === "anthropic") return "anthropic";
  if (npm === "@ai-sdk/google" || providerID === "google") return "google";
  return "openai";
}

export function parseCatalog(raw: unknown): CatalogModel[] {
  if (!raw || typeof raw !== "object") return [];
  const models: CatalogModel[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, RawProvider>)) {
    if (!value || typeof value !== "object" || !value.models) continue;
    const providerID = value.id || key;
    const list = Array.isArray(value.models) ? value.models : Object.values(value.models);
    for (const model of list) {
      if (!model?.id) continue;
      models.push({
        providerID,
        providerName: value.name || providerID,
        id: model.id,
        name: model.name || model.id,
        api: value.api,
        npm: value.npm,
        env: value.env ?? [],
        doc: value.doc,
        family: model.family,
        toolCall: model.tool_call !== false,
        reasoning: Boolean(model.reasoning),
        temperature: model.temperature !== false,
        cost: model.cost,
        context: model.limit?.context,
        output: model.limit?.output,
        protocol: protocolFor(value.npm, providerID),
      });
    }
  }
  return models;
}

export function snapshotCatalog(): CatalogModel[] {
  return parseCatalog(snapshot);
}

export function isFree(model: CatalogModel): boolean {
  const input = model.cost?.input ?? -1;
  const output = model.cost?.output ?? -1;
  return input === 0 && output === 0;
}

export function endpointFor(model: CatalogModel, override?: string): string {
  const base = (override || model.api || DEFAULT_APIS[model.providerID] || "").replace(/\/$/, "");
  return base;
}

export function chatCompletionsUrl(base: string): string {
  const trimmed = base.replace(/\/$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function findModel(models: CatalogModel[], providerID: string, id: string): CatalogModel | undefined {
  return models.find((model) => model.providerID === providerID && model.id === id);
}

export const MODELS_DEV_URL = "https://models.dev/api.json";
