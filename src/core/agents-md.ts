import { walkFiles, type Workspace } from "./workspace";

const MAX_CHARS = 24_000;

export async function loadAgentsMd(workspace: Workspace): Promise<string> {
  const files = (await walkFiles(workspace))
    .filter((file) => file === "AGENTS.md" || file.endsWith("/AGENTS.md"))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  if (files.length === 0) return "";
  const sections: string[] = [
    "The following AGENTS.md instructions were loaded from the workspace. Follow them when they do not conflict with the user's request.",
  ];
  let used = sections[0]!.length;
  for (const file of files) {
    const body = (await workspace.readText(file)).trim();
    if (!body) continue;
    const section = `\n\n# ${file}\n${body}`;
    if (used + section.length > MAX_CHARS) {
      sections.push("\n\n(Further AGENTS.md files were omitted because the instruction budget was reached.)");
      break;
    }
    sections.push(section);
    used += section.length;
  }
  return sections.join("");
}
