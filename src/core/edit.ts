/**
 * Exact-edit semantics ported from OpenCode's edit tool
 * (packages/core/src/tool/plugin/edit.ts, MIT).
 * Copyright (c) 2025 opencode.
 */

interface Match {
  start: number;
  end: number;
}

const normalizeForMatch = (value: string) =>
  value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");

const findOccurrences = (content: string, search: string): Match[] => {
  const result: Match[] = [];
  if (!search) return result;
  let offset = 0;
  while ((offset = content.indexOf(search, offset)) !== -1) {
    result.push({ start: offset, end: offset + search.length });
    offset += search.length;
  }
  return result;
};

/** Line-oriented fallback: ignore trailing whitespace and curly-quote differences. */
const findLineOccurrences = (content: string, search: string): Match[] => {
  const trailingNewline = search.endsWith("\n");
  const expected = search.split("\n");
  if (trailingNewline) expected.pop();
  if (expected.length === 0) return [];
  const lines = [...content.matchAll(/[^\n]*(?:\n|$)/g)]
    .filter((match) => match[0] !== "")
    .map((match) => {
      const newline = match[0].endsWith("\n");
      const text = newline ? match[0].slice(0, -1) : match[0];
      return {
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        text,
        contentEnd: (match.index ?? 0) + text.length - (text.endsWith("\r") ? 1 : 0),
        newline,
      };
    });
  const candidates = lines.flatMap((line, index) => {
    const actual = lines.slice(index, index + expected.length);
    if (actual.length !== expected.length) return [];
    if (
      !actual.every(
        (item, lineIndex) =>
          normalizeForMatch(item.text.trimEnd()) === normalizeForMatch(expected[lineIndex]!.trimEnd()),
      )
    ) {
      return [];
    }
    const last = actual.at(-1)!;
    if (trailingNewline && !last.newline) return [];
    return [{ start: line.start, end: trailingNewline ? last.end : last.contentEnd }];
  });
  return candidates.reduce<Match[]>((result, candidate) => {
    if (result.some((match) => match.end > candidate.start && match.start < candidate.end)) return result;
    result.push(candidate);
    return result;
  }, []);
};

export interface EditResult {
  content: string;
  replacements: number;
}

export function applyEdit(content: string, oldString: string, newString: string, replaceAll = false): EditResult {
  if (oldString === newString) {
    throw new Error("oldString and newString must be different");
  }
  if (!oldString) throw new Error("oldString must not be empty");
  let matches = findOccurrences(content, oldString);
  if (matches.length === 0) matches = findLineOccurrences(content, oldString);
  if (matches.length === 0) {
    throw new Error("Could not find oldString in the file. Read the file and copy the exact text.");
  }
  if (matches.length > 1 && !replaceAll) {
    throw new Error(
      `oldString found ${matches.length} times. Provide more surrounding context to make it unique, or set replaceAll to true.`,
    );
  }
  const chosen = replaceAll ? matches : matches.slice(0, 1);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const replacement = newline === "\r\n" ? newString.replace(/\r?\n/g, "\r\n") : newString.replace(/\r\n/g, "\n");
  let next = content;
  for (const match of [...chosen].reverse()) {
    next = next.slice(0, match.start) + replacement + next.slice(match.end);
  }
  return { content: next, replacements: chosen.length };
}
