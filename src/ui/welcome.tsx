import { useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { copilotProfile, loadConsoleAccount, pollConsoleLogin, pollCopilotLogin, sleep, startConsoleLogin, startCopilotLogin, type DevicePoll } from "../core/auth";
import { useApp } from "../runtime/state";
import { mono } from "./theme";

type Step = "choose" | "code";

export function Welcome() {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const theme = app.theme;
  const [step, setStep] = useState<Step>("choose");
  const [status, setStatus] = useState("");
  const [userCode, setUserCode] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStep("choose");
    setUserCode("");
  };

  const poll = async (interval: number, once: (signal: AbortSignal) => Promise<DevicePoll>) => {
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

  const signInOpenCode = async () => {
    setBusy(true);
    setStatus("Requesting a device code…");
    try {
      const device = await startConsoleLogin();
      setUserCode(device.userCode);
      setUrl(device.verificationUrl);
      setStep("code");
      setStatus("Enter this code on the OpenCode page. The browser should open.");
      void Linking.openURL(device.verificationUrl);
      const token = await poll(device.intervalSec, (signal) => pollConsoleLogin(device.deviceCode, fetch, signal));
      const account = await loadConsoleAccount(token.access, token.orgId);
      await app.saveConsoleLogin({
        access: token.access,
        refresh: token.refresh,
        orgId: account.orgId ?? token.orgId,
        email: account.email,
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  const signInCopilot = async () => {
    setBusy(true);
    setStatus("Requesting a GitHub device code…");
    try {
      const device = await startCopilotLogin(undefined);
      setUserCode(device.userCode);
      setUrl(device.verificationUrl);
      setStep("code");
      setStatus("Enter this code on GitHub.");
      void Linking.openURL(device.verificationUrl);
      const token = await poll(device.intervalSec, (signal) => pollCopilotLogin(device.deviceCode, undefined, fetch, signal));
      const profile = await copilotProfile(token.access, undefined);
      if (profile.error) throw new Error(profile.error);
      await app.saveCopilotLogin({ access: token.access, api: profile.apiEndpoint });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 30, backgroundColor: theme.bg, paddingTop: insets.top + 28, paddingHorizontal: 22, paddingBottom: insets.bottom + 24, gap: 16 }}>
      <Text style={{ color: theme.accent, fontFamily: mono, fontSize: 14 }}>opencode</Text>
      <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 28, lineHeight: 34 }}>Sign in for free models</Text>
      <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 14, lineHeight: 22 }}>
        Anonymous Zen shares one allowance across the whole network, so the first message on mobile data often fails. An OpenCode account gets its own free quota. No API key to paste.
      </Text>
      {step === "choose" ? (
        <View style={{ gap: 10, marginTop: 8 }}>
          <Pressable disabled={busy} onPress={() => void signInOpenCode()} style={{ backgroundColor: theme.accent, borderRadius: 14, paddingVertical: 14, alignItems: "center" }}>
            <Text style={{ color: theme.bg, fontFamily: mono, fontSize: 16 }}>Sign in with OpenCode</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={() => void signInCopilot()} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingVertical: 14, alignItems: "center" }}>
            <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 15 }}>Use GitHub Copilot</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={app.dismissWelcome} style={{ paddingVertical: 10, alignItems: "center" }}>
            <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 13 }}>Continue without an account</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 16, padding: 16, backgroundColor: theme.bgElev }}>
          <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 12 }}>Device code</Text>
          <Text selectable style={{ color: theme.fg, fontFamily: mono, fontSize: 32, letterSpacing: 2 }}>
            {userCode}
          </Text>
          <Pressable onPress={() => void Linking.openURL(url)}>
            <Text style={{ color: theme.accent, fontFamily: mono }}>Open browser</Text>
          </Pressable>
          <Pressable onPress={cancel}>
            <Text style={{ color: theme.red, fontFamily: mono }}>Cancel</Text>
          </Pressable>
        </View>
      )}
      {status ? <Text style={{ color: theme.fg, fontFamily: mono, fontSize: 13, lineHeight: 20 }}>{status}</Text> : null}
    </View>
  );
}
