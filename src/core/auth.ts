import { base64Url, OPENCODE_USER_AGENT, randomBytes, sha256Bytes } from "./identity";

export const CONSOLE_SERVER = "https://console.opencode.ai";
export const CONSOLE_CLIENT_ID = "opencode-cli";
export const COPILOT_CLIENT_ID = "Ov23li8tweQw6odWQebz";
export const COPILOT_API_VERSION = "2026-08-01";
export const COPILOT_USER_API_VERSION = "2025-04-01";
export const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_ISSUER = "https://auth.openai.com";
export const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const ANTHROPIC_REDIRECT = "https://console.anthropic.com/oauth/code/callback";
export const ANTHROPIC_SCOPES = "org:create_api_key user:profile user:inference";

export interface DeviceChallenge {
  userCode: string;
  verificationUrl: string;
  deviceCode: string;
  intervalSec: number;
  expiresIn: number;
}

export type DevicePoll =
  | { status: "pending" }
  | { status: "slow_down"; intervalSec?: number }
  | { status: "ok"; access: string; refresh: string; expiresIn: number; orgId?: string }
  | { status: "error"; message: string };

export interface OpenAIDevice {
  deviceAuthId: string;
  userCode: string;
  intervalSec: number;
  verificationUrl: string;
}

export type OpenAIPoll =
  | { status: "pending" }
  | { status: "exchange"; code: string; verifier: string }
  | { status: "error"; message: string };

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent": OPENCODE_USER_AGENT,
};

export function formatHttpError(status: number, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return `HTTP ${status}`;
  try {
    const json = JSON.parse(trimmed) as { error?: { message?: string } | string; message?: string };
    const nested = json.error;
    const message = typeof nested === "string" ? nested : nested?.message || json.message;
    if (typeof message === "string" && message.trim()) return `HTTP ${status}: ${message.trim()}`;
  } catch {
    // The body is not JSON. Show the raw text.
  }
  return `HTTP ${status}: ${trimmed.slice(0, 500)}`;
}

