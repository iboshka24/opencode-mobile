import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider, useApp } from "../runtime/state";
import { mono } from "../ui/theme";

function Shell() {
  const app = useApp();
  const router = useRouter();
  useEffect(() => {
    if (app.routeRequest) {
      router.push(app.routeRequest as "/models");
      app.clearRoute();
    }
  }, [app, router]);

  if (!app.ready) {
    return (
      <View style={{ flex: 1, backgroundColor: "#1a1b26", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Text style={{ color: "#7aa2f7", fontFamily: mono, fontSize: 22 }}>opencode</Text>
        <ActivityIndicator color="#7aa2f7" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: app.theme.bgAlt, alignItems: "center" }}>
      <StatusBar style="light" />
      <View style={{ flex: 1, width: "100%", maxWidth: 520, backgroundColor: app.theme.bg }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: app.theme.bg } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="models" options={{ presentation: "modal" }} />
          <Stack.Screen name="connect" options={{ presentation: "modal" }} />
        </Stack>
        {app.permission ? (
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end", padding: 16 }}>
            <View style={{ backgroundColor: app.theme.bgElev, borderRadius: 16, borderWidth: 1, borderColor: app.theme.border, padding: 16, gap: 10 }}>
              <Text style={{ color: app.theme.yellow, fontFamily: mono, fontSize: 12 }}>permission · {app.permission.action}</Text>
              <Text style={{ color: app.theme.fg, fontFamily: mono, fontSize: 14 }}>{app.permission.detail}</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <PermButton label="Deny" color={app.theme.red} onPress={() => app.answerPermission("deny")} />
                <PermButton label="Allow" color={app.theme.green} onPress={() => app.answerPermission("allow")} />
                <PermButton label="Always" color={app.theme.accent} onPress={() => app.answerPermission("always")} />
              </View>
            </View>
          </View>
        ) : null}
        {app.question ? <QuestionCard /> : null}
      </View>
    </View>
  );
}

function PermButton({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, borderWidth: 1, borderColor: color, borderRadius: 10, paddingVertical: 10, alignItems: "center" }}>
      <Text style={{ color, fontFamily: mono, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function QuestionCard() {
  const app = useApp();
  const [value, setValue] = useState("");
  if (!app.question) return null;
  return (
    <View style={{ position: "absolute", left: 16, right: 16, bottom: 24, backgroundColor: app.theme.bgElev, borderRadius: 16, borderWidth: 1, borderColor: app.theme.border, padding: 16, gap: 8 }}>
      <Text style={{ color: app.theme.accent, fontFamily: mono, fontSize: 12 }}>question</Text>
      <Text style={{ color: app.theme.fg, fontFamily: mono, fontSize: 14 }}>{app.question.question}</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="Answer"
        placeholderTextColor={app.theme.muted}
        style={{ color: app.theme.fg, fontFamily: mono, borderWidth: 1, borderColor: app.theme.border, borderRadius: 8, padding: 8 }}
      />
      <Pressable onPress={() => app.answerQuestion(value)} style={{ alignSelf: "flex-end" }}>
        <Text style={{ color: app.theme.accent, fontFamily: mono }}>Send</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}
