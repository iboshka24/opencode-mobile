/** Workspace paths are relative, POSIX, and cannot escape the root. */

export function normalizePath(input: string): string {
  const raw = input.replace(/\\/g, "/").trim();
  const parts = raw.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) {
        throw new Error(`Path escapes the workspace: ${input}`);
      }
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

export function parentPath(path: string): string {
  const norm = normalizePath(path);
  const index = norm.lastIndexOf("/");
  return index === -1 ? "" : norm.slice(0, index);
}

export function baseName(path: string): string {
  const norm = normalizePath(path);
  const index = norm.lastIndexOf("/");
  return index === -1 ? norm : norm.slice(index + 1);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

export function isHiddenPath(path: string): boolean {
  return normalizePath(path)
    .split("/")
    .some((part) => part.startsWith("."));
}
