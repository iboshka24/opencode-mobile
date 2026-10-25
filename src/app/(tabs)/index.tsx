import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatCost, formatTokens } from "../../core/cost";
import type { ModelMessage } from "../../core/llm";
import { useApp } from "../../runtime/state";
import { Collapsible, Markdown } from "../../ui/markdown";
import { mono } from "../../ui/theme";

const SUGGESTIONS = ["/init", "/plan", "Read src/hello.ts and explain it", "Add multiply() to src/math.ts"];

export default function ChatScreen() {
  const app = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const theme = app.theme;
  const tokens = app.active.usage.input + app.active.usage.output;
  const commands = text.startsWith("/")
    ? ["/help", "/plan", "/build", "/init", "/review", "/model", "/theme", "/undo", "/cost", "/compact", "/new"].filter((item) => item.startsWith(text.trim()))
    : [];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: theme.accent, fontFamily: mono, fontSize: 18 }}>opencode</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pressable onPress={() => app.setMode(app.mode === "build" ? "plan" : "build")} style={pill(theme.bgElev, theme.border)}>
              <Text style={{ color: app.mode === "plan" ? theme.yellow : theme.green, fontFamily: mono, fontSize: 12 }}>{app.mode}</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/models")} style={pill(theme.bgElev, theme.border)}>
              <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 12 }} numberOfLines={1}>
                {app.model ? app.model.name : "model"}
              </Text>
            </Pressable>
          </View>
        </View>
        <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 11 }}>
          {app.model ? `${app.model.providerID}/${app.model.id}` : "no model"} · {formatTokens(tokens)} tok · {formatCost(app.active.cost)} · {app.catalogStatus === "live" ? "models.dev" : "snapshot"}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, flexGrow: 1 }}>
        {app.active.messages.length === 0 && !app.draft ? (
          <View style={{ gap: 10, paddingTop: 24 }}>
            <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 16 }}>On this phone</Text>
            <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 13, lineHeight: 20 }}>
              The agent runs inside this install. There is no Metro server and no backend. Choose OpenCode Zen or another models.dev provider, save its API key in Settings, and the phone calls that API itself. Workspace: {app.workspaceLabel}.
            </Text>
            {SUGGESTIONS.map((item) => (
              <Pressable key={item} onPress={() => void app.send(item)} style={pill(theme.bgElev, theme.border)}>
                <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 13 }}>{item}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => void app.runOfflineDemo()} style={pill(theme.bg, theme.accent)}>
              <Text style={{ color: theme.accent, fontFamily: mono, fontSize: 13 }}>Run offline tool demo</Text>
            </Pressable>
          </View>
        ) : null}
        {blocks(app.active.messages).map((block, index) => (
          <MessageView key={index} message={block.message} tools={block.tools} />
        ))}
        {app.draft ? <DraftView /> : null}
        {app.error ? <Text style={{ color: theme.red, fontFamily: mono, fontSize: 12 }}>{app.error}</Text> : null}
      </ScrollView>
      {app.active.todos.length ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 6 }}>
          <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 11 }}>
            todos {app.active.todos.filter((todo) => todo.status === "completed").length}/{app.active.todos.length}
            {app.active.todos.find((todo) => todo.status === "in_progress") ? ` · ${app.active.todos.find((todo) => todo.status === "in_progress")!.content}` : ""}
          </Text>
        </View>
      ) : null}
      {commands.length ? (
        <View style={{ paddingHorizontal: 14, gap: 4 }}>
          {commands.map((command) => (
            <Pressable key={command} onPress={() => setText(`${command} `)}>
              <Text style={{ color: theme.accent, fontFamily: mono, fontSize: 12 }}>{command}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, padding: 12, paddingBottom: 8, borderTopWidth: 1, borderTopColor: theme.border, alignItems: "flex-end" }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message or /command"
          placeholderTextColor={theme.muted}
          multiline
          style={{ flex: 1, maxHeight: 120, color: theme.fg, fontFamily: mono, fontSize: 14, backgroundColor: theme.bgElev, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}
        />
        <Pressable
          onPress={() => {
            if (app.sending) app.stop();
            else {
              const next = text;
              setText("");
              void app.send(next);
            }
          }}
          style={{ backgroundColor: theme.accent, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 }}
        >
          <Text style={{ color: theme.bg, fontFamily: mono, fontWeight: "700" }}>{app.sending ? "stop" : "send"}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function pill(backgroundColor: string, borderColor: string) {
  return { backgroundColor, borderColor, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start" as const };
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
      <View style={{ alignSelf: "flex-end", maxWidth: "92%", backgroundColor: theme.user, borderRadius: 12, padding: 10 }}>
        <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 14 }}>{message.content}</Text>
      </View>
    );
  }
  if (message.role !== "assistant") return null;
  return (
    <View style={{ gap: 6 }}>
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
    <View style={{ gap: 6 }}>
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

function ToolCard({ name, args, result, error }: { name: string; args: string; result?: string; error?: boolean }) {
  const { theme } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((value) => !value)} style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgAlt, borderRadius: 10, padding: 8 }}>
      <Text style={{ color: error ? theme.red : theme.green, fontFamily: mono, fontSize: 12 }}>
        {result ? (error ? "✗" : "✓") : "…"} {name}
      </Text>
      {open ? (
        <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 11, marginTop: 4 }}>
          {args}
          {result ? `\n${result.slice(0, 1200)}` : ""}
        </Text>
      ) : null}
    </Pressable>
  );
}
