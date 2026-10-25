import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isFree } from "../../core/catalog";
import { formatCost, formatTokens } from "../../core/cost";
import { hasRealCredential, isZenProvider, PUBLIC_ZEN_KEY, resolveApiKey } from "../../core/identity";
import type { ModelMessage } from "../../core/llm";
import { useApp } from "../../runtime/state";
import { Collapsible, Markdown } from "../../ui/markdown";
import { mono } from "../../ui/theme";

const SUGGESTIONS = ["Read src/hello.ts and explain it", "Add multiply() to src/math.ts", "/init", "/plan"];

export default function ChatScreen() {
  const app = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [drawer, setDrawer] = useState(false);
  const theme = app.theme;
  const tokens = app.active.usage.input + app.active.usage.output;
  const key = app.model ? resolveApiKey(app.model, app.secrets[app.model.providerID]) : "";
  const publicZen = Boolean(app.model && isZenProvider(app.model.providerID) && key === PUBLIC_ZEN_KEY);
  const commands = text.startsWith("/")
    ? ["/help", "/plan", "/build", "/init", "/review", "/model", "/theme", "/undo", "/cost", "/compact", "/new"].filter((item) => item.startsWith(text.trim()))
    : [];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.border, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable onPress={() => setDrawer(true)} hitSlop={8} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 18 }}>≡</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 15 }} numberOfLines={1}>
            {app.active.title}
          </Text>
          <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 11 }} numberOfLines={1}>
            {publicZen ? "Zen · no key" : app.model ? app.model.providerName : "OpenCode"} · {formatTokens(tokens)} tok · {formatCost(app.active.cost)}
          </Text>
        </View>
        <Pressable onPress={() => router.push("/connect")}>
          <Text style={{ color: hasRealCredential(app.secrets.opencode) || hasRealCredential(app.secrets["github-copilot"]) ? theme.green : theme.accent, fontFamily: mono, fontSize: 12 }}>
            connect
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, gap: 14, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {app.active.messages.length === 0 && !app.draft ? (
          <View style={{ gap: 12, paddingTop: 28 }}>
            <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 28 }}>OpenCode</Text>
            <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 14, lineHeight: 22 }}>
              Free Zen models are ready on this phone. No API key. The agent runs in the app and calls OpenCode the same way the desktop app does.
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {SUGGESTIONS.map((item) => (
                <Pressable key={item} onPress={() => void app.send(item)} style={chip(theme.bgElev, theme.border)}>
                  <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 13 }}>{item}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {blocks(app.active.messages).map((block, index) => (
          <MessageView key={`${block.message.role}-${index}`} message={block.message} tools={block.tools} />
        ))}
        {app.draft ? <DraftView /> : null}
        {app.error ? <Text style={{ color: theme.red, fontFamily: mono, fontSize: 12 }}>{app.error}</Text> : null}
      </ScrollView>

      {app.active.todos.length ? (
        <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 11, paddingHorizontal: 14, paddingBottom: 4 }}>
          todos {app.active.todos.filter((todo) => todo.status === "completed").length}/{app.active.todos.length}
          {app.active.todos.find((todo) => todo.status === "in_progress") ? ` · ${app.active.todos.find((todo) => todo.status === "in_progress")!.content}` : ""}
        </Text>
      ) : null}
      {commands.length ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 4, gap: 2 }}>
          {commands.map((command) => (
            <Pressable key={command} onPress={() => setText(`${command} `)}>
              <Text style={{ color: theme.accent, fontFamily: mono, fontSize: 12 }}>{command}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={{ margin: 10, marginBottom: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgElev, borderRadius: 16, padding: 10, gap: 8 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Ask OpenCode…"
          placeholderTextColor={theme.muted}
          multiline
          style={{ minHeight: 40, maxHeight: 120, color: theme.fg, fontFamily: mono, fontSize: 15 }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onPress={() => app.setMode(app.mode === "build" ? "plan" : "build")} style={chip(theme.bg, theme.border)}>
            <Text style={{ color: app.mode === "plan" ? theme.yellow : theme.green, fontFamily: mono, fontSize: 12 }}>{app.mode}</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/models")} style={[chip(theme.bg, theme.border), { flexShrink: 1 }]}>
            <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 12 }} numberOfLines={1}>
              {app.model ? app.model.name : "model"}
              {app.model && isFree(app.model) ? " · free" : ""}
            </Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => {
              if (app.sending) app.stop();
              else {
                const next = text;
                setText("");
                void app.send(next);
              }
            }}
            style={{ backgroundColor: theme.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}
          >
            <Text style={{ color: theme.bg, fontFamily: mono, fontWeight: "700" }}>{app.sending ? "stop" : "send"}</Text>
          </Pressable>
        </View>
      </View>

      {drawer ? <SessionDrawer onClose={() => setDrawer(false)} /> : null}
    </KeyboardAvoidingView>
  );
}

function chip(backgroundColor: string, borderColor: string) {
  return { backgroundColor, borderColor, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 };
}

function SessionDrawer({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = app.theme;
  const go = (path: "/files" | "/diff" | "/settings" | "/connect" | "/models") => {
    onClose();
    router.push(path);
  };
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" }}>
      <View style={{ width: "84%", maxWidth: 340, backgroundColor: theme.bgAlt, paddingTop: insets.top + 12, borderRightWidth: 1, borderRightColor: theme.border }}>
        <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 4 }}>
          <Text style={{ color: theme.accent, fontFamily: mono, fontSize: 18 }}>opencode</Text>
          <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 11 }} numberOfLines={1}>
            {app.workspaceLabel}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: 14, paddingBottom: 10 }}>
          <Pressable onPress={() => { app.newSession(); onClose(); }}>
            <Text style={{ color: theme.green, fontFamily: mono }}>new session</Text>
          </Pressable>
          <Pressable onPress={() => go("/connect")}>
            <Text style={{ color: theme.fg, fontFamily: mono }}>connect</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 8, gap: 4, paddingBottom: 12 }}>
          {app.sessions.map((session) => {
            const active = session.id === app.active.id;
            return (
              <Pressable
                key={session.id}
                onPress={() => {
                  app.openSession(session.id);
                  onClose();
                }}
                style={{ backgroundColor: active ? theme.bgElev : "transparent", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10 }}
              >
                <Text style={{ color: theme.fg, fontFamily: mono }} numberOfLines={1}>
                  {session.title}
                </Text>
                <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 11 }} numberOfLines={1}>
                  {session.mode} · {session.modelID}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ borderTopWidth: 1, borderTopColor: theme.border, padding: 14, gap: 10 }}>
          {(
            [
              ["/files", "Files"],
              ["/diff", "Diff"],
              ["/models", "Models"],
              ["/settings", "Settings"],
            ] as const
          ).map(([path, label]) => (
            <Pressable key={path} onPress={() => go(path)}>
              <Text style={{ color: theme.fg, fontFamily: mono }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} onPress={onClose} />
    </View>
  );
}

function blocks(messages: ModelMessage[]) {
  const out: Array<{ message: ModelMessage; tools: Extract<ModelMessage, { role: "tool" }>[] }> = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === "tool") continue;
    const tools: Extract<ModelMessage, { role: "tool" }>[] = [];
    if (message.role === "assistant") {
      let cursor = index + 1;
      while (messages[cursor]?.role === "tool") {
        tools.push(messages[cursor] as Extract<ModelMessage, { role: "tool" }>);
        cursor += 1;
      }
    }
    out.push({ message, tools });
  }
  return out;
}