function record(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function seconds(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(text(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseConsoleDevice(body: unknown): DeviceChallenge {
  const item = record(body);
  const userCode = text(item.user_code);
  const verificationUrl = text(item.verification_uri_complete) || text(item.verification_uri);
  const deviceCode = text(item.device_code);
  if (!userCode || !verificationUrl || !deviceCode) throw new Error("Console did not return a device code.");
  return {
    userCode,
    verificationUrl,
    deviceCode,
    intervalSec: seconds(item.interval, 5),
    expiresIn: seconds(item.expires_in, 600),
  };
}

export function parseCopilotDevice(body: unknown): DeviceChallenge {
  const item = record(body);
  const userCode = text(item.user_code);
  const verificationUrl = text(item.verification_uri);
  const deviceCode = text(item.device_code);
  if (!userCode || !verificationUrl || !deviceCode) throw new Error("GitHub did not return a device code.");
  return {
    userCode,
    verificationUrl,
    deviceCode,
    intervalSec: seconds(item.interval, 5),
    expiresIn: seconds(item.expires_in, 900),
  };
}

export function parseDeviceToken(body: unknown): DevicePoll {
  const item = record(body);
  const access = text(item.access_token);
  if (access) {
    return {
      status: "ok",
      access,
      refresh: text(item.refresh_token) || access,
      expiresIn: seconds(item.expires_in, 0),
      orgId: text(item.org_id) || undefined,
    };
  }
  if (item.error === "authorization_pending") return { status: "pending" };
  if (item.error === "slow_down") return { status: "slow_down", intervalSec: seconds(item.interval, 0) || undefined };
  if (typeof item.error === "string") return { status: "error", message: item.error };
  return { status: "error", message: "Unrecognized token response" };
}

export function parseOpenAIDevice(body: unknown): OpenAIDevice {
  const item = record(body);
  const deviceAuthId = text(item.device_auth_id);
  const userCode = text(item.user_code);
  if (!deviceAuthId || !userCode) throw new Error("ChatGPT did not return a device code.");
  return {
    deviceAuthId,
    userCode,
    intervalSec: seconds(item.interval, 5),
    verificationUrl: `${OPENAI_ISSUER}/codex/device`,
  };
}

export function parseOpenAIDeviceToken(status: number, body: unknown): OpenAIPoll {
  if (status === 403 || status === 404) return { status: "pending" };
  if (status < 200 || status >= 300) {
    const message = typeof body === "string" ? body : JSON.stringify(body ?? "");
    return { status: "error", message: formatHttpError(status, message) };
  }
  const item = record(body);
  const code = text(item.authorization_code);
  const verifier = text(item.code_verifier);
  if (!code || !verifier) return { status: "error", message: "ChatGPT device response was missing a code." };
  return { status: "exchange", code, verifier };
}

export function openAIExchangeForm(code: string, verifier: string): string {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${OPENAI_ISSUER}/deviceauth/callback`,
    client_id: OPENAI_CLIENT_ID,
    code_verifier: verifier,
  }).toString();
}

export function accountIdFromIdToken(idToken: string): string | undefined {
  const payload = idToken.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(decodeBase64Url(payload)) as {
      chatgpt_account_id?: string;
      organizations?: Array<{ id?: string }>;
      "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
    };
    return json["https://api.openai.com/auth"]?.chatgpt_account_id || json.chatgpt_account_id || json.organizations?.[0]?.id || undefined;
  } catch {
    return undefined;
  }
}

export function decodeBase64Url(input: string): string {
  const padded = input.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function anthropicLogin(): { verifier: string; state: string; url: string } {
  const verifier = base64Url(randomBytes(32));
  let state = base64Url(randomBytes(16));
  if (state === verifier) state = `${state}x`;
  const challenge = base64Url(sha256Bytes(new TextEncoder().encode(verifier)));
  const url = new URL("https://claude.ai/oauth/authorize");
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", ANTHROPIC_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", ANTHROPIC_REDIRECT);
  url.searchParams.set("scope", ANTHROPIC_SCOPES);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return { verifier, state, url: url.toString() };
}

export function parseAnthropicCode(pasted: string, expectedState: string): { code: string; state: string } {
  const trimmed = pasted.trim();
  const hash = trimmed.indexOf("#");
  const code = (hash === -1 ? trimmed : trimmed.slice(0, hash)).trim();
  const state = hash === -1 ? "" : trimmed.slice(hash + 1).trim();
  if (!code) throw new Error("Paste the code from the Claude page.");
  if (state && state !== expectedState) throw new Error("That code was issued for a different sign-in. Start again.");
  return { code, state: state || expectedState };
}

export function anthropicTokenBody(input: { code: string; verifier: string; state: string }): Record<string, string> {
  return {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: ANTHROPIC_REDIRECT,
    client_id: ANTHROPIC_CLIENT_ID,
    code_verifier: input.verifier,
    state: input.state,
  };
}

export function copilotEntitlementError(user: { chat_enabled?: boolean; can_signup_for_limited?: boolean }): string | undefined {
  if (user.chat_enabled !== false) return undefined;
  if (user.can_signup_for_limited) {
    return "This GitHub account is not signed up for GitHub Copilot. Sign up for Copilot Free and connect again.";
  }
  return "This GitHub account does not have GitHub Copilot access.";
}

async function readBody(response: Response): Promise<{ status: number; body: unknown; text: string }> {
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  return { status: response.status, body, text };
}

export async function startConsoleLogin(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<DeviceChallenge> {
  const response = await fetchImpl(`${CONSOLE_SERVER}/auth/device/code`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ client_id: CONSOLE_CLIENT_ID, supports_org_scope: true }),
    signal,
  });
  const read = await readBody(response);
  if (read.status < 200 || read.status >= 300) throw new Error(formatHttpError(read.status, read.text));
  return parseConsoleDevice(read.body);
}

export async function pollConsoleLogin(deviceCode: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<DevicePoll> {
  const response = await fetchImpl(`${CONSOLE_SERVER}/auth/device/token`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: CONSOLE_CLIENT_ID,
    }),
    signal,
  });
  const read = await readBody(response);
  if (read.body && typeof read.body === "object") return parseDeviceToken(read.body);
  if (read.status < 200 || read.status >= 300) return { status: "error", message: formatHttpError(read.status, read.text) };
  return parseDeviceToken(read.body);
}

export function copilotDomain(enterpriseUrl: string | undefined): string {
  const trimmed = enterpriseUrl?.trim() ?? "";
  if (!trimmed) return "github.com";
  return trimmed.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function startCopilotLogin(enterpriseUrl: string | undefined, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<DeviceChallenge> {
  const domain = copilotDomain(enterpriseUrl);
  const response = await fetchImpl(`https://${domain}/login/device/code`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ client_id: COPILOT_CLIENT_ID, scope: "read:user" }),
    signal,
  });
  const read = await readBody(response);
  if (read.status < 200 || read.status >= 300) throw new Error(formatHttpError(read.status, read.text));
  return parseCopilotDevice(read.body);
}

export async function pollCopilotLogin(deviceCode: string, enterpriseUrl: string | undefined, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<DevicePoll> {
  const domain = copilotDomain(enterpriseUrl);
  const response = await fetchImpl(`https://${domain}/login/oauth/access_token`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
    signal,
  });
  const read = await readBody(response);
  if (read.body && typeof read.body === "object") return parseDeviceToken(read.body);
  return { status: "error", message: formatHttpError(read.status, read.text) };
}

export async function copilotProfile(
  access: string,
  enterpriseUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ apiEndpoint?: string; error?: string }> {
  const domain = copilotDomain(enterpriseUrl);
  const url = domain === "github.com" ? "https://api.github.com/copilot_internal/user" : `https://api.${domain}/copilot_internal/user`;
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${access}`,
        "User-Agent": OPENCODE_USER_AGENT,
        "X-GitHub-Api-Version": COPILOT_USER_API_VERSION,
      },
    });
    const read = await readBody(response);
    if (read.status < 200 || read.status >= 300 || !read.body || typeof read.body !== "object") return {};
    const user = read.body as { chat_enabled?: boolean; can_signup_for_limited?: boolean; endpoints?: { api?: string } };
    return { error: copilotEntitlementError(user), apiEndpoint: user.endpoints?.api?.replace(/\/+$/, "") };
  } catch {
    return {};
  }
}

export async function startOpenAILogin(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<OpenAIDevice> {
  const response = await fetchImpl(`${OPENAI_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ client_id: OPENAI_CLIENT_ID }),
    signal,
  });
  const read = await readBody(response);
  if (read.status < 200 || read.status >= 300) throw new Error(formatHttpError(read.status, read.text));
  return parseOpenAIDevice(read.body);
}

