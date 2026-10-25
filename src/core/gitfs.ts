import type { Workspace } from "./workspace";
import { NotFoundError } from "./workspace";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function enoent(path: string): Error {
  const error = new Error(`ENOENT: ${path}`) as Error & { code: string };
  error.code = "ENOENT";
  return error;
}

function toBytes(data: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

interface GitStat {
  isFile: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  mtime: Date;
  ctime: Date;
  uid: number;
  gid: number;
  ino: number;
  dev: number;
}

function asStat(kind: "file" | "dir" | "symlink", size: number, mode: number, mtimeMs: number): GitStat {
  const mtime = new Date(mtimeMs);
  return {
    isFile: () => kind === "file",
    isDirectory: () => kind === "dir",
    isSymbolicLink: () => kind === "symlink",
    mode,
    size,
    mtimeMs,
    ctimeMs: mtimeMs,
    mtime,
    ctime: mtime,
    uid: 0,
    gid: 0,
    ino: 1,
    dev: 1,
  };
}

/**
 * Promise-shaped fs for isomorphic-git. `root` is the absolute prefix git uses
 * (for example `/repo`); workspace paths stay relative.
 */
export function createGitFs(workspace: Workspace, root = "/repo") {
  const rel = (filepath: string) => {
    const normalized = filepath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    if (normalized === root) return "";
    const prefix = `${root}/`;
    if (!normalized.startsWith(prefix)) throw new Error(`Path is outside the git root: ${filepath}`);
    return normalized.slice(prefix.length);
  };

  const promises = {
    async readFile(filepath: string, options?: { encoding?: string } | string) {
      const path = rel(filepath);
      const encoding = typeof options === "string" ? options : options?.encoding;
      try {
        if (encoding === "utf8" || encoding === "utf-8") return await workspace.readText(path);
        return await workspace.readBytes(path);
      } catch (error) {
        if (error instanceof NotFoundError) throw enoent(filepath);
        throw error;
      }
    },
    async writeFile(filepath: string, data: string | Uint8Array | ArrayBuffer) {
      await workspace.writeBytes(rel(filepath), toBytes(data));
    },
    async unlink(filepath: string) {
      try {
        await workspace.remove(rel(filepath));
      } catch (error) {
        if (error instanceof NotFoundError) throw enoent(filepath);
        throw error;
      }
    },
    async readdir(filepath: string) {
      try {
        const entries = await workspace.list(rel(filepath));
        return entries.map((entry) => entry.name);
      } catch (error) {
        if (error instanceof NotFoundError) throw enoent(filepath);
        throw error;
      }
    },
    async mkdir(filepath: string) {
      await workspace.mkdir(rel(filepath));
    },
    async rmdir(filepath: string) {
      try {
        await workspace.remove(rel(filepath));
      } catch (error) {
        if (error instanceof NotFoundError) throw enoent(filepath);
        throw error;
      }
    },
    async stat(filepath: string) {
      const stat = await workspace.stat(rel(filepath));
      if (!stat) throw enoent(filepath);
      return asStat(stat.kind === "symlink" ? "file" : stat.kind, stat.size, stat.mode, stat.mtimeMs);
    },
    async lstat(filepath: string) {
      const path = rel(filepath);
      const direct = workspace instanceof Object && "lstat" in workspace ? (workspace as Workspace & { lstat: (p: string) => { kind: "file" | "dir" | "symlink"; size: number; mode: number; mtimeMs: number } | null }).lstat(path) : null;
      const stat = direct ?? (await workspace.stat(path));
      if (!stat) throw enoent(filepath);
      return asStat(stat.kind, stat.size, stat.mode, stat.mtimeMs);
    },
    async readlink(filepath: string) {
      return workspace.readlink(rel(filepath));
    },
    async symlink(target: string, filepath: string) {
      await workspace.symlink(rel(filepath), target);
    },
    async chmod(filepath: string, mode: number) {
      await workspace.chmod(rel(filepath), mode);
    },
  };

  return { promises };
}

export const GIT_ROOT = "/repo";
