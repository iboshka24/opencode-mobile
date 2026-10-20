import { PROMPTS } from "./prompts";

/**
 * Provider prompt selection follows OpenCode's OptimizePlugin
 * (packages/core/src/plugin/optimize.ts) and SessionSystemPrompt.render
 * (packages/core/src/session/system-prompt.ts). MIT, copyright (c) 2025 opencode.
 */

export function renderPrompt(template: string, tools: readonly string[]): string {
  const instructions: string[] = [];
  if (tools.includes("shell")) {
    instructions.push(
      "- Prefer dedicated tools over shell commands; fall back to the shell when a tool cannot do what you need.",
      "- Do not chain shell commands with separators like `echo \"====\";` or `printf '---'`; the output becomes noisy in a way that makes the user's side of the conversation worse.",
    );
  }
  if (tools.includes("write")) {
    instructions.push(
      "- Use the write tool to create files or completely replace their content. Prefer using the edit tool for targeted changes.",
    );
  }
  if (tools.includes("edit")) {
    instructions.push(
      "- Use the edit tool for targeted changes to existing text files. It replaces the exact text in `oldString` with `newString`, and the values must differ. By default, `oldString` must occur exactly once. If it occurs multiple times, include more surrounding context to make it unique or set `replaceAll` to true to replace every occurrence.",
    );
  }
  return template.replaceAll("${OPENCODE_TOOL_GUIDANCE}", instructions.join("\n"));
}

export function providerTemplate(modelId: string, modelName: string): { text: string; mode: "override" | "append" } | null {
  const id = modelId.toLowerCase();
  if (id.includes("gpt")) {
    return { text: id.includes("astra") ? PROMPTS.gptAstra : PROMPTS.gpt, mode: "override" };
  }
  if (id.includes("claude")) return { text: PROMPTS.anthropic, mode: "append" };
  if (id.includes("kimi")) return { text: PROMPTS.kimi, mode: "override" };
  if (id.includes("trinity")) return { text: PROMPTS.trinity, mode: "override" };
  if (id.includes("muse")) return { text: PROMPTS.meta.replaceAll("{{MODEL_NAME}}", modelName), mode: "override" };
  return null;
}

export const MOBILE_ADDENDUM = `You are running inside OpenCode Mobile, an on-device port of OpenCode. There is no companion computer and no server.

- File tools read and write the in-app workspace only.
- The shell tool is a small JavaScript sandbox, not bash. It can run pwd, ls, cat, echo, mkdir, touch, rm, cp, mv, head, tail, wc, find, and grep. If a command is unsupported, the tool returns an error. Never claim a command ran when the tool reported that it could not.
- Do not invent test, lint, or build results. node, python, npm, cargo, and compilers are not available on the phone.
- Use the git tool for init, status, diff, log, commit, clone, pull, and push. Git talks to GitHub over HTTPS with the token stored on the device.
- When plan mode is active, do not create or edit files and do not commit.`;

export const PLAN_REMINDER = `<system-reminder>
Plan mode is active. The user does not want you to execute changes yet. You MUST NOT make edits, create files, or run mutating git or shell commands. This supersedes other instructions.
You may use read, glob, grep, webfetch, websearch, and todowrite.
When you finish researching, present the plan in the conversation. Do not write a plan file unless the user asks. If they ask you to implement, tell them plan mode is active and they should switch to build.
</system-reminder>`;

export interface SystemPromptInput {
  modelId: string;
  modelName: string;
  providerID: string;
  toolNames: readonly string[];
  workspaceLabel: string;
  git: boolean;
  platform: string;
  agentsMd?: string;
  mode: "build" | "plan";
  today?: string;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const base = renderPrompt(PROMPTS.system, input.toolNames);
  const specific = providerTemplate(input.modelId, input.modelName);
  const rendered = specific
    ? specific.mode === "override"
      ? renderPrompt(specific.text, input.toolNames)
      : `${base}\n\n${renderPrompt(specific.text, input.toolNames)}`
    : base;
  const today = input.today ?? new Date().toDateString();
  const environment = [
    `You are powered by the model named ${input.modelId}. The exact model ID is ${input.providerID}/${input.modelId}.`,
    "Here is some useful information about the environment you are running in:",
    "<env>",
    `  Working directory: ${input.workspaceLabel}`,
    `  Workspace root folder: ${input.workspaceLabel}`,
    `  Is directory a git repo: ${input.git ? "yes" : "no"}`,
    `  Platform: ${input.platform}`,
    "  Shell: on-device sandbox only. Real bash is unavailable.",
    `  Today's date: ${today}`,
    "</env>",
  ].join("\n");
  return [
    rendered,
    environment,
    input.agentsMd?.trim() ? input.agentsMd.trim() : "",
    MOBILE_ADDENDUM,
    input.mode === "plan" ? PLAN_REMINDER : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function initPrompt(args: string, path = "AGENTS.md"): string {
  return PROMPTS.initialize.replaceAll("$ARGUMENTS", args || "(none)").replaceAll("${path}", path);
}

export function reviewPrompt(args: string): string {
  return PROMPTS.review.replaceAll("$ARGUMENTS", args || "(no arguments — review the session diff)");
}
