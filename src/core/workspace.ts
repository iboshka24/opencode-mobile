import { baseName, isHiddenPath, joinPath, normalizePath, parentPath } from "./paths";

export type EntryKind = "file" | "dir" | "symlink";

export interface DirEntry {
  name: string;
  kind: EntryKind;
}

export interface Stat {
  kind: EntryKind;
  size: number;
  mtimeMs: number;
  mode: number;
}

export class NotFoundError extends Error {
  readonly code = "ENOENT";
  constructor(path: string) {
    super(`Not found: ${path || "/"}`);
    this.name = "NotFoundError";
  }
}

export interface Workspace {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, text: string): Promise<void>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  list(path?: string): Promise<DirEntry[]>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<Stat | null>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  symlink(path: string, target: string): Promise<void>;
  readlink(path: string): Promise<string>;
  chmod(path: string, mode: number): Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface Node {
  kind: EntryKind;
  data?: Uint8Array;
  target?: string;
  mtimeMs: number;
  mode: number;
}

const FILE_MODE = 0o100644;
const EXEC_MODE = 0o100755;
const DIR_MODE = 0o040755;
const LINK_MODE = 0o120000;

export class MemoryWorkspace implements Workspace {
  private nodes = new Map<string, Node>();

  constructor() {
    this.nodes.set("", { kind: "dir", mtimeMs: Date.now(), mode: DIR_MODE });
  }

