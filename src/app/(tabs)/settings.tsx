import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Protocol } from "../../core/catalog";
import { THEMES } from "../../core/themes";
import { useApp, type CustomProvider } from "../../runtime/state";
import { mono } from "../../ui/theme";

const PROVIDERS: Array<[string, string, string]> = [
  ["opencode", "OpenCode Zen", "OPENCODE_API_KEY"],
  ["opencode-go", "OpenCode Go", "OPENCODE_API_KEY"],
  ["anthropic", "Anthropic", "ANTHROPIC_API_KEY"],
  ["openai", "OpenAI", "OPENAI_API_KEY"],
  ["google", "Google", "GEMINI_API_KEY"],
  ["openrouter", "OpenRouter", "OPENROUTER_API_KEY"],
  ["deepseek", "DeepSeek", "DEEPSEEK_API_KEY"],
  ["groq", "Groq", "GROQ_API_KEY"],
  ["xai", "xAI", "XAI_API_KEY"],
  ["mistral", "Mistral", "MISTRAL_API_KEY"],
  ["brave", "Brave Search", "BRAVE_API_KEY"],
  ["github", "GitHub", "GITHUB_TOKEN"],
];

export default function SettingsScreen() {
  const app = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [custom, setCustom] = useState<CustomProvider>({
    id: "custom",
    name: "Custom",
    baseUrl: "https://",
    protocol: "openai",
    modelIds: ["custom-model"],
  });
  return (
    <ScrollView style={{ flex: 1, backgroundColor: app.theme.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 40, gap: 14 }}>
      <Text style={{ color: app.theme.accent, fontFamily: mono, fontSize: 16 }}>settings</Text>
      <Text style={{ color: app.theme.muted, fontFamily: mono, fontSize: 12, lineHeight: 18 }}>
        Free OpenCode Zen models work with no API key, the same way they do in OpenCode desktop. Connect an account for Console, GitHub Copilot, ChatGPT, or Claude. A pasted key is only needed for other providers.
      </Text>
      <Pressable onPress={() => router.push("/connect")}>
        <Text style={{ color: app.theme.accent, fontFamily: mono }}>Connect an account</Text>
      </Pressable>
      {PROVIDERS.map(([id, name, env]) => (
        <KeyField key={id} id={id} name={name} env={env} />
      ))}
      <Text style={{ color: app.theme.fg, fontFamily: mono }}>OpenAI-compatible endpoint</Text>
      <Field label="Base URL" value={custom.baseUrl} onChange={(baseUrl) => setCustom({ ...custom, baseUrl })} />
      <Field label="Model id" value={custom.modelIds[0] ?? ""} onChange={(id) => setCustom({ ...custom, modelIds: [id] })} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["openai", "anthropic", "google"] as Protocol[]).map((protocol) => (
          <Pressable key={protocol} onPress={() => setCustom({ ...custom, protocol })} style={{ borderWidth: 1, borderColor: custom.protocol === protocol ? app.theme.accent : app.theme.border, borderRadius: 8, padding: 8 }}>
            <Text style={{ color: app.theme.fg, fontFamily: mono, fontSize: 12 }}>{protocol}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        onPress={() => {
          app.saveCustomProvider(custom);
        }}
      >
        <Text style={{ color: app.theme.green, fontFamily: mono }}>Save custom provider</Text>
      </Pressable>
      <Text style={{ color: app.theme.fg, fontFamily: mono }}>Theme</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {THEMES.map((theme) => (
          <Pressable key={theme.id} onPress={() => app.setThemeId(theme.id)} style={{ backgroundColor: theme.bg, borderColor: app.themeId === theme.id ? app.theme.accent : theme.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 }}>
            <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 12 }}>{theme.name}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ color: app.theme.fg, fontFamily: mono }}>Permissions</Text>
      {(["edit", "shell", "git", "network"] as const).map((key) => (
        <Pressable key={key} onPress={() => app.setPermission(key, app.permissions[key] === "ask" ? "allow" : "ask")}>
          <Text style={{ color: app.theme.fg, fontFamily: mono, fontSize: 13 }}>
            {key}: {app.permissions[key]}
          </Text>
        </Pressable>
      ))}
      <Field label="Git author" value={app.gitAuthor.name} onChange={(name) => app.setGitAuthor({ ...app.gitAuthor, name })} />
      <Field label="Git email" value={app.gitAuthor.email} onChange={(email) => app.setGitAuthor({ ...app.gitAuthor, email })} />
      <Pressable onPress={() => void app.runOfflineDemo()}>
        <Text style={{ color: app.theme.accent, fontFamily: mono }}>Run offline tool demo</Text>
      </Pressable>
      <Text style={{ color: app.theme.muted, fontFamily: mono, fontSize: 12, lineHeight: 18 }}>
        Shell is a JavaScript sandbox. bash, node, and npm cannot run on iOS. Git uses isomorphic-git over HTTPS. Web search uses DuckDuckGo from the device, or Brave if you add a key.
      </Text>
    </ScrollView>
  );
}

function KeyField({ id, name, env }: { id: string; name: string; env: string }) {
  const app = useApp();
  const [value, setValue] = useState(app.secrets[id] ?? "");
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: app.theme.fg, fontFamily: mono, fontSize: 13 }}>
        {name} <Text style={{ color: app.theme.muted }}>{env}</Text> {app.secrets[id] ? "· saved" : ""}
      </Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="paste key"
        placeholderTextColor={app.theme.muted}
        onEndEditing={() => void app.setSecret(id, value.trim())}
        style={{ color: app.theme.fg, fontFamily: mono, borderWidth: 1, borderColor: app.theme.border, borderRadius: 8, padding: 8 }}
      />
    </View>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { theme } = useApp();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 11 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ color: theme.fg, fontFamily: mono, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 8 }}
      />
    </View>
  );
}
