import { isHiddenPath, normalizePath } from "./paths";
import { walkFiles, type Workspace } from "./workspace";

export const DEFAULT_SEARCH_LIMIT = 100;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function braceExpand(pattern: string): string[] {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match) return [pattern];
  const options = match[1]!.split(",");
  return options.flatMap((option) => braceExpand(pattern.slice(0, match.index) + option + pattern.slice(match.index + match[0].length)));
}

export function globToRegExp(pattern: string): RegExp {
  const expanded = braceExpand(pattern);
  const sources = expanded.map((item) => {
    let source = "";
    let index = 0;
    while (index < item.length) {
      const two = item.slice(index, index + 2);
      const char = item[index]!;
      if (two === "**") {
        source += ".*";
        index += 2;
        if (item[index] === "/") index += 1;
        continue;
      }
      if (char === "*") {
        source += "[^/]*";
        index += 1;
        continue;
      }
      if (char === "?") {
        source += "[^/]";
        index += 1;
        continue;
      }
      source += escapeRegex(char);
      index += 1;
    }
    return source;
  });
  return new RegExp(`^(?:${sources.join("|")})$`);
}

export async function globSearch(
  workspace: Workspace,
  pattern: string,
  options: { path?: string; hidden?: boolean; limit?: number } = {},
): Promise<{ paths: string[]; truncated: boolean }> {
  const root = options.path ? normalizePath(options.path) : "";
  const regex = globToRegExp(pattern);
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const files = await walkFiles(workspace, root);
  const matched: string[] = [];
  for (const file of files) {
    if (!options.hidden && isHiddenPath(file)) continue;
    const relative = root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
    if (regex.test(file) || regex.test(relative) || regex.test(file.split("/").pop() ?? file)) {
      matched.push(file);
      if (matched.length >= limit) break;
    }
  }
  return { paths: matched, truncated: matched.length >= limit };
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export async function grepSearch(
  workspace: Workspace,
  pattern: string,
  options: {
    path?: string;
    include?: string;
    literal?: boolean;
    caseSensitive?: boolean;
    limit?: number;
  } = {},
): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  if (!pattern) throw new Error("Pattern must not be empty");
  const root = options.path ? normalizePath(options.path) : "";
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const flags = options.caseSensitive === false ? "i" : "";
  const source = options.literal ? escapeRegex(pattern) : pattern;
  let regex: RegExp;
  try {
    regex = new RegExp(source, flags);
  } catch (error) {
    throw new Error(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
  }
  const include = options.include ? globToRegExp(options.include) : null;
  const stat = root ? await workspace.stat(root) : { kind: "dir" as const };
  const files =
    stat?.kind === "file" ? [root] : await walkFiles(workspace, root);
  const matches: GrepMatch[] = [];
  for (const file of files) {
    if (isHiddenPath(file)) continue;
    if (include && !include.test(file) && !include.test(file.split("/").pop() ?? file)) continue;
    const text = await workspace.readText(file);
    if (text.includes("\u0000")) continue;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!regex.test(line)) continue;
      matches.push({ path: file, line: index + 1, text: line });
      if (matches.length >= limit) return { matches, truncated: true };
    }
  }
  return { matches, truncated: false };
}

export function formatGlob(paths: string[], truncated: boolean): string {
  const lines = paths.length === 0 ? ["No files found"] : paths;
  if (truncated) {
    lines.push("", `(Results are truncated: showing first ${paths.length} results. Consider using a more specific path or pattern.)`);
  }
  return lines.join("\n");
}

export function formatGrep(matches: GrepMatch[], truncated: boolean): string {
  const lines = matches.length === 0 ? ["No matches found"] : [`Found ${matches.length} matches`];
  let current = "";
  for (const match of matches) {
    if (current !== match.path) {
      if (current) lines.push("");
      current = match.path;
      lines.push(`${match.path}:`);
    }
    lines.push(`  Line ${match.line}: ${match.text}`);
  }
  if (truncated) {
    lines.push("", `(Results are truncated: showing first ${matches.length} results. Consider using a more specific path or pattern.)`);
  }
  return lines.join("\n");
}
