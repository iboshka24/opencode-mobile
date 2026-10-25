import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useApp } from "../../runtime/state";
import { mono } from "../../ui/theme";

const ICONS: Record<string, string> = {
  index: ">_",
  files: "~/",
  diff: "±",
  sessions: "#",
  settings: "*",
};

export default function TabLayout() {
  const { theme } = useApp();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: theme.bgAlt, borderTopColor: theme.border },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.muted,
        tabBarLabelStyle: { fontFamily: mono, fontSize: 11 },
        tabBarIcon: ({ color }) => (
          <Text style={{ color, fontFamily: mono, fontSize: 12 }}>{ICONS[route.name] ?? "•"}</Text>
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Chat" }} />
      <Tabs.Screen name="files" options={{ title: "Files" }} />
      <Tabs.Screen name="diff" options={{ title: "Diff" }} />
      <Tabs.Screen name="sessions" options={{ title: "Sessions" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
