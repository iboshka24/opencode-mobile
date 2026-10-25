export type SlashCommand =
  | { type: "help" }
  | { type: "plan" }
  | { type: "build" }
  | { type: "new" }
  | { type: "undo" }
  | { type: "cost" }
  | { type: "compact" }
  | { type: "theme"; name: string }
  | { type: "model"; query: string }
  | { type: "init"; args: string }
  | { type: "review"; args: string }
  | { type: "unknown"; name: string }
  | { type: "prompt"; text: string };

const HELP = [
  "/build — full tools, edits ask permission",
  "/plan — read-only research",
  "/init — write AGENTS.md for this workspace",
  "/review — review the session diff",
  "/model — pick a model",
  "/theme <name> — switch theme",
  "/undo — revert the last file change",
  "/cost — show token and cost totals",
  "/compact — summarize the session",
  "/new — start a session",
  "/help — this list",
  "Free OpenCode Zen models work with no API key. Connect Console, Copilot, ChatGPT, or Claude from the connect screen.",
].join("\n");

export function helpText(): string {
  return HELP;
}

export function parseSlash(input: string): SlashCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { type: "prompt", text: input };
  const body = trimmed.slice(1).trim();
  const [head = "", ...rest] = body.split(/\s+/);
  const name = head.toLowerCase();
  const args = rest.join(" ");
  switch (name) {
    case "help":
      return { type: "help" };
    case "plan":
      return { type: "plan" };
    case "build":
      return { type: "build" };
    case "new":
    case "clear":
      return { type: "new" };
    case "undo":
      return { type: "undo" };
    case "cost":
      return { type: "cost" };
    case "compact":
      return { type: "compact" };
    case "theme":
    case "themes":
      return { type: "theme", name: args };
    case "model":
    case "models":
      return { type: "model", query: args };
    case "init":
      return { type: "init", args };
    case "review":
      return { type: "review", args };
    default:
      return { type: "unknown", name };
  }
}
