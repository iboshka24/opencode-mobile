import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { normalizePath, parentPath } from "../core/paths";
import { seedWorkspace } from "../core/seed";
import { MemoryWorkspace, NotFoundError, type DirEntry, type Stat, type Workspace } from "../core/workspace";

const FILE_MODE = 0o100644;
const DIR_MODE = 0o040755;

class ExpoWorkspace implements Workspace {
  private root(): Directory {
    const dir = new Directory(Paths.document, "workspace");
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return dir;
  }

  private uri(path: string): string {
    const rel = normalizePath(path);
    const base = this.root().uri.replace(/\/$/, "");
    return rel ? `${base}/${rel}` : base;
  }

  async readText(path: string): Promise<string> {
    const bytes = await this.readBytes(path);
    return new TextDecoder().decode(bytes);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const info = Paths.info(this.uri(path));
    if (!info.exists || info.isDirectory) throw new NotFoundError(path);
    return new File(this.uri(path)).bytes();
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text));
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const rel = normalizePath(path);
    if (!rel) throw new Error("Cannot write the workspace root");
    const parts = rel.split("/");
    const name = parts.pop()!;
    let dir = this.root();
    for (const part of parts) {
      dir = new Directory(dir, part);
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    }
    const file = new File(dir, name);
    if (!file.exists) file.create({ intermediates: true });
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    await file.write(copy);
  }

  async remove(path: string): Promise<void> {
    const info = Paths.info(this.uri(path));
    if (!info.exists) throw new NotFoundError(path);
    if (info.isDirectory) new Directory(this.uri(path)).delete();
    else new File(this.uri(path)).delete();
  }

  async list(path = ""): Promise<DirEntry[]> {
    const info = Paths.info(this.uri(path));
    if (!info.exists || !info.isDirectory) throw new NotFoundError(path || "/");
    const dir = path ? new Directory(this.uri(path)) : this.root();
    return dir
      .list()
      .map((entry) => ({
        name: entry.name,
        kind: entry instanceof Directory ? ("dir" as const) : ("file" as const),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async stat(path: string): Promise<Stat | null> {
    const info = Paths.info(this.uri(path));
    if (!info.exists) return null;
    if (info.isDirectory) return { kind: "dir", size: 0, mtimeMs: Date.now(), mode: DIR_MODE };
    const file = new File(this.uri(path));
    return { kind: "file", size: file.size ?? 0, mtimeMs: file.lastModified ?? Date.now(), mode: FILE_MODE };
  }

  async mkdir(path: string): Promise<void> {
    const rel = normalizePath(path);
    if (!rel) return;
    const dir = new Directory(this.uri(rel));
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  }

  async rename(from: string, to: string): Promise<void> {
    const info = Paths.info(this.uri(from));
    if (!info.exists) throw new NotFoundError(from);
    const parent = parentPath(to);
    if (parent) await this.mkdir(parent);
    if (info.isDirectory) new Directory(this.uri(from)).move(new Directory(this.uri(to)));
    else new File(this.uri(from)).move(new File(this.uri(to)));
  }

  async symlink(path: string, target: string): Promise<void> {
    await this.writeText(path, target);
  }

  async readlink(path: string): Promise<string> {
    return this.readText(path);
  }

  async chmod(): Promise<void> {
    return;
  }
}

const WEB_FILES = "oc-workspace-files-v1";

async function loadWebWorkspace(): Promise<MemoryWorkspace> {
  const workspace = new MemoryWorkspace();
  if (typeof localStorage === "undefined") return workspace;
  const raw = localStorage.getItem(WEB_FILES);
  if (!raw) return workspace;
  try {
    const files = JSON.parse(raw) as Record<string, string>;
    for (const [path, text] of Object.entries(files)) {
      if (typeof text === "string") await workspace.writeText(path, text);
    }
  } catch {
    localStorage.removeItem(WEB_FILES);
  }
  return workspace;
}

export async function persistWebWorkspace(workspace: Workspace): Promise<void> {
  if (Platform.OS !== "web" || typeof localStorage === "undefined") return;
  const { walkFiles } = await import("../core/workspace");
  const files = await walkFiles(workspace);
  const out: Record<string, string> = {};
  for (const file of files) {
    if (file === ".git" || file.startsWith(".git/")) continue;
    const text = await workspace.readText(file);
    if (text.includes("\u0000")) continue;
    out[file] = text;
  }
  localStorage.setItem(WEB_FILES, JSON.stringify(out));
}

export async function openWorkspace(): Promise<{ workspace: Workspace; label: string; native: boolean }> {
  if (Platform.OS === "web") {
    const workspace = await loadWebWorkspace();
    await seedWorkspace(workspace);
    await persistWebWorkspace(workspace);
    return { workspace, label: "/workspace", native: false };
  }
  const workspace = new ExpoWorkspace();
  await seedWorkspace(workspace);
  return { workspace, label: "Documents/workspace", native: true };
}
