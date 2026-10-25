import { useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  exchangeAnthropicCode,
  exchangeOpenAICode,
  pollConsoleLogin,
  pollCopilotLogin,
  pollOpenAILogin,
  sleep,
  startConsoleLogin,
  startCopilotLogin,
  startOpenAILogin,
  copilotProfile,
  loadConsoleAccount,
  anthropicLogin,
  parseAnthropicCode,
  type DevicePoll,
} from "../core/auth";
import { hasRealCredential } from "../core/identity";
import { useApp } from "../runtime/state";
import { mono } from "../ui/theme";

type Busy = null | "console" | "copilot" | "openai" | "anthropic";

export default function ConnectScreen() {
  const app = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = app.theme;
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState("");
  const [userCode, setUserCode] = useState("");
  const [url, setUrl] = useState("");
  const [enterprise, setEnterprise] = useState("");
  const [paste, setPaste] = useState("");
  const [claude, setClaude] = useState<ReturnType<typeof anthropicLogin> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(null);
  };

  const open = () => {
    if (url) void Linking.openURL(url);
  };

  const finish = async (label: string) => {
    setStatus(`${label} connected.`);
    setUserCode("");
    setBusy(null);
  };

  const pollDevice = async (interval: number, once: (signal: AbortSignal) => Promise<DevicePoll>) => {
    const controller = new AbortController();
    abortRef.current = controller;
    let wait = Math.max(interval, 1);
    const deadline = Date.now() + 15 * 60 * 1000;
    while (!controller.signal.aborted && Date.now() < deadline) {
      const result = await once(controller.signal);
      if (result.status === "ok") return result;
      if (result.status === "error") throw new Error(result.message);
      if (result.status === "slow_down" && result.intervalSec) wait = result.intervalSec;
      setStatus("Waiting for approval in the browser…");
      await sleep(wait * 1000, controller.signal);
    }
    throw new Error("Sign-in timed out.");
  };

  const connectConsole = async () => {
    setBusy("console");
    setStatus("Requesting a device code…");
    try {
      const device = await startConsoleLogin();
      setUserCode(device.userCode);
      setUrl(device.verificationUrl);
      setStatus("Enter this code on the OpenCode page.");
      void Linking.openURL(device.verificationUrl);
      const token = await pollDevice(device.intervalSec, (signal) => pollConsoleLogin(device.deviceCode, fetch, signal));
      const account = await loadConsoleAccount(token.access, token.orgId);
      await app.saveConsoleLogin({ access: token.access, refresh: token.refresh, orgId: account.orgId ?? token.orgId, email: account.email });
      await finish(account.email ? `OpenCode (${account.email})` : "OpenCode");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setBusy(null);
    }
  };

  const connectCopilot = async () => {
    setBusy("copilot");
    setStatus("Requesting a GitHub device code…");
    try {
      const device = await startCopilotLogin(enterprise);
      setUserCode(device.userCode);
      setUrl(device.verificationUrl);
      setStatus("Enter this code on GitHub.");
      void Linking.openURL(device.verificationUrl);
      const token = await pollDevice(device.intervalSec, (signal) => pollCopilotLogin(device.deviceCode, enterprise, fetch, signal));
      const profile = await copilotProfile(token.access, enterprise);
      if (profile.error) throw new Error(profile.error);
      await app.saveCopilotLogin({ access: token.access, api: profile.apiEndpoint });
      await finish("GitHub Copilot");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setBusy(null);
    }
  };

  const connectOpenAI = async () => {
    setBusy("openai");
    setStatus("Requesting a ChatGPT device code…");
    try {
      const device = await startOpenAILogin();
      setUserCode(device.userCode);
      setUrl(device.verificationUrl);
      setStatus("Enter this code on the ChatGPT page.");
      void Linking.openURL(device.verificationUrl);
      const controller = new AbortController();
      abortRef.current = controller;
      let wait = device.intervalSec;
      const deadline = Date.now() + 15 * 60 * 1000;
      let exchanged = false;
      while (!controller.signal.aborted && Date.now() < deadline) {
        const result = await pollOpenAILogin(device.deviceAuthId, device.userCode, fetch, controller.signal);
        if (result.status === "error") throw new Error(result.message);
        if (result.status === "exchange") {
          const token = await exchangeOpenAICode(result.code, result.verifier, fetch, controller.signal);
          await app.setSecret("openai", token.access);
          await app.setSecret("openai.refresh", token.refresh);
          await app.setSecret("openai.mode", "codex");
          if (token.accountId) await app.setSecret("openai.account", token.accountId);
          exchanged = true;
          break;
        }
        setStatus("Waiting for approval in the browser…");
        await sleep(wait * 1000, controller.signal);
      }
      if (!exchanged) throw new Error("Sign-in timed out.");
      await finish("ChatGPT");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setBusy(null);
    }
  };

  const beginClaude = () => {
    const login = anthropicLogin();
    setClaude(login);
    setUrl(login.url);
    setPaste("");
    setBusy("anthropic");
    setStatus("Open Claude, approve access, then paste the code#state value.");
    void Linking.openURL(login.url);
  };

  const submitClaude = async () => {
    if (!claude) return;
    setStatus("Exchanging the Claude code…");
    try {
      const parsed = parseAnthropicCode(paste, claude.state);
      const token = await exchangeAnthropicCode({ code: parsed.code, verifier: claude.verifier, state: parsed.state });
      await app.setSecret("anthropic", token.access);
      await app.setSecret("anthropic.refresh", token.refresh);
      await app.setSecret("anthropic.mode", "oauth");
      setClaude(null);
      await finish("Claude");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const row = (label: string, detail: string, on: boolean) => (
    <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 12 }}>
      {label}: <Text style={{ color: on ? theme.green : theme.muted }}>{on ? "connected" : "not connected"}</Text>
      {detail ? ` · ${detail}` : ""}
    </Text>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 40, gap: 14 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 18 }}>Connect</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: theme.accent, fontFamily: mono }}>close</Text>
        </Pressable>
      </View>
      <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 13, lineHeight: 20 }}>
        Free OpenCode Zen models are already available. No API key. These are the same sign-in options as OpenCode desktop: Console, GitHub Copilot, ChatGPT, and Claude.
      </Text>
      {row("OpenCode Zen", "free models need nothing", true)}
      {row("OpenCode Console", "", hasRealCredential(app.secrets.opencode) && app.secrets["opencode.mode"] === "console")}
      {row("GitHub Copilot", "", hasRealCredential(app.secrets["github-copilot"]))}
      {row("ChatGPT", app.secrets["openai.mode"] === "codex" ? "Codex" : "", app.secrets["openai.mode"] === "codex")}
      {row("Claude", app.secrets["anthropic.mode"] === "oauth" ? "Pro/Max" : "", app.secrets["anthropic.mode"] === "oauth")}

      <Action label="Login with OpenCode Console" disabled={busy !== null} onPress={() => void connectConsole()} />
      <TextInput
        value={enterprise}
        onChangeText={setEnterprise}
        placeholder="GitHub Enterprise domain, optional"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ color: theme.fg, fontFamily: mono, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 10 }}
      />
      <Action label="Login with GitHub Copilot" disabled={busy !== null} onPress={() => void connectCopilot()} />
      <Action label="Login with ChatGPT" disabled={busy !== null} onPress={() => void connectOpenAI()} />
      <Action label="Login with Claude" disabled={busy !== null} onPress={beginClaude} />

      {userCode ? (
        <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 14, gap: 8, backgroundColor: theme.bgElev }}>
          <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 12 }}>Device code</Text>
          <Text selectable style={{ color: theme.fg, fontFamily: mono, fontSize: 28, letterSpacing: 2 }}>
            {userCode}
          </Text>
          <Pressable onPress={open}>
            <Text style={{ color: theme.accent, fontFamily: mono }}>Open browser</Text>
          </Pressable>
        </View>
      ) : null}

      {claude ? (
        <View style={{ gap: 8 }}>
          <TextInput
            value={paste}
            onChangeText={setPaste}
            placeholder="Paste code#state"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ color: theme.fg, fontFamily: mono, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 10 }}
          />
          <Action label="Submit Claude code" disabled={false} onPress={() => void submitClaude()} />
        </View>
      ) : null}

      {status ? <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 13, lineHeight: 20 }}>{status}</Text> : null}
      {busy ? (
        <Pressable onPress={stop}>
          <Text style={{ color: theme.red, fontFamily: mono }}>Cancel</Text>
        </Pressable>
      ) : null}
      <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 12, lineHeight: 18 }}>
        API keys are optional. Paste one in Settings only for a provider that has no login here, such as Groq, DeepSeek, or your own endpoint.
      </Text>
    </ScrollView>
  );
}

function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  const { theme } = useApp();
  return (
    <Pressable disabled={disabled} onPress={onPress} style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgElev, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, opacity: disabled ? 0.45 : 1 }}>
      <Text style={{ color: theme.fg, fontFamily: mono }}>{label}</Text>
    </Pressable>
  );
}
