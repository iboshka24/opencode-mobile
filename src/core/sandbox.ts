import { baseName, joinPath, normalizePath } from "./paths";
import type { Workspace } from "./workspace";

const SUPPORTED = ["pwd", "ls", "cat", "echo", "mkdir", "touch", "rm", "cp", "mv", "head", "tail", "wc", "find", "grep"];

export const SANDBOX_NOTE = [
  "OpenCode Mobile cannot run a real shell on iOS or Android.",
  `The on-device sandbox supports: ${SUPPORTED.join(", ")}.`,
  "bash, sh, node, python, npm, compilers, and test runners are not available.",
  "The tool returns an error instead of pretending the command ran.",
  "Use the git tool for clone, status, diff, log, commit, pull, and push.",
].join(" ");

interface Parsed {
  argv: string[];
}

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | "" = "";
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("Unclosed quote in command");
  if (current) tokens.push(current);
  return tokens;
}

function parse(command: string): Parsed {
  if (/[|&;<>`$]/.test(command) || command.includes("\n")) {
    throw new Error(
      `Compound commands, pipes, and redirects are not available in the on-device sandbox. ${SANDBOX_NOTE}`,
    );
  }
  const argv = tokenize(command.trim());
  if (argv.length === 0) throw new Error("Empty command");
  return { argv };
}

async function listDir(workspace: Workspace, path: string): Promise<string> {
  const entries = await workspace.list(path);
  return entries.map((entry) => (entry.kind === "dir" ? `${entry.name}/` : entry.name)).join("\n");
}

export async function runSandbox(
  workspace: Workspace,
  command: string,
  workdir = "",
): Promise<{ output: string; exit: number; mutated: boolean }> {
  let argv: string[];
  try {
    argv = parse(command).argv;
  } catch (error) {
    return { exit: 1, mutated: false, output: error instanceof Error ? error.message : String(error) };
  }
  const bin = argv[0]!;
  const args = argv.slice(1).filter((arg) => arg !== "--");
  const resolve = (value: string) => {
    if (value.startsWith("/")) return normalizePath(value);
    return normalizePath(joinPath(workdir, value));
  };
  if (!SUPPORTED.includes(bin)) {
    return {
      exit: 127,
      mutated: false,
      output: `command not found: ${bin}\n${SANDBOX_NOTE}`,
    };
  }
  try {
    switch (bin) {
      case "pwd":
        return { exit: 0, mutated: false, output: `/${workdir}` };
      case "echo":
        return { exit: 0, mutated: false, output: args.join(" ") };
      case "ls": {
        const target = args.filter((arg) => !arg.startsWith("-")).at(-1);
        const path = target ? resolve(target) : normalizePath(workdir);
        const stat = await workspace.stat(path);
        if (!stat) return { exit: 2, mutated: false, output: `ls: ${target ?? "."}: No such file or directory` };
        if (stat.kind === "file") return { exit: 0, mutated: false, output: target ?? baseName(path) };
        return { exit: 0, mutated: false, output: await listDir(workspace, path) };
      }
      case "cat": {
        if (args.length === 0) return { exit: 1, mutated: false, output: "cat: missing file operand" };
        const chunks: string[] = [];
        for (const arg of args.filter((item) => !item.startsWith("-"))) {
          chunks.push(await workspace.readText(resolve(arg)));
        }
        return { exit: 0, mutated: false, output: chunks.join("") };
      }
      case "mkdir": {
        const makeParents = args.includes("-p");
        const paths = args.filter((arg) => !arg.startsWith("-"));
        if (paths.length === 0) return { exit: 1, mutated: false, output: "mkdir: missing operand" };
        for (const arg of paths) await workspace.mkdir(resolve(arg));
        return { exit: 0, mutated: true, output: makeParents ? "" : "" };
      }
      case "touch": {
        for (const arg of args.filter((item) => !item.startsWith("-"))) {
          const path = resolve(arg);
          if (!(await workspace.exists(path))) await workspace.writeText(path, "");
        }
        return { exit: 0, mutated: true, output: "" };
      }
      case "rm": {
        const paths = args.filter((arg) => !arg.startsWith("-"));
        if (paths.length === 0) return { exit: 1, mutated: false, output: "rm: missing operand" };
        for (const arg of paths) await workspace.remove(resolve(arg));
        return { exit: 0, mutated: true, output: "" };
      }
      case "cp":
      case "mv": {
        const paths = args.filter((arg) => !arg.startsWith("-"));
        if (paths.length < 2) return { exit: 1, mutated: false, output: `${bin}: missing operand` };
        const from = resolve(paths[0]!);
        const to = resolve(paths[1]!);
        if (bin === "cp") {
          const bytes = await workspace.readBytes(from);
          await workspace.writeBytes(to, bytes);
        } else {
          await workspace.rename(from, to);
        }
        return { exit: 0, mutated: true, output: "" };
      }
      case "head":
      case "tail": {
        const nFlag = args.find((arg) => arg.startsWith("-n"));
        const count = nFlag ? Number(nFlag.slice(2) || args[args.indexOf(nFlag) + 1]) : 10;
        const file = args.filter((arg) => !arg.startsWith("-") && arg !== String(count)).at(-1);
        if (!file) return { exit: 1, mutated: false, output: `${bin}: missing file` };
        const lines = (await workspace.readText(resolve(file))).split(/\r?\n/);
        const slice = bin === "head" ? lines.slice(0, count) : lines.slice(-count);
        return { exit: 0, mutated: false, output: slice.join("\n") };
      }
      case "wc": {
        const file = args.filter((arg) => !arg.startsWith("-")).at(-1);
        if (!file) return { exit: 1, mutated: false, output: "wc: missing file" };
        const text = await workspace.readText(resolve(file));
        const lines = text.length ? text.split(/\r?\n/).length : 0;
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        return { exit: 0, mutated: false, output: `${lines} ${words} ${text.length} ${file}` };
      }
      case "find": {
        const startArg = args.find((arg) => !arg.startsWith("-"));
        const start = startArg ? resolve(startArg) : normalizePath(workdir);
        const nameFlag = args.indexOf("-name");
        const name = nameFlag >= 0 ? args[nameFlag + 1] : undefined;
        const regex = name ? new RegExp(`^${name.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`) : null;
        const files = await collect(workspace, start);
        const matched = files.filter((file) => !regex || regex.test(baseName(file)));
        return { exit: 0, mutated: false, output: matched.join("\n") };
      }
      case "grep": {
        const pattern = args.find((arg) => !arg.startsWith("-"));
        const file = args.filter((arg) => !arg.startsWith("-")).slice(1).at(-1);
        if (!pattern || !file) return { exit: 1, mutated: false, output: "grep: usage: grep pattern file" };
        const lines = (await workspace.readText(resolve(file))).split(/\r?\n/);
        const flags = args.includes("-i") ? "i" : "";
        const regex = new RegExp(pattern, flags);
        const hits = lines.flatMap((line, index) => (regex.test(line) ? [`${index + 1}:${line}`] : []));
        return { exit: hits.length ? 0 : 1, mutated: false, output: hits.join("\n") };
      }
      default:
        return { exit: 127, mutated: false, output: `command not found: ${bin}\n${SANDBOX_NOTE}` };
    }
  } catch (error) {
    return { exit: 1, mutated: false, output: error instanceof Error ? error.message : String(error) };
  }
}

async function collect(workspace: Workspace, dir: string): Promise<string[]> {
  const stat = await workspace.stat(dir);
  if (!stat) return [];
  if (stat.kind === "file") return [dir];
  const entries = await workspace.list(dir);
  const out: string[] = [];
  for (const entry of entries) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.kind === "dir") out.push(...(await collect(workspace, path)));
    else out.push(path);
  }
  return out;
}

export function sandboxMutates(command: string): boolean {
  try {
    const { argv } = parse(command);
    return ["mkdir", "touch", "rm", "cp", "mv"].includes(argv[0] ?? "");
  } catch {
    return false;
  }
}
