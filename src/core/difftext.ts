export interface DiffLine {
  type: " " | "+" | "-";
  text: string;
}

/** Longest-common-subsequence line diff. Huge inputs fall back to a coarse summary. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const n = a.length;
  const m = b.length;
  if (n * m > 250_000) {
    return [
      { type: "-", text: `(${n} lines omitted from the inline diff)` },
      { type: "+", text: `(${m} lines omitted from the inline diff)` },
    ];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: " ", text: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: "-", text: a[i]! });
      i += 1;
    } else {
      out.push({ type: "+", text: b[j]! });
      j += 1;
    }
  }
  while (i < n) out.push({ type: "-", text: a[i++]! });
  while (j < m) out.push({ type: "+", text: b[j++]! });
  return out;
}

export function unifiedDiff(path: string, before: string, after: string, context = 2): string {
  const lines = diffLines(before, after);
  const keep = lines.map((line, index) => {
    if (line.type !== " ") return true;
    return lines.slice(Math.max(0, index - context), index + context + 1).some((item) => item.type !== " ");
  });
  const body: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!keep[index]) continue;
    if (index > 0 && !keep[index - 1]) body.push("@@");
    const line = lines[index]!;
    body.push(`${line.type}${line.text}`);
  }
  return [`--- a/${path}`, `+++ b/${path}`, ...body].join("\n");
}
