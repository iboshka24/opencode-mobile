import type { Workspace } from "./workspace";

const README = `# Sample workspace

This folder lives on the phone. OpenCode Mobile reads and edits it with on-device tools.

There is no project server. Ask the agent to change \`src/hello.ts\` or run \`/init\` to refresh AGENTS.md.
`;

const AGENTS = `# Sample project

- TypeScript sources live in \`src/\`.
- There is no package manager on device. Do not run npm, node, or a compiler.
- Keep exported functions small.
- Prefer \`edit\` for targeted changes.
`;

const HELLO = `export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
`;

const MATH = `export function add(a: number, b: number): number {
  return a + b;
}
`;

export async function seedWorkspace(workspace: Workspace): Promise<boolean> {
  const entries = await workspace.list("");
  const visible = entries.filter((entry) => !entry.name.startsWith("."));
  if (visible.length > 0) return false;
  await workspace.writeText("README.md", README);
  await workspace.writeText("AGENTS.md", AGENTS);
  await workspace.writeText("src/hello.ts", HELLO);
  await workspace.writeText("src/math.ts", MATH);
  return true;
}