export async function pollOpenAILogin(deviceAuthId: string, userCode: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<OpenAIPoll> {
  const response = await fetchImpl(`${OPENAI_ISSUER}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
    signal,
  });
  const read = await readBody(response);
  return parseOpenAIDeviceToken(read.status, read.body);
}

export async function exchangeOpenAICode(code: string, verifier: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<{ access: string; refresh: string; accountId?: string; expiresIn: number }> {
  const response = await fetchImpl(`${OPENAI_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": OPENCODE_USER_AGENT },
    body: openAIExchangeForm(code, verifier),
    signal,
  });
  const read = await readBody(response);
  if (read.status < 200 || read.status >= 300) throw new Error(formatHttpError(read.status, read.text));
  const item = record(read.body);
  const access = text(item.access_token);
  if (!access) throw new Error("ChatGPT did not return an access token.");
  return {
    access,
    refresh: text(item.refresh_token) || access,
    accountId: text(item.id_token) ? accountIdFromIdToken(text(item.id_token)) : undefined,
    expiresIn: seconds(item.expires_in, 0),
  };
}

export async function exchangeAnthropicCode(input: { code: string; verifier: string; state: string }, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<{ access: string; refresh: string; expiresIn: number }> {
  const response = await fetchImpl("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(anthropicTokenBody(input)),
    signal,
  });
  const read = await readBody(response);
  if (read.status < 200 || read.status >= 300) throw new Error(formatHttpError(read.status, read.text));
  const item = record(read.body);
  const access = text(item.access_token);
  if (!access) throw new Error("Claude did not return an access token.");
  return { access, refresh: text(item.refresh_token) || access, expiresIn: seconds(item.expires_in, 0) };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
