import { loadAgentsMd } from "./agents-md";
import { unifiedDiff } from "./difftext";
import { applyEdit } from "./edit";
import { runGit, type GitAuthor, type GitRequest } from "./git";
import { applyPatch, parsePatch } from "./patch";
import { PROMPTS } from "./prompts";
import { SANDBOX_NOTE, runSandbox, sandboxMutates } from "./sandbox";
import { formatGlob, formatGrep, globSearch, grepSearch } from "./search";
import { clip, fetchWeb, searchWeb } from "./web";
import { NotFoundError, type Workspace } from "./workspace";

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface FileChange {
  path: string;
  before: string | null;
  after: string | null;
  summary: string;
}

export interface PermissionPolicy {
  edit: "ask" | "allow";
  shell: "ask" | "allow";
  git: "ask" | "allow";
  network: "ask" | "allow";
}

export const DEFAULT_POLICY: PermissionPolicy = {
  edit: "ask",
  shell: "ask",
  git: "ask",
  network: "allow",
};

export interface ToolContext {
  workspace: Workspace;
  mode: "build" | "plan";
  todos: Todo[];
  changes: FileChange[];
  policy: PermissionPolicy;
  githubToken?: string;
  braveKey?: string;
  gitAuthor: GitAuthor;
  askPermission: (action: string, detail: string) => Promise<"allow" | "deny" | "always">;
  askUser: (question: string) => Promise<string>;
  signal?: AbortSignal;
}

