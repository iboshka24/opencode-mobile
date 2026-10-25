import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { diffLines } from "../../core/difftext";
import { useApp } from "../../runtime/state";
import { mono } from "../../ui/theme";

export default function DiffScreen() {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const changes = app.active.changes;
  return (
    <View style={{ flex: 1, backgroundColor: app.theme.bg, paddingTop: insets.top + 8 }}>
      <Text style={{ color: app.theme.accent, fontFamily: mono, fontSize: 16, paddingHorizontal: 14 }}>diff</Text>
      <Text style={{ color: app.theme.muted, fontFamily: mono, fontSize: 11, paddingHorizontal: 14, marginBottom: 8 }}>
        {changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"} this session` : "Edits from the agent show up here. /undo reverts the last one."}
      </Text>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 16 }}>
        {changes.map((change, index) => {
          const lines = diffLines(change.before ?? "", change.after ?? "");
          return (
            <View key={`${change.path}-${index}`} style={{ borderWidth: 1, borderColor: app.theme.border, borderRadius: 12, overflow: "hidden" }}>
              <Text style={{ color: app.theme.fg, fontFamily: mono, backgroundColor: app.theme.bgElev, padding: 8 }}>
                {change.summary} {change.path}
              </Text>
              {lines.map((line, lineIndex) => (
                <Text
                  key={lineIndex}
                  style={{
                    fontFamily: mono,
                    fontSize: 12,
                    color: line.type === "+" ? app.theme.green : line.type === "-" ? app.theme.red : app.theme.muted,
                    backgroundColor: line.type === "+" ? "rgba(158,206,106,0.08)" : line.type === "-" ? "rgba(247,118,142,0.08)" : "transparent",
                    paddingHorizontal: 8,
                  }}
                >
                  {line.type}
                  {line.text || " "}
                </Text>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
