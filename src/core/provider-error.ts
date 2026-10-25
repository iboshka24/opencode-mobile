export interface ProviderNotice {
  kind: "free-limit" | "region" | "auth" | "other";
  title: string;
  message: string;
}

export function classifyProviderError(raw: string, signedIn: boolean): ProviderNotice {
  const lower = raw.toLowerCase();
  if (lower.includes("freeusagelimit") || lower.includes("free usage limit")) {
    return signedIn
      ? {
          kind: "free-limit",
          title: "Free allowance used up",
          message: "This OpenCode account has used its free allowance for now. Switch models, connect GitHub Copilot, or wait until it resets.",
        }
      : {
          kind: "free-limit",
          title: "Shared network limit",
          message: "Anonymous Zen is one allowance for the whole network. A phone on mobile data often hits it on the first message. Sign in to OpenCode to get your own.",
        };
  }
  if (lower.includes("not available in your country") || lower.includes("unsupported_country") || lower.includes("unsupported country")) {
    return {
      kind: "region",
      title: "Not available in your country",
      message: "This model is blocked here. Another free model will be used when one is available.",
    };
  }
  if (lower.includes("401") || lower.includes("invalid api key") || lower.includes("authentication")) {
    return {
      kind: "auth",
      title: "Sign in again",
      message: "OpenCode rejected this sign-in. Connect the account again.",
    };
  }
  const message = raw.replace(/^[\w.-]+:\s*/i, "").replace(/^HTTP \d+:\s*/i, "").trim() || "The request failed.";
  return { kind: "other", title: "Request failed", message: message.slice(0, 280) };
}