export interface JsonTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ToolDef extends JsonTool {
  readOnly: boolean;
  plan: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const str = (description: string) => ({ type: "string", description });
const bool = (description: string) => ({ type: "boolean", description });
const num = (description: string) => ({ type: "number", description });

async function authorize(ctx: ToolContext, action: keyof PermissionPolicy, detail: string, blockedInPlan: boolean) {
  if (ctx.mode === "plan" && blockedInPlan) {
    throw new Error("Plan mode is active. Switch to build before changing files or running mutating commands.");
  }
  if (ctx.policy[action] === "allow") return;
  const decision = await ctx.askPermission(action, detail);
  if (decision === "deny") throw new Error(`User denied permission to ${action}: ${detail}`);
  if (decision === "always") ctx.policy[action] = "allow";
}

async function readOptional(workspace: Workspace, path: string): Promise<string | null> {
  try {
    return await workspace.readText(path);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

function record(ctx: ToolContext, path: string, before: string | null, after: string | null, summary: string) {
  ctx.changes.push({ path, before, after, summary });
}

function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function formatRead(path: string, content: string, offset = 1, limit = 2000): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, offset);
  const slice = lines.slice(start - 1, start - 1 + limit);
  const numbered = slice.map((line, index) => `${start + index}: ${line}`).join("\n");
  const note = start - 1 + slice.length < lines.length ? `\n(showing lines ${start}-${start + slice.length - 1} of ${lines.length})` : "";
  return `<file path="${path}">\n${numbered}${note}\n</file>`;
}

const TOOLS: ToolDef[] = [
  {
    name: "read",
    readOnly: true,
    plan: true,
    description:
      "Read the contents of a file or directory. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
    parameters: objectSchema(
      {
        path: str("File or directory to read"),
        offset: num("The line or directory entry to start reading from (1-based)"),
        limit: num("The maximum number of lines or directory entries to read (defaults to and capped at 2000)"),
      },
      ["path"],
    ),
    async run(args, ctx) {
      const path = argString(args, "path");
      const offset = typeof args.offset === "number" ? args.offset : 1;
      const limit = typeof args.limit === "number" ? Math.min(args.limit, 2000) : 2000;
      const stat = await ctx.workspace.stat(path);
      if (!stat) throw new Error(`Not found: ${path}`);
      if (stat.kind === "dir") {
        const entries = await ctx.workspace.list(path);
        const slice = entries.slice(Math.max(0, offset - 1), Math.max(0, offset - 1) + limit);
        return slice.map((entry) => (entry.kind === "dir" ? `${entry.name}/` : entry.name)).join("\n") || "(empty directory)";
      }
      return formatRead(path, await ctx.workspace.readText(path), offset, limit);
    },
  },
  {
    name: "glob",
    readOnly: true,
    plan: true,
    description: 'Search file paths using a glob pattern (examples: "**/*.ts", "src/**/*.tsx").',
    parameters: objectSchema(
      {
        pattern: str("Glob pattern to match files against"),
        path: str("Directory to search. Defaults to the current working directory."),
        hidden: bool("Include hidden files and directories (default: false)."),
        limit: num("Maximum number of matching files to return (default: 100)"),
      },
      ["pattern"],
    ),
    async run(args, ctx) {
      const result = await globSearch(ctx.workspace, argString(args, "pattern"), {
        path: typeof args.path === "string" ? args.path : undefined,
        hidden: args.hidden === true,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
      return formatGlob(result.paths, result.truncated);
    },
  },
  {
    name: "grep",
    readOnly: true,
    plan: true,
    description:
      "Search file contents using regular expression syntax or literal text matching. Use it to locate specific code, symbols, or text patterns, and narrow searches with `path` or `include`. Returns matching file paths, line numbers, and line previews.",
    parameters: objectSchema(
      {
        pattern: str("Regular expression or literal text to match in file contents."),
        path: str("File or directory to search. Defaults to the current working directory."),
        include: str('Glob pattern to filter files (for example, "*.js" or "*.{ts,tsx}")'),
        literal: bool("Treat `pattern` as exact text instead of a regular expression (default: false)."),
        caseSensitive: bool("Use case-sensitive matching (default: true)."),
        limit: num("Maximum number of matching lines to return (default: 100)"),
      },
      ["pattern"],
    ),
    async run(args, ctx) {
      const result = await grepSearch(ctx.workspace, argString(args, "pattern"), {
        path: typeof args.path === "string" ? args.path : undefined,
        include: typeof args.include === "string" ? args.include : undefined,
        literal: args.literal === true,
        caseSensitive: args.caseSensitive !== false,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
      return formatGrep(result.matches, result.truncated);
    },
  },
  {
    name: "write",
    readOnly: false,
    plan: false,
    description:
      "Writes a file to the local filesystem, overwriting if one exists.\n\nMissing parent directories are created automatically.\n\nUse this tool to create new files or overwrite existing files. For partial changes, use the edit tool instead.",
    parameters: objectSchema(
      {
        path: str("Path to the file to write to"),
        content: str("Content to write to the file"),
      },
      ["path", "content"],
    ),
    async run(args, ctx) {
      const path = argString(args, "path");
      const content = typeof args.content === "string" ? args.content : "";
      await authorize(ctx, "edit", `write ${path}`, true);
      const before = await readOptional(ctx.workspace, path);
      await ctx.workspace.writeText(path, content);
      record(ctx, path, before, content, before === null ? "created" : "wrote");
      return `${before === null ? "Created" : "Wrote"} file successfully: ${path}`;
    },
  },
  {
    name: "edit",
    readOnly: false,
    plan: false,
    description:
      "Edit a file by replacing the exact text in oldString with newString. The values must differ. By default oldString must occur exactly once. If it occurs multiple times, include more surrounding context or set replaceAll to true.",
    parameters: objectSchema(
      {
        path: str("File to edit"),
        oldString: str("Exact text to find and replace"),
        newString: str("Text to replace oldString with (must differ from oldString)"),
        replaceAll: bool("Whether to replace every occurrence of oldString. When false, oldString must match exactly once. Defaults to false."),
      },
      ["path", "oldString", "newString"],
    ),
    async run(args, ctx) {
      const path = argString(args, "path");
      const oldString = typeof args.oldString === "string" ? args.oldString : "";
      const newString = typeof args.newString === "string" ? args.newString : "";
      await authorize(ctx, "edit", `edit ${path}`, true);
      const before = await ctx.workspace.readText(path);
      const result = applyEdit(before, oldString, newString, args.replaceAll === true);
      await ctx.workspace.writeText(path, result.content);
      record(ctx, path, before, result.content, `edited (${result.replacements})`);
      return `Edited ${path} (${result.replacements} replacement${result.replacements === 1 ? "" : "s"}).\n${unifiedDiff(path, before, result.content)}`;
    },
  },
  {
    name: "patch",
    readOnly: false,
    plan: false,
    description: PROMPTS.patch,
    parameters: objectSchema({ patch: str("The full patch, starting with *** Begin Patch and ending with *** End Patch") }, ["patch"]),
    async run(args, ctx) {
      const patch = argString(args, "patch");
      const ops = parsePatch(patch);
      const paths = ops.map((op) => op.path);
      await authorize(ctx, "edit", `patch ${paths.join(", ")}`, true);
      const befores = new Map<string, string | null>();
      for (const op of ops) befores.set(op.path, await readOptional(ctx.workspace, op.path));
      const summary = await applyPatch(ctx.workspace, patch);
      for (const op of ops) {
        const dest = op.type === "update" && op.moveTo ? op.moveTo : op.path;
        const after = op.type === "delete" ? null : await readOptional(ctx.workspace, dest);
        record(ctx, dest, befores.get(op.path) ?? null, after, op.type);
      }
      return `Patch applied. added: ${summary.added.join(", ") || "none"}. updated: ${summary.updated.join(", ") || "none"}. deleted: ${summary.deleted.join(", ") || "none"}.`;
    },
  },
  {
    name: "todowrite",
    readOnly: true,
    plan: true,
    description: PROMPTS.todowrite,
    parameters: objectSchema(
      {
        todos: {
          type: "array",
          description: "The updated todo list",
          items: {
            type: "object",
            properties: {
              content: str("Brief description of the task"),
              status: str("Current status of the task: pending, in_progress, completed, cancelled"),
            },
            required: ["content", "status"],
          },
        },
      },
      ["todos"],
    ),
    async run(args, ctx) {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      const next: Todo[] = todos.map((item) => {
        const record = item as { content?: string; status?: Todo["status"] };
        const status = record.status ?? "pending";
        if (!["pending", "in_progress", "completed", "cancelled"].includes(status)) {
          throw new Error(`Invalid todo status: ${status}`);
        }
        return { content: String(record.content ?? ""), status };
      });
      ctx.todos.splice(0, ctx.todos.length, ...next);
      const completed = next.filter((todo) => todo.status === "completed").length;
      const active = next.filter((todo) => todo.status === "in_progress").map((todo) => todo.content);
      return `Todos updated: ${completed}/${next.length} completed${active.length ? `. In progress: ${active.join(", ")}` : ""}`;
    },
  },
  {
    name: "webfetch",
    readOnly: true,
    plan: true,
    description:
      "Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default. This tool is read-only. There is no companion server; the phone requests the URL directly.",
    parameters: objectSchema(
      {
        url: str("The HTTP or HTTPS URL to fetch content from"),
        format: str("The format to return the content in: text, markdown, or html. Defaults to markdown."),
        timeout: num("Optional timeout in seconds (maximum 120)"),
      },
      ["url"],
    ),
    async run(args, ctx) {
      const url = argString(args, "url");
      await authorize(ctx, "network", `fetch ${url}`, false);
      const format = args.format === "text" || args.format === "html" ? args.format : "markdown";
      return fetchWeb(url, format, ctx.signal);
    },
  },
  {
    name: "websearch",
    readOnly: true,
    plan: true,
    description: `Search the web. The current year is ${new Date().getFullYear()}. Use this for current information beyond knowledge cutoff. Results come from DuckDuckGo on the device, or Brave if the user saved a Brave API key. There is no self-hosted search backend.`,
    parameters: objectSchema({ query: str("Web search query") }, ["query"]),
    async run(args, ctx) {
      const query = argString(args, "query");
      await authorize(ctx, "network", `search ${query}`, false);
      return searchWeb(query, ctx.braveKey, ctx.signal);
    },
  },
  {
    name: "shell",
    readOnly: false,
    plan: true,
    description: `Execute a command and return its output. ${SANDBOX_NOTE} Quote file paths containing spaces. Prefer dedicated tools over shell commands when possible.`,
    parameters: objectSchema(
      {
        command: str("Command string to execute"),
        workdir: str("Working directory. Defaults to the workspace root."),
      },
      ["command"],
    ),
    async run(args, ctx) {
      const command = argString(args, "command");
      const mutates = sandboxMutates(command);
      if (mutates) await authorize(ctx, "shell", command, true);
      const result = await runSandbox(ctx.workspace, command, typeof args.workdir === "string" ? args.workdir : "");
      const body = result.output || (result.exit === 0 ? "(no output)" : "");
      return `exit ${result.exit}\n${clip(body)}`;
    },
  },
  {
    name: "git",
    readOnly: false,
    plan: true,
    description:
      "Git operations implemented with isomorphic-git inside the app. There is no system git binary. Actions: init, status, diff, log, commit, clone, pull, push. clone/pull/push talk to the remote over HTTPS. Push needs the GitHub token saved in Settings. Do not claim a git shell command ran.",
    parameters: objectSchema(
      {
        action: str("init, status, diff, log, commit, clone, pull, or push"),
        url: str("Remote URL for clone"),
        message: str("Commit message"),
        remote: str("Remote name, default origin"),
        branch: str("Branch name, default main"),
        dir: str("Workspace subdirectory. Defaults to the workspace root."),
      },
      ["action"],
    ),
    async run(args, ctx) {
      const action = argString(args, "action") as GitRequest["action"];
      const readOnly = action === "status" || action === "diff" || action === "log";
      if (!readOnly) await authorize(ctx, "git", `${action} ${args.url ?? args.message ?? ""}`.trim(), true);
      return runGit(
        ctx.workspace,
        {
          action,
          url: typeof args.url === "string" ? args.url : undefined,
          message: typeof args.message === "string" ? args.message : undefined,
          remote: typeof args.remote === "string" ? args.remote : undefined,
          branch: typeof args.branch === "string" ? args.branch : undefined,
          dir: typeof args.dir === "string" ? args.dir : undefined,
        },
        ctx.gitAuthor,
        ctx.githubToken,
      );
    },
  },
  {
    name: "question",
    readOnly: true,
    plan: true,
    description: "Ask the user a single clarifying question and wait for their answer. Use this when you are blocked, not for routine confirmation.",
    parameters: objectSchema({ question: str("The question to show the user") }, ["question"]),
    async run(args, ctx) {
      const question = argString(args, "question");
      const answer = await ctx.askUser(question);
      return answer.trim() || "(The user dismissed the question.)";
    },
  },
];

export function toolDefinitions(mode: "build" | "plan"): JsonTool[] {
  return TOOLS.filter((tool) => mode === "build" || tool.plan).map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

export function toolNames(mode: "build" | "plan"): string[] {
  return toolDefinitions(mode).map((tool) => tool.name);
}

export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const tool = TOOLS.find((item) => item.name === name);
  if (!tool) return { content: `Unknown tool: ${name}`, isError: true };
  if (ctx.mode === "plan" && !tool.plan) {
    return { content: "Plan mode is active. Switch to build before using this tool.", isError: true };
  }
  const args = rawArgs && typeof rawArgs === "object" ? (rawArgs as Record<string, unknown>) : {};
  try {
    const content = await tool.run(args, ctx);
    return { content: clip(content), isError: false };
  } catch (error) {
    return { content: error instanceof Error ? error.message : String(error), isError: true };
  }
}

export async function agentsInstructions(workspace: Workspace): Promise<string> {
  return loadAgentsMd(workspace);
}
