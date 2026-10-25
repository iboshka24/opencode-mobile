import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { runAgent } from "../core/agent";
import { findModel, isFree, MODELS_DEV_URL, parseCatalog, snapshotCatalog, type CatalogModel, type Protocol } from "../core/catalog";
import { helpText, parseSlash } from "../core/commands";
import { addUsage, emptyUsage, usageCost, type TokenUsage } from "../core/cost";
import { unifiedDiff } from "../core/difftext";
import { scriptedModel, type ModelMessage } from "../core/llm";
import { buildSystemPrompt, initPrompt, reviewPrompt } from "../core/prompt";
import { workspaceIsGit } from "../core/git";
import { themeById, THEMES, type Theme } from "../core/themes";
import { DEFAULT_POLICY, toolDefinitions, toolNames, type FileChange, type PermissionPolicy, type Todo } from "../core/tools";
import type { Workspace } from "../core/workspace";
import { openWorkspace, persistWebWorkspace } from "./device-workspace";
import { readSecret, readState, writeSecret, writeState } from "./storage";

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  protocol: Protocol;
  modelIds: string[];
}

export interface Session {
  id: string;
  title: string;
  mode: "build" | "plan";
  providerID: string;
  modelID: string;
  messages: ModelMessage[];
  todos: Todo[];
  changes: FileChange[];
  usage: TokenUsage;
  cost: number;
  createdAt: number;
  updatedAt: number;
}

interface PermissionPrompt {
  action: string;
  detail: string;
  resolve: (value: "allow" | "deny" | "always") => void;
}

interface QuestionPrompt {
  question: string;
  resolve: (value: string) => void;
}

interface DraftTool {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  isError?: boolean;
}

interface Draft {
  reasoning: string;
  text: string;
  tools: DraftTool[];
}

interface Persisted {
  themeId: string;
  providerID: string;
  modelID: string;
  permissions: PermissionPolicy;
  sessions: Session[];
  activeId: string;
  customProviders: CustomProvider[];
  gitAuthor: { name: string; email: string };
  secretIds: string[];
}

interface AppValue {
  ready: boolean;
  theme: Theme;
  themeId: string;
  setThemeId: (id: string) => void;
  mode: "build" | "plan";
  setMode: (mode: "build" | "plan") => void;
  models: CatalogModel[];
  catalogStatus: "snapshot" | "live";
  refreshCatalog: () => Promise<void>;
  model: CatalogModel | null;
  setModel: (providerID: string, id: string) => void;
  sessions: Session[];
  active: Session;
  openSession: (id: string) => void;
  newSession: () => void;
  deleteSession: (id: string) => void;
  sending: boolean;
  draft: Draft | null;
  error: string;
  send: (text: string) => Promise<void>;
  stop: () => void;
  permission: PermissionPrompt | null;
  answerPermission: (value: "allow" | "deny" | "always") => void;
  question: QuestionPrompt | null;
  answerQuestion: (value: string) => void;
  filesVersion: number;
  refreshFiles: () => void;
  readFile: (path: string) => Promise<string>;
  listPath: (path?: string) => ReturnType<Workspace["list"]>;
  undo: () => Promise<void>;
  secrets: Record<string, string>;
  setSecret: (id: string, value: string) => Promise<void>;
  permissions: PermissionPolicy;
  setPermission: (key: keyof PermissionPolicy, value: "ask" | "allow") => void;
  customProviders: CustomProvider[];
  saveCustomProvider: (provider: CustomProvider) => void;
  gitAuthor: { name: string; email: string };
  setGitAuthor: (author: { name: string; email: string }) => void;
  runOfflineDemo: () => Promise<void>;
  workspaceLabel: string;
  nativeFiles: boolean;
  webKeys: boolean;
  routeRequest: string | null;
  clearRoute: () => void;
}

const AppContext = createContext<AppValue | null>(null);

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankSession(model: { providerID: string; id: string }): Session {
  const now = Date.now();
  return {
    id: uid(),
    title: "New session",
    mode: "build",
    providerID: model.providerID,
    modelID: model.id,
    messages: [],
    todos: [],
    changes: [],
    usage: emptyUsage(),
    cost: 0,
    createdAt: now,
    updatedAt: now,
  };
}