function MessageView({ message, tools }: { message: ModelMessage; tools: Extract<ModelMessage, { role: "tool" }>[] }) {
  const { theme } = useApp();
  if (message.role === "user") {
    return (
      <View style={{ alignSelf: "flex-end", maxWidth: "92%", backgroundColor: theme.user, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 14 }}>{message.content}</Text>
      </View>
    );
  }
  if (message.role !== "assistant") return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.accent, fontFamily: mono, fontSize: 11 }}>opencode</Text>
      <Collapsible title="thinking" theme={theme}>
        {message.reasoning ?? ""}
      </Collapsible>
      {message.toolCalls?.map((call) => {
        const result = tools.find((tool) => tool.toolCallId === call.id);
        return <ToolCard key={call.id} name={call.name} args={call.arguments} result={result?.content} error={result?.isError} />;
      })}
      {message.content ? <Markdown text={message.content} theme={theme} /> : null}
    </View>
  );
}

function DraftView() {
  const { draft, theme } = useApp();
  if (!draft) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.accent, fontFamily: mono, fontSize: 11 }}>opencode</Text>
      <Collapsible title="thinking" theme={theme}>
        {draft.reasoning}
      </Collapsible>
      {draft.tools.map((tool) => (
        <ToolCard key={tool.id} name={tool.name} args={tool.arguments} result={tool.result} error={tool.isError} />
      ))}
      {draft.text ? <Markdown text={draft.text} theme={theme} /> : <Text style={{ color: theme.muted, fontFamily: mono }}>…</Text>}
    </View>
  );
}

function toolTitle(name: string, args: string): string {
  try {
    const parsed = JSON.parse(args) as { path?: string; filePath?: string; command?: string; query?: string };
    const target = parsed.path || parsed.filePath || parsed.command || parsed.query;
    if (typeof target === "string" && target) return `${name}  ${target}`;
  } catch {
    // Arguments may still be streaming.
  }
  return name;
}

function ToolCard({ name, args, result, error }: { name: string; args: string; result?: string; error?: boolean }) {
  const { theme } = useApp();
  const [open, setOpen] = useState(false);
  const done = result !== undefined;
  return (
    <Pressable onPress={() => setOpen((value) => !value)} style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgAlt, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, borderLeftWidth: 3, borderLeftColor: error ? theme.red : done ? theme.green : theme.accent }}>
      <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 12 }} numberOfLines={open ? undefined : 1}>
        {done ? (error ? "failed" : "done") : "running"} · {toolTitle(name, args)}
      </Text>
      {open ? (
        <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 11, marginTop: 6 }}>
          {args}
          {result ? `\n${result.slice(0, 1600)}` : ""}
        </Text>
      ) : null}
    </Pressable>
  );
}
