import type { CatalogModel } from "./catalog";

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
}

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

export function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: (left.cacheRead ?? 0) + (right.cacheRead ?? 0),
    cacheWrite: (left.cacheWrite ?? 0) + (right.cacheWrite ?? 0),
    reasoning: (left.reasoning ?? 0) + (right.reasoning ?? 0),
  };
}

/** USD from models.dev prices, which are quoted per 1M tokens. */
export function usageCost(model: CatalogModel | undefined, usage: TokenUsage): number {
  const cost = model?.cost;
  if (!cost) return 0;
  const cached = usage.cacheRead ?? 0;
  const freshInput = Math.max(0, usage.input - cached);
  const input = (freshInput * (cost.input ?? 0)) / 1_000_000;
  const cache = (cached * (cost.cache_read ?? cost.input ?? 0)) / 1_000_000;
  const output = (usage.output * (cost.output ?? 0)) / 1_000_000;
  const write = ((usage.cacheWrite ?? 0) * (cost.cache_write ?? 0)) / 1_000_000;
  return input + cache + output + write;
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  return `${Math.round(count / 1000)}k`;
}

export function formatCost(usd: number): string {
  if (!usd) return "$0";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
