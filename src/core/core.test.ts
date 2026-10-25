import { describe, expect, it } from "vitest";
import { runAgent } from "./agent";
import { loadAgentsMd } from "./agents-md";
import { findModel, isFree, parseCatalog, protocolFor, snapshotCatalog } from "./catalog";
import { parseSlash } from "./commands";
import { formatCost, usageCost } from "./cost";
import { unifiedDiff } from "./difftext";
import { applyEdit } from "./edit";
import { runGit } from "./git";
import { toAnthropicMessages, toGeminiContents, toOpenAIMessages, iterateSseData, scriptedModel, type ModelMessage } from "./llm";
import { applyPatch } from "./patch";
import { buildSystemPrompt, providerTemplate } from "./prompt";
import { runSandbox } from "./sandbox";
import { formatGrep, globSearch, grepSearch } from "./search";
import { DEFAULT_POLICY, executeTool, toolNames, type ToolContext } from "./tools";
import { parseDuckDuckGo } from "./web";
import { MemoryWorkspace } from "./workspace";
import { seedWorkspace } from "./seed";

function ctx(workspace: MemoryWorkspace, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspace,
    mode: "build",
    todos: [],
    changes: [],
    policy: { ...DEFAULT_POLICY, edit: "allow", shell: "allow", git: "allow", network: "allow" },
    gitAuthor: { name: "Test", email: "test@example.com" },
    askPermission: async () => "allow",
    askUser: async () => "yes",
    ...overrides,
  };
}

describe("edit", () => {
  it("replaces a unique exact match", () => {
    const result = applyEdit("alpha beta", "beta", "gamma");
    expect(result).toEqual({ content: "alpha gamma", replacements: 1 });
  });

  it("rejects ambiguous matches unless replaceAll is set", () => {
    expect(() => applyEdit("a\na\n", "a", "b")).toThrow(/2 times/);
    expect(applyEdit("a\na\n", "a", "b", true).replacements).toBe(2);
  });

  it("matches a line ignoring trailing whitespace differences", () => {
    const result = applyEdit("  keep\n  value  \n", "value", "next");
    expect(result.content).toContain("next");
    expect(result.replacements).toBe(1);
  });

  it("rejects identical strings", () => {
    expect(() => applyEdit("a", "a", "a")).toThrow(/must be different/);
  });
});

describe("patch", () => {
  it("adds, updates, moves, and deletes", async () => {
    const workspace = new MemoryWorkspace();
    await workspace.writeText("src/app.py", "def greet():\n    print(\"Hi\")\n");
    await workspace.writeText("obsolete.txt", "gone\n");
    const summary = await applyPatch(
      workspace,
      `*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.py
*** Move to: src/main.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch`,
    );
    expect(summary.added).toEqual(["hello.txt"]);
    expect(summary.deleted).toEqual(["obsolete.txt"]);
    expect(await workspace.readText("hello.txt")).toBe("Hello world\n");
    expect(await workspace.readText("src/main.py")).toContain("Hello, world!");
    expect(await workspace.exists("obsolete.txt")).toBe(false);
    expect(await workspace.exists("src/app.py")).toBe(false);
  });
});

describe("search and sandbox", () => {
  it("globs and greps the workspace", async () => {
    const workspace = new MemoryWorkspace();
    await seedWorkspace(workspace);
    const glob = await globSearch(workspace, "**/*.ts");
    expect(glob.paths).toContain("src/hello.ts");
    const grep = await grepSearch(workspace, "greet", { include: "*.ts" });
    expect(formatGrep(grep.matches, false)).toContain("src/hello.ts");
  });

  it("runs sandbox commands and refuses a real shell", async () => {
    const workspace = new MemoryWorkspace();
    await workspace.writeText("notes.txt", "one\ntwo\n");
    expect((await runSandbox(workspace, "cat notes.txt")).output).toContain("one");
    expect((await runSandbox(workspace, "echo hi")).output).toBe("hi");
    const missing = await runSandbox(workspace, "npm test");
    expect(missing.exit).toBe(127);
    expect(missing.output).toMatch(/cannot run a real shell/i);
    const pipe = await runSandbox(workspace, "cat notes.txt | wc");
    expect(pipe.exit).toBe(1);
    expect(pipe.output).toMatch(/pipes/i);
  });
});

describe("prompts, catalog, commands", () => {
  it("selects provider prompts the way OpenCode does", () => {
    expect(providerTemplate("gpt-6-astra", "GPT 6 Astra")?.mode).toBe("override");
    expect(providerTemplate("claude-sonnet-4-6", "Claude")?.mode).toBe("append");
    expect(providerTemplate("kimi-k2.5", "Kimi")?.text).toMatch(/AGENTS\.md/);
    expect(providerTemplate("muse-spark-1.3", "Muse Spark")?.text).toContain("Muse Spark");
    expect(providerTemplate("big-pickle", "Big Pickle")).toBeNull();
    const prompt = buildSystemPrompt({
      modelId: "big-pickle",
      modelName: "Big Pickle",
      providerID: "opencode",
      toolNames: ["read", "edit", "write", "shell"],
      workspaceLabel: "/workspace",
      git: false,
      platform: "ios",
      mode: "plan",
      today: "Tue Oct 20 2026",
    });
    expect(prompt).toContain("Plan mode is active");
    expect(prompt).toContain("on-device");
    expect(prompt).toContain("oldString");
  });

  it("loads the models.dev snapshot including Zen free models", () => {
    const models = snapshotCatalog();
    const pickle = findModel(models, "opencode", "big-pickle");
    expect(pickle).toBeTruthy();
    expect(isFree(pickle!)).toBe(true);
    expect(protocolFor("@ai-sdk/anthropic", "anthropic")).toBe("anthropic");
    expect(protocolFor("@ai-sdk/google", "google")).toBe("google");
    expect(protocolFor("@ai-sdk/openai-compatible", "opencode")).toBe("openai");
    expect(parseCatalog({ demo: { id: "demo", name: "Demo", npm: "@ai-sdk/openai", models: { a: { id: "a", name: "A" } } } })).toHaveLength(1);
  });

  it("parses slash commands", () => {
    expect(parseSlash("/plan").type).toBe("plan");
    expect(parseSlash("/init focus on tests")).toEqual({ type: "init", args: "focus on tests" });
    expect(parseSlash("hello").type).toBe("prompt");
    expect(parseSlash("/nope").type).toBe("unknown");
  });

  it("prices tokens from the catalog", () => {
    const model = findModel(snapshotCatalog(), "anthropic", "claude-sonnet-4-6");
    expect(model?.cost?.input).toBeGreaterThan(0);
    const cost = usageCost(model, { input: 1_000_000, output: 0 });
    expect(formatCost(cost)).toMatch(/^\$/);
  });
});