  async readText(path: string): Promise<string> {
    return decoder.decode(await this.readBytes(path));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const node = this.follow(normalizePath(path));
    if (!node || node.kind !== "file" || !node.data) throw new NotFoundError(path);
    return node.data;
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, encoder.encode(text));
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const rel = normalizePath(path);
    if (!rel) throw new Error("Cannot write the workspace root");
    this.ensureParents(rel);
    const prev = this.nodes.get(rel);
    this.nodes.set(rel, {
      kind: "file",
      data,
      mtimeMs: Date.now(),
      mode: prev?.kind === "file" ? prev.mode : FILE_MODE,
    });
  }

  async remove(path: string): Promise<void> {
    const rel = normalizePath(path);
    if (!rel) throw new Error("Cannot delete the workspace root");
    const node = this.nodes.get(rel);
    if (!node) throw new NotFoundError(path);
    if (node.kind === "dir") {
      for (const key of [...this.nodes.keys()]) {
        if (key === rel || key.startsWith(`${rel}/`)) this.nodes.delete(key);
      }
      return;
    }
    this.nodes.delete(rel);
  }

  async list(path = ""): Promise<DirEntry[]> {
    const rel = normalizePath(path);
    const node = this.nodes.get(rel);
    if (!node || node.kind !== "dir") throw new NotFoundError(path || "/");
    const prefix = rel ? `${rel}/` : "";
    const names = new Map<string, EntryKind>();
    for (const [key, child] of this.nodes) {
      if (!key.startsWith(prefix) || key === rel) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (!names.has(name)) {
        names.set(name, slash === -1 ? child.kind : "dir");
      }
    }
    return [...names.entries()]
      .map(([name, kind]) => ({ name, kind }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async stat(path: string): Promise<Stat | null> {
    const rel = normalizePath(path);
    const direct = this.nodes.get(rel);
    if (!direct) return null;
    if (direct.kind === "symlink") {
      const target = this.resolveLink(rel, new Set());
      if (!target) {
        return { kind: "symlink", size: encoder.encode(direct.target ?? "").length, mtimeMs: direct.mtimeMs, mode: direct.mode };
      }
      return target;
    }
    return {
      kind: direct.kind,
      size: direct.data?.byteLength ?? 0,
      mtimeMs: direct.mtimeMs,
      mode: direct.mode,
    };
  }

  async mkdir(path: string): Promise<void> {
    const rel = normalizePath(path);
    if (!rel) return;
    this.ensureParents(rel);
    const existing = this.nodes.get(rel);
    if (existing?.kind === "dir") return;
    if (existing) throw new Error(`Not a directory: ${path}`);
    this.nodes.set(rel, { kind: "dir", mtimeMs: Date.now(), mode: DIR_MODE });
  }

  async rename(from: string, to: string): Promise<void> {
    const src = normalizePath(from);
    const dest = normalizePath(to);
    if (!this.nodes.has(src)) throw new NotFoundError(from);
    this.ensureParents(dest);
    const keys = [...this.nodes.keys()].filter((key) => key === src || key.startsWith(`${src}/`));
    const copies = keys.map((key) => {
      const next = key === src ? dest : dest + key.slice(src.length);
      return [next, this.nodes.get(key)!] as const;
    });
    for (const key of keys) this.nodes.delete(key);
    for (const [key, node] of copies) this.nodes.set(key, node);
  }

  async symlink(path: string, target: string): Promise<void> {
    const rel = normalizePath(path);
    this.ensureParents(rel);
    this.nodes.set(rel, { kind: "symlink", target, mtimeMs: Date.now(), mode: LINK_MODE });
  }

  async readlink(path: string): Promise<string> {
    const node = this.nodes.get(normalizePath(path));
    if (!node || node.kind !== "symlink" || node.target === undefined) throw new Error(`Not a symlink: ${path}`);
    return node.target;
  }

  async chmod(path: string, mode: number): Promise<void> {
    const node = this.nodes.get(normalizePath(path));
    if (!node) throw new NotFoundError(path);
    node.mode = mode;
  }

  lstat(path: string): Stat | null {
    const node = this.nodes.get(normalizePath(path));
    if (!node) return null;
    return {
      kind: node.kind,
      size: node.data?.byteLength ?? encoder.encode(node.target ?? "").length,
      mtimeMs: node.mtimeMs,
      mode: node.mode,
    };
  }

  private follow(path: string): Node | undefined {
    const node = this.nodes.get(path);
    if (!node) return undefined;
    if (node.kind !== "symlink") return node;
    const resolved = this.resolveLinkPath(path, new Set());
    return resolved ? this.nodes.get(resolved) : undefined;
  }

  private resolveLink(path: string, seen: Set<string>): Stat | null {
    const resolved = this.resolveLinkPath(path, seen);
    if (!resolved) return null;
    const node = this.nodes.get(resolved);
    if (!node || node.kind === "symlink") return null;
    return { kind: node.kind, size: node.data?.byteLength ?? 0, mtimeMs: node.mtimeMs, mode: node.mode };
  }

  private resolveLinkPath(path: string, seen: Set<string>): string | null {
    const node = this.nodes.get(path);
    if (!node || node.kind !== "symlink" || !node.target) return null;
    if (seen.has(path)) return null;
    seen.add(path);
    const next = node.target.startsWith("/")
      ? normalizePath(node.target)
      : normalizePath(joinPath(parentPath(path), node.target));
    const target = this.nodes.get(next);
    if (!target) return null;
    if (target.kind === "symlink") return this.resolveLinkPath(next, seen);
    return next;
  }

  private ensureParents(path: string): void {
    const parts = path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.nodes.get(current);
      if (!existing) {
        this.nodes.set(current, { kind: "dir", mtimeMs: Date.now(), mode: DIR_MODE });
      } else if (existing.kind !== "dir") {
        throw new Error(`Not a directory: ${current}`);
      }
    }
  }
}

export function markExecutable(mode: number): number {
  return mode === FILE_MODE ? EXEC_MODE : mode;
}

export interface TreeNode {
  path: string;
  name: string;
  kind: EntryKind;
  children?: TreeNode[];
}

export async function listTree(workspace: Workspace, dir = "", depth = 8): Promise<TreeNode[]> {
  if (depth < 0) return [];
  const entries = await workspace.list(dir);
  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name.startsWith(".")) continue;
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    const node: TreeNode = { path, name: entry.name, kind: entry.kind };
    if (entry.kind === "dir") node.children = await listTree(workspace, path, depth - 1);
    nodes.push(node);
  }
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function walkFiles(workspace: Workspace, dir = ""): Promise<string[]> {
  const entries = await workspace.list(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.kind === "dir") files.push(...(await walkFiles(workspace, path)));
    else if (entry.kind === "file") files.push(path);
  }
  return files;
}

export { baseName, isHiddenPath };