const DEFAULT_MODEL = { providerID: "opencode", id: "big-pickle" };

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [themeId, setThemeIdState] = useState("tokyonight");
  const [baseModels, setBaseModels] = useState<CatalogModel[]>(() => snapshotCatalog());
  const [catalogStatus, setCatalogStatus] = useState<"snapshot" | "live">("snapshot");
  const [sessions, setSessions] = useState<Session[]>([blankSession(DEFAULT_MODEL)]);
  const [activeId, setActiveId] = useState(sessions[0]!.id);
  const [permissions, setPermissions] = useState<PermissionPolicy>(DEFAULT_POLICY);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [gitAuthor, setGitAuthorState] = useState({ name: "OpenCode Mobile", email: "mobile@opencode.local" });
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLabel, setWorkspaceLabel] = useState("/workspace");
  const [nativeFiles, setNativeFiles] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [permission, setPermissionPrompt] = useState<PermissionPrompt | null>(null);
  const [question, setQuestion] = useState<QuestionPrompt | null>(null);
  const [filesVersion, setFilesVersion] = useState(0);
  const [routeRequest, setRouteRequest] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const secretIds = useRef<string[]>([]);

  const models = useMemo(() => {
    const custom = customProviders.flatMap((provider) =>
      provider.modelIds.filter(Boolean).map(
        (id): CatalogModel => ({
          providerID: provider.id,
          providerName: provider.name,
          id,
          name: id,
          api: provider.baseUrl,
          env: [],
          toolCall: true,
          reasoning: false,
          temperature: true,
          protocol: provider.protocol,
        }),
      ),
    );
    return [...custom, ...baseModels];
  }, [baseModels, customProviders]);

  const active = sessions.find((session) => session.id === activeId) ?? sessions[0]!;
  const model = findModel(models, active.providerID, active.modelID) ?? findModel(models, "opencode", "big-pickle") ?? models[0] ?? null;
  const theme = themeById(themeId);

  const patchSession = (id: string, recipe: (session: Session) => Session) => {
    setSessions((current) => current.map((session) => (session.id === id ? recipe(session) : session)));
  };
  const patchActive = (recipe: (session: Session) => Session) => patchSession(activeId, recipe);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const opened = await openWorkspace();
      const raw = await readState();
      let nextSessions = [blankSession(DEFAULT_MODEL)];
      let nextActive = nextSessions[0]!.id;
      let nextTheme = "tokyonight";
      let nextPermissions = DEFAULT_POLICY;
      let nextCustom: CustomProvider[] = [];
      let nextAuthor = { name: "OpenCode Mobile", email: "mobile@opencode.local" };
      let ids: string[] = [];
      if (raw) {
        try {
          const saved = JSON.parse(raw) as Persisted;
          if (saved.sessions?.length) {
            nextSessions = saved.sessions;
            nextActive = saved.sessions.some((session) => session.id === saved.activeId) ? saved.activeId : saved.sessions[0]!.id;
          }
          nextTheme = saved.themeId || nextTheme;
          nextPermissions = { ...DEFAULT_POLICY, ...saved.permissions };
          nextCustom = saved.customProviders ?? [];
          nextAuthor = saved.gitAuthor ?? nextAuthor;
          ids = saved.secretIds ?? [];
        } catch {
          // Keep the fresh session if the saved file is unreadable.
        }
      }
      const loaded: Record<string, string> = {};
      for (const id of ids) {
        const value = await readSecret(id);
        if (value) loaded[id] = value;
      }
      if (cancelled) return;
      secretIds.current = ids;
      setWorkspace(opened.workspace);
      setWorkspaceLabel(opened.label);
      setNativeFiles(opened.native);
      setSessions(nextSessions);
      setActiveId(nextActive);
      setThemeIdState(nextTheme);
      setPermissions(nextPermissions);
      setCustomProviders(nextCustom);
      setGitAuthorState(nextAuthor);
      setSecrets(loaded);
      setReady(true);
      void refresh(setBaseModels, setCatalogStatus);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const payload: Persisted = {
      themeId,
      providerID: active.providerID,
      modelID: active.modelID,
      permissions,
      sessions: sessions.map((session) => ({
        ...session,
        messages: session.messages.slice(-80),
      })).slice(-20),
      activeId,
      customProviders,
      gitAuthor,
      secretIds: secretIds.current,
    };
    void writeState(JSON.stringify(payload));
  }, [ready, themeId, permissions, sessions, activeId, customProviders, gitAuthor, active.providerID, active.modelID]);

  const refreshCatalog = async () => {
    await refresh(setBaseModels, setCatalogStatus);
  };

  const setThemeId = (id: string) => setThemeIdState(themeById(id).id);

  const setMode = (mode: "build" | "plan") => {
    patchActive((session) => ({ ...session, mode, updatedAt: Date.now() }));
  };

  const setModel = (providerID: string, id: string) => {
    patchActive((session) => ({ ...session, providerID, modelID: id, updatedAt: Date.now() }));
  };

  const openSession = (id: string) => setActiveId(id);

  const newSession = () => {
    const session = blankSession(model ?? DEFAULT_MODEL);
    session.mode = active.mode;
    setSessions((current) => [session, ...current]);
    setActiveId(session.id);
  };

  const deleteSession = (id: string) => {
    setSessions((current) => {
      const next = current.filter((session) => session.id !== id);
      const fallback = next[0] ?? blankSession(model ?? DEFAULT_MODEL);
      if (next.length === 0) next.push(fallback);
      if (id === activeId) setActiveId(fallback.id);
      return next;
    });
  };

  const setSecret = async (id: string, value: string) => {
    await writeSecret(id, value);
    setSecrets((current) => {
      const next = { ...current };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });
    const ids = new Set(secretIds.current);
    if (value) ids.add(id);
    else ids.delete(id);
    if ((id === "opencode" || id === "opencode-go") && value) {
      const other = id === "opencode" ? "opencode-go" : "opencode";
      if (!secrets[other]) {
        await writeSecret(other, value);
        ids.add(other);
        setSecrets((current) => ({ ...current, [other]: value }));
      }
    }
    secretIds.current = [...ids];
  };

  const setPermission = (key: keyof PermissionPolicy, value: "ask" | "allow") => {
    setPermissions((current) => ({ ...current, [key]: value }));
  };

  const saveCustomProvider = (provider: CustomProvider) => {
    setCustomProviders((current) => {
      const next = current.filter((item) => item.id !== provider.id);
      return [...next, provider];
    });
  };

  const setGitAuthor = (author: { name: string; email: string }) => setGitAuthorState(author);

  const askPermission = (action: string, detail: string) =>
    new Promise<"allow" | "deny" | "always">((resolve) => {
      setPermissionPrompt({ action, detail, resolve });
    });

  const answerPermission = (value: "allow" | "deny" | "always") => {
    permission?.resolve(value);
    if (value === "always" && (permission?.action === "edit" || permission?.action === "shell" || permission?.action === "git" || permission?.action === "network")) {
      setPermissionKey(permission.action);
    }
    setPermissionPrompt(null);
  };

  const setPermissionKey = (action: "edit" | "shell" | "git" | "network") => {
    setPermissions((current) => ({ ...current, [action]: "allow" }));
  };

  const askUser = (prompt: string) =>
    new Promise<string>((resolve) => {
      setQuestion({ question: prompt, resolve });
    });

  const answerQuestion = (value: string) => {
    question?.resolve(value);
    setQuestion(null);
  };

  const refreshFiles = () => setFilesVersion((value) => value + 1);

  const runTurn = async (session: Session, text: string, chat?: Parameters<typeof runAgent>[0]["chat"]) => {
    if (!workspace || !model) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    setError("");
    setDraft({ reasoning: "", text: "", tools: [] });
    const userMessage: ModelMessage = { role: "user", content: text };
    const history = [...session.messages, userMessage];
    const todos = [...session.todos];
    const changes = [...session.changes];
    const policy = { ...permissions };
    let usage = session.usage;
    let cost = session.cost;
    try {
      const agents = (await import("../core/agents-md")).loadAgentsMd;
      const instructions = await agents(workspace);
      const git = await workspaceIsGit(workspace);
      const system = buildSystemPrompt({
        modelId: model.id,
        modelName: model.name,
        providerID: model.providerID,
        toolNames: toolNames(session.mode),
        workspaceLabel,
        git,
        platform: Platform.OS,
        agentsMd: instructions,
        mode: session.mode,
      });
      const result = await runAgent({
        system,
        messages: history,
        model,
        apiKey: secrets[model.providerID] ?? "",
        baseUrl: model.api,
        tools: toolDefinitions(session.mode),
        signal: controller.signal,
        chat,
        ctx: {
          workspace,
          mode: session.mode,
          todos,
          changes,
          policy,
          githubToken: secrets.github,
          braveKey: secrets.brave,
          gitAuthor,
          signal: controller.signal,
          askPermission,
          askUser,
        },
        onEvent: (event) => {
          if (event.type === "usage") {
            usage = addUsage(usage, event.usage);
            cost += usageCost(model, event.usage);
          }
          setDraft((current) => {
            const next = current ?? { reasoning: "", text: "", tools: [] };
            if (event.type === "text") return { ...next, text: next.text + event.text };
            if (event.type === "reasoning") return { ...next, reasoning: next.reasoning + event.text };
            if (event.type === "tool-start") {
              return { ...next, tools: [...next.tools, { id: event.id, name: event.name, arguments: event.arguments }] };
            }
            if (event.type === "tool-end") {
              return {
                ...next,
                tools: next.tools.map((tool) => (tool.id === event.id ? { ...tool, result: event.content, isError: event.isError } : tool)),
              };
            }
            return next;
          });
        },
      });
      const title = session.title === "New session" ? text.replace(/\s+/g, " ").slice(0, 42) : session.title;
      patchSession(session.id, (current) => ({
        ...current,
        title,
        messages: result.messages,
        todos,
        changes,
        usage,
        cost,
        updatedAt: Date.now(),
      }));
      setPermissions(policy);
      await persistWebWorkspace(workspace);
      refreshFiles();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message !== "Stopped") setError(message);
      patchSession(session.id, (current) => ({
        ...current,
        messages: [
          ...history,
          { role: "assistant", content: message === "Stopped" ? "Stopped." : `Request failed: ${message}`, local: true },
        ],
        todos,
        changes,
        usage,
        cost,
        updatedAt: Date.now(),
      }));
    } finally {
      setDraft(null);
      setSending(false);
      abortRef.current = null;
    }
  };

  const pushLocal = (content: string, role: "user" | "assistant" = "assistant") => {
    patchActive((session) => ({
      ...session,
      messages: [...session.messages, { role, content, local: true }],
      updatedAt: Date.now(),
    }));
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const slash = parseSlash(trimmed);
    if (slash.type === "help") {
      pushLocal(trimmed, "user");
      pushLocal(helpText());
      return;
    }
    if (slash.type === "plan" || slash.type === "build") {
      setMode(slash.type);
      pushLocal(`Switched to ${slash.type} mode.`);
      return;
    }
    if (slash.type === "new") {
      newSession();
      return;
    }
    if (slash.type === "theme") {
      if (!slash.name) {
        setRouteRequest("/settings");
        return;
      }
      setThemeId(slash.name);
      pushLocal(`Theme set to ${themeById(slash.name).name}.`);
      return;
    }
    if (slash.type === "model") {
      if (slash.query.includes("/")) {
        const [providerID, ...rest] = slash.query.split("/");
        const id = rest.join("/");
        if (providerID && id && findModel(models, providerID, id)) {
          setModel(providerID, id);
          pushLocal(`Model set to ${providerID}/${id}.`);
          return;
        }
      }
      setRouteRequest("/models");
      return;
    }
    if (slash.type === "cost") {
      pushLocal(`${active.usage.input + active.usage.output} tokens · ${active.cost === 0 ? "$0" : `$${active.cost.toFixed(4)}`}`);
      return;
    }
    if (slash.type === "undo") {
      await undo();
      return;
    }
    if (slash.type === "unknown") {
      pushLocal(`Unknown command /${slash.name}.\n${helpText()}`);
      return;
    }
    if (!model) return;
    if (slash.type === "compact") {
      if (!secrets[model.providerID]) {
        patchActive((session) => ({
          ...session,
          messages: session.messages.filter((message) => !message.local).slice(-6),
          updatedAt: Date.now(),
        }));
        pushLocal("No API key for a model summary, so older messages were dropped locally.");
        return;
      }
      const transcript = active.messages
        .filter((message) => !message.local)
        .map((message) => `${message.role}: ${"content" in message ? message.content : ""}`)
        .join("\n")
        .slice(0, 12_000);
      await runTurn(active, `Summarize this session so work can continue. Keep file paths, decisions, and unfinished tasks.\n\n${transcript}`);
      return;
    }
    let prompt = trimmed;
    if (slash.type === "init") prompt = initPrompt(slash.args);
    if (slash.type === "review") {
      const diffs = active.changes.map((change) => unifiedDiff(change.path, change.before ?? "", change.after ?? "")).join("\n\n");
      prompt = `${reviewPrompt(slash.args)}\n\n${diffs || "No file edits have been recorded in this session."}`;
    }
    if ((slash.type === "prompt" || slash.type === "init" || slash.type === "review") && !secrets[model.providerID]) {
      pushLocal(trimmed, "user");
      pushLocal(`Add an API key for ${model.providerName} in Settings. The key stays on this device. OpenCode Zen free models use OPENCODE_API_KEY.`);
      return;
    }
    await runTurn({ ...active, messages: active.messages }, prompt);
  };

  const stop = () => abortRef.current?.abort();

  const undo = async () => {
    if (!workspace) return;
    const change = [...active.changes].reverse()[0];
    if (!change) {
      pushLocal("Nothing to undo in this session.");
      return;
    }
    if (change.before === null) {
      if (await workspace.exists(change.path)) await workspace.remove(change.path);
    } else {
      await workspace.writeText(change.path, change.before);
    }
    patchActive((session) => ({ ...session, changes: session.changes.slice(0, -1), updatedAt: Date.now() }));
    await persistWebWorkspace(workspace);
    refreshFiles();
    pushLocal(`Reverted ${change.path}.`);
  };

  const runOfflineDemo = async () => {
    if (!workspace || !model || sending) return;
    const demoModel = model;
    await runTurn(
      { ...active, messages: active.messages },
      "Offline demo: read README.md and write notes/demo.txt. Do not call a provider.",
      scriptedModel([
        {
          reasoning: "The workspace is on the device. I'll read the sample, then write a note.",
          tools: [{ id: "demo-read", name: "read", arguments: JSON.stringify({ path: "README.md" }) }],
        },
        {
          tools: [
            {
              id: "demo-write",
              name: "write",
              arguments: JSON.stringify({
                path: "notes/demo.txt",
                content: "OpenCode Mobile ran this edit on the device.\n",
              }),
            },
          ],
        },
        { text: "Offline demo finished. If you allowed the edit, notes/demo.txt is in the workspace and the diff tab.", usage: { input: 0, output: 0 } },
      ]),
    );
    void demoModel;
  };

  const value: AppValue = {
    ready,
    theme,
    themeId,
    setThemeId,
    mode: active.mode,
    setMode,
    models,
    catalogStatus,
    refreshCatalog,
    model,
    setModel,
    sessions,
    active,
    openSession,
    newSession,
    deleteSession,
    sending,
    draft,
    error,
    send,
    stop,
    permission,
    answerPermission,
    question,
    answerQuestion,
    filesVersion,
    refreshFiles,
    readFile: async (path: string) => {
      if (!workspace) return "";
      return workspace.readText(path);
    },
    listPath: (path?: string) => {
      if (!workspace) return Promise.resolve([]);
      return workspace.list(path);
    },
    undo,
    secrets,
    setSecret,
    permissions,
    setPermission,
    customProviders,
    saveCustomProvider,
    gitAuthor,
    setGitAuthor,
    runOfflineDemo,
    workspaceLabel,
    nativeFiles,
    webKeys: Platform.OS === "web",
    routeRequest,
    clearRoute: () => setRouteRequest(null),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

async function refresh(
  setBaseModels: (models: CatalogModel[]) => void,
  setCatalogStatus: (status: "snapshot" | "live") => void,
) {
  try {
    const response = await fetch(MODELS_DEV_URL);
    if (!response.ok) return;
    const live = parseCatalog(await response.json());
    if (live.length > 10) {
      setBaseModels(live);
      setCatalogStatus("live");
    }
  } catch {
    setCatalogStatus("snapshot");
  }
}

export function useApp(): AppValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}

export { isFree };