describe("agent loop", () => {
  it("reads a file through the tool and then answers", async () => {
    const workspace = new MemoryWorkspace();
    await seedWorkspace(workspace);
    const seen: string[] = [];
    const result = await runAgent({
      system: "test",
      messages: [{ role: "user", content: "read the greeting" }],
      model: findModel(snapshotCatalog(), "opencode", "big-pickle")!,
      apiKey: "test",
      tools: [],
      ctx: ctx(workspace),
      chat: scriptedModel([
        { tools: [{ id: "1", name: "read", arguments: JSON.stringify({ path: "src/hello.ts" }) }] },
        { text: "The greeting is in src/hello.ts.", usage: { input: 10, output: 5 } },
      ]),
      onEvent: (event) => {
        if (event.type === "tool-end") seen.push(event.content);
        if (event.type === "text") seen.push(event.text);
      },
    });
    expect(seen.join("\n")).toContain("greet");
    expect(result.messages.at(-1)).toMatchObject({ role: "assistant", content: "The greeting is in src/hello.ts." });
    expect(result.usage.input).toBe(10);
  });

  it("blocks edits in plan mode", async () => {
    const workspace = new MemoryWorkspace();
    await seedWorkspace(workspace);
    const result = await executeTool("write", { path: "x.txt", content: "no" }, ctx(workspace, { mode: "plan" }));
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/Plan mode/);
    expect(toolNames("plan")).not.toContain("write");
    expect(toolNames("build")).toContain("edit");
  });

  it("returns a tool error when permission is denied", async () => {
    const workspace = new MemoryWorkspace();
    const result = await executeTool(
      "write",
      { path: "x.txt", content: "no" },
      ctx(workspace, {
        policy: { ...DEFAULT_POLICY, edit: "ask" },
        askPermission: async () => "deny",
      }),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/denied/);
    expect(await workspace.exists("x.txt")).toBe(false);
  });
});

describe("providers and instructions", () => {
  it("converts transcripts for OpenAI, Anthropic, and Gemini", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok", toolCalls: [{ id: "c1", name: "read", arguments: "{\"path\":\"a\"}" }] },
      { role: "tool", toolCallId: "c1", name: "read", content: "file" },
    ];
    const openai = toOpenAIMessages("sys", messages);
    expect(openai[0]).toMatchObject({ role: "system" });
    expect(openai[2]).toMatchObject({ role: "assistant" });
    expect(openai[3]).toMatchObject({ role: "tool", tool_call_id: "c1" });
    const anthropic = toAnthropicMessages(messages);
    expect(anthropic[1]?.role).toBe("assistant");
    expect(anthropic[2]?.role).toBe("user");
    const gemini = toGeminiContents(messages);
    expect(gemini[1]?.role).toBe("model");
    expect(gemini[2]?.parts[0]).toHaveProperty("functionResponse");
  });

  it("parses server-sent events", async () => {
    const response = new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n');
    const chunks: string[] = [];
    for await (const chunk of iterateSseData(response)) chunks.push(chunk);
    expect(chunks).toEqual(['{"choices":[{"delta":{"content":"hi"}}]}']);
  });

  it("loads AGENTS.md from the workspace root and nested folders", async () => {
    const workspace = new MemoryWorkspace();
    await workspace.writeText("AGENTS.md", "root rule");
    await workspace.writeText("src/AGENTS.md", "src rule");
    const text = await loadAgentsMd(workspace);
    expect(text).toContain("root rule");
    expect(text).toContain("src rule");
  });

  it("parses DuckDuckGo lite results", () => {
    const html = `<a class="result-link" href="https://example.com">Example</a><td class="result-snippet">A snippet</td>`;
    expect(parseDuckDuckGo(html)[0]).toMatchObject({ url: "https://example.com", title: "Example" });
  });

  it("diffs changed lines", () => {
    const diff = unifiedDiff("a.txt", "one\ntwo\n", "one\nthree\n");
    expect(diff).toContain("-two");
    expect(diff).toContain("+three");
  });
});

describe("git", () => {
  it("inits, commits, and logs with isomorphic-git", async () => {
    const workspace = new MemoryWorkspace();
    await workspace.writeText("README.md", "hello\n");
    const init = await runGit(workspace, { action: "init" });
    expect(init).toMatch(/Initialized/);
    const commit = await runGit(workspace, { action: "commit", message: "initial" });
    expect(commit).toMatch(/Committed/);
    const log = await runGit(workspace, { action: "log" });
    expect(log).toContain("initial");
    const status = await runGit(workspace, { action: "status" });
    expect(status).toMatch(/Clean/);
  });
});
