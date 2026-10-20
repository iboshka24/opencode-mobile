/**
 * Apply the OpenCode / Codex patch envelope.
 * Format copied from packages/core/src/tool/patch.txt (MIT, copyright (c) 2025 opencode).
 */

import { normalizePath } from "./paths";
import type { Workspace } from "./workspace";
import { NotFoundError } from "./workspace";

interface HunkOp {
  kind: "+" | "-" | " ";
  text: string;
}

interface Hunk {
  anchor?: string;
  ops: HunkOp[];
}

type FileOp =
  | { type: "add"; path: string; lines: string[] }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; moveTo?: string; hunks: Hunk[] };

export interface PatchSummary {
  added: string[];
  updated: string[];
  deleted: string[];
  moved: Array<{ from: string; to: string }>;
}

function parseOps(body: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  const ensure = () => {
    if (!current) {
      current = { ops: [] };
      hunks.push(current);
    }
    return current;
  };
  for (const line of body) {
    if (line.startsWith("@@")) {
      current = { anchor: line.slice(2).trim(), ops: [] };
      hunks.push(current);
      continue;
    }
    if (line.startsWith("+")) {
      ensure().ops.push({ kind: "+", text: line.slice(1) });
      continue;
    }
    if (line.startsWith("-")) {
      ensure().ops.push({ kind: "-", text: line.slice(1) });
      continue;
    }
    if (line.startsWith(" ")) {
      ensure().ops.push({ kind: " ", text: line.slice(1) });
      continue;
    }
    if (line.trim() === "") continue;
    ensure().ops.push({ kind: " ", text: line });
  }
  return hunks.filter((hunk) => hunk.ops.length > 0 || hunk.anchor);
}

export function parsePatch(patch: string): FileOp[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const ops: FileOp[] = [];
  let index = 0;
  while (index < lines.length && !lines[index]!.includes("Begin Patch")) index += 1;
  if (index >= lines.length) throw new Error("Patch is missing *** Begin Patch");
  index += 1;
  const fileHeader = (line: string) =>
    /^\*\*\*\s*(?:Add|Delete|Update) File:/.test(line) || line.includes("End Patch");
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.includes("End Patch")) break;
    const add = /^\*\*\*\s*Add File:\s*(.+)$/.exec(line);
    const del = /^\*\*\*\s*Delete File:\s*(.+)$/.exec(line);
    const update = /^\*\*\*\s*Update File:\s*(.+)$/.exec(line);
    if (!add && !del && !update) {
      index += 1;
      continue;
    }
    index += 1;
    if (del) {
      ops.push({ type: "delete", path: normalizePath(del[1]!.trim()) });
      continue;
    }
    const body: string[] = [];
    let moveTo: string | undefined;
    while (index < lines.length && !fileHeader(lines[index]!)) {
      const move = /^\*\*\*\s*Move to:\s*(.+)$/.exec(lines[index]!);
      if (move) moveTo = normalizePath(move[1]!.trim());
      else body.push(lines[index]!);
      index += 1;
    }
    if (add) {
      ops.push({
        type: "add",
        path: normalizePath(add[1]!.trim()),
        lines: body.filter((item) => item.startsWith("+")).map((item) => item.slice(1)),
      });
      continue;
    }
    ops.push({
      type: "update",
      path: normalizePath(update![1]!.trim()),
      moveTo,
      hunks: parseOps(body),
    });
  }
  if (ops.length === 0) throw new Error("Patch did not contain any file operations");
  return ops;
}

function applyHunks(content: string, hunks: Hunk[]): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  for (const hunk of hunks) {
    let cursor = 0;
    if (hunk.anchor) {
      const found = lines.findIndex((line) => line.trim() === hunk.anchor || line.includes(hunk.anchor!));
      if (found < 0) throw new Error(`Could not find patch anchor: ${hunk.anchor}`);
      cursor = found + 1;
    }
    for (const op of hunk.ops) {
      if (op.kind === "+") {
        lines.splice(cursor, 0, op.text);
        cursor += 1;
        continue;
      }
      const current = lines[cursor] ?? "";
      if (current.trim() !== op.text.trim()) {
        throw new Error(`Patch context mismatch. Expected "${op.text}" but found "${current}".`);
      }
      if (op.kind === "-") lines.splice(cursor, 1);
      else cursor += 1;
    }
  }
  return lines.join(newline);
}

export async function applyPatch(workspace: Workspace, patch: string): Promise<PatchSummary> {
  const ops = parsePatch(patch);
  const summary: PatchSummary = { added: [], updated: [], deleted: [], moved: [] };
  for (const op of ops) {
    if (op.type === "add") {
      if (await workspace.exists(op.path)) throw new Error(`File already exists: ${op.path}`);
      const text = `${op.lines.join("\n")}${op.lines.length ? "\n" : ""}`;
      await workspace.writeText(op.path, text);
      summary.added.push(op.path);
      continue;
    }
    if (op.type === "delete") {
      await workspace.remove(op.path);
      summary.deleted.push(op.path);
      continue;
    }
    let content: string;
    try {
      content = await workspace.readText(op.path);
    } catch (error) {
      if (error instanceof NotFoundError) throw new Error(`File not found: ${op.path}`);
      throw error;
    }
    const next = applyHunks(content, op.hunks);
    const dest = op.moveTo ?? op.path;
    await workspace.writeText(dest, next);
    if (op.moveTo && op.moveTo !== op.path) {
      await workspace.remove(op.path);
      summary.moved.push({ from: op.path, to: op.moveTo });
    }
    summary.updated.push(dest);
  }
  return summary;
}
