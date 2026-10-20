import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatCost } from "../../core/cost";
import { useApp } from "../../runtime/state";
import { mono } from "../../ui/theme";

export default function SessionsScreen() {
  const app = useApp();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: app.theme.bg, paddingTop: insets.top + 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, marginBottom: 8 }}>
        <Text style={{ color: app.theme.accent, fontFamily: mono, fontSize: 16 }}>sessions</Text>
        <Pressable onPress={app.newSession}>
          <Text style={{ color: app.theme.green, fontFamily: mono }}>/new</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, gap: 8, paddingBottom: 24 }}>
        {app.sessions.map((session) => {
          const active = session.id === app.active.id;
          return (
            <Pressable
              key={session.id}
              onPress={() => app.openSession(session.id)}
              style={{ borderWidth: 1, borderColor: active ? app.theme.accent : app.theme.border, borderRadius: 12, padding: 12, gap: 4, backgroundColor: app.theme.bgElev }}
            >
              <Text style={{ color: app.theme.fg, fontFamily: mono }}>{session.title}</Text>
              <Text style={{ color: app.theme.muted, fontFamily: mono, fontSize: 11 }}>
                {session.mode} · {session.providerID}/{session.modelID} · {formatCost(session.cost)} · {session.messages.length} msgs
              </Text>
              {app.sessions.length > 1 ? (
                <Pressable onPress={() => app.deleteSession(session.id)}>
                  <Text style={{ color: app.theme.red, fontFamily: mono, fontSize: 11 }}>delete</Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
