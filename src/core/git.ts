import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { createGitFs, GIT_ROOT } from "./gitfs";
import type { Workspace } from "./workspace";

export interface GitAuthor {
  name: string;
  email: string;
}

export interface GitRequest {
  action: "init" | "status" | "diff" | "log" | "commit" | "clone" | "pull" | "push";
  url?: string;
  message?: string;
  remote?: string;
  branch?: string;
  dir?: string;
  depth?: number;
}

const DEFAULT_AUTHOR: GitAuthor = { name: "OpenCode Mobile", email: "mobile@opencode.local" };

function dirOf(request: GitRequest): string {
  if (!request.dir || request.dir === "." || request.dir === "/") return GIT_ROOT;
  const relative = request.dir.replace(/^\/+/, "").replace(/\/+$/, "");
  return `${GIT_ROOT}/${relative}`;
}

async function ensureIdentity(fs: ReturnType<typeof createGitFs>, dir: string, author: GitAuthor) {
  await git.setConfig({ fs, dir, path: "user.name", value: author.name });
  await git.setConfig({ fs, dir, path: "user.email", value: author.email });
}

function auth(token?: string) {
  if (!token) return undefined;
  return () => ({ username: token, password: "x-oauth-basic" });
}

export async function runGit(workspace: Workspace, request: GitRequest, author: GitAuthor = DEFAULT_AUTHOR, token?: string): Promise<string> {
  const fs = createGitFs(workspace);
  const dir = dirOf(request);
  const remote = request.remote || "origin";
  const branch = request.branch || "main";
  switch (request.action) {
    case "init": {
      await git.init({ fs, dir, defaultBranch: branch });
      await ensureIdentity(fs, dir, author);
      return `Initialized git repository in ${request.dir || "."} (branch ${branch}).`;
    }
    case "status": {
      const matrix = await git.statusMatrix({ fs, dir });
      if (matrix.length === 0) return "Clean working tree.";
      const lines = matrix
        .filter((row) => row[1] !== row[2] || row[2] !== row[3])
        .map(([filepath, head, workdir, stage]) => `${head}${workdir}${stage} ${filepath}`);
      return lines.length ? lines.join("\n") : "Clean working tree.";
    }
    case "diff": {
      const matrix = await git.statusMatrix({ fs, dir });
      const changed = matrix.filter((row) => row[1] !== row[2]);
      if (changed.length === 0) return "No unstaged changes.";
      return changed.map(([filepath]) => filepath).join("\n");
    }
    case "log": {
      const commits = await git.log({ fs, dir, depth: request.depth ?? 20 });
      if (commits.length === 0) return "No commits yet.";
      return commits
        .map((commit) => `${commit.oid.slice(0, 7)} ${commit.commit.message.split("\n")[0]}`)
        .join("\n");
    }
    case "commit": {
      if (!request.message?.trim()) throw new Error("commit requires a message");
      await ensureIdentity(fs, dir, author);
      const matrix = await git.statusMatrix({ fs, dir });
      const files = matrix.filter((row) => row[1] !== row[2] || row[2] !== row[3]).map((row) => row[0]);
      if (files.length === 0) return "Nothing to commit.";
      for (const filepath of files) {
        const head = matrix.find((row) => row[0] === filepath)?.[1];
        const workdir = matrix.find((row) => row[0] === filepath)?.[2];
        if (workdir === 0 && head === 1) await git.remove({ fs, dir, filepath });
        else await git.add({ fs, dir, filepath });
      }
      const oid = await git.commit({
        fs,
        dir,
        message: request.message,
        author,
      });
      return `Committed ${oid.slice(0, 7)} ${files.length} file(s).`;
    }
    case "clone": {
      if (!request.url) throw new Error("clone requires a url");
      await git.clone({
        fs,
        http,
        dir,
        url: request.url,
        singleBranch: true,
        depth: request.depth ?? 1,
        onAuth: auth(token),
      });
      return `Cloned ${request.url} into ${request.dir || "."}.`;
    }
    case "pull": {
      await git.pull({
        fs,
        http,
        dir,
        remote,
        ref: branch,
        author,
        onAuth: auth(token),
      });
      return `Pulled ${remote}/${branch}.`;
    }
    case "push": {
      if (!token) throw new Error("GitHub token is not set. Add it in Settings before pushing.");
      const result = await git.push({
        fs,
        http,
        dir,
        remote,
        ref: branch,
        onAuth: auth(token),
      });
      return `Pushed ${remote}/${branch}. ${result?.ok ? "ok" : JSON.stringify(result)}`;
    }
    default:
      throw new Error(`Unknown git action`);
  }
}

export async function workspaceIsGit(workspace: Workspace): Promise<boolean> {
  return workspace.exists(".git");
}
