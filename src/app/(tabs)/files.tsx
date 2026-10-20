import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DirEntry } from "../../core/workspace";
import { useApp } from "../../runtime/state";
import { mono } from "../../ui/theme";

export default function FilesScreen() {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [path, setPath] = useState("");
  const [file, setFile] = useState<{ path: string; text: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    app.listPath(path).then(
      (list) => {
        if (!cancelled) setEntries(list.filter((entry) => entry.name !== ".git"));
      },
      (caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [app, app.filesVersion, path]);

  const open = async (entry: DirEntry) => {
    const next = path ? `${path}/${entry.name}` : entry.name;
    if (entry.kind === "dir") {
      setPath(next);
      setFile(null);
      return;
    }
    try {
      const text = await app.readFile(next);
      setFile({ path: next, text });
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: app.theme.bg, paddingTop: insets.top + 8 }}>
      <Text style={{ color: app.theme.accent, fontFamily: mono, fontSize: 16, paddingHorizontal: 14 }}>files</Text>
      <Text style={{ color: app.theme.muted, fontFamily: mono, fontSize: 11, paddingHorizontal: 14, marginBottom: 8 }}>
        {app.workspaceLabel}/{path}
      </Text>
      <View style={{ flexDirection: "row", paddingHorizontal: 14, marginBottom: 8 }}>
        <Pressable
          onPress={() => {
            const parent = path.split("/").slice(0, -1).join("/");
            setPath(parent);
            setFile(null);
          }}
          disabled={!path}
        >
          <Text style={{ color: path ? app.theme.accent : app.theme.muted, fontFamily: mono }}>..</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24, gap: 4 }}>
        {entries.map((entry) => (
          <Pressable key={entry.name} onPress={() => void open(entry)} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: app.theme.border }}>
            <Text style={{ color: entry.kind === "dir" ? app.theme.accent : app.theme.fg, fontFamily: mono }}>
              {entry.kind === "dir" ? `${entry.name}/` : entry.name}
            </Text>
          </Pressable>
        ))}
        {error ? <Text style={{ color: app.theme.red, fontFamily: mono }}>{error}</Text> : null}
        {file ? (
          <View style={{ marginTop: 12, gap: 6 }}>
            <Text style={{ color: app.theme.yellow, fontFamily: mono, fontSize: 12 }}>{file.path}</Text>
            <Text style={{ color: app.theme.fg, fontFamily: mono, fontSize: 12, lineHeight: 18 }}>
              {file.text.split("\n").slice(0, 400).map((line, index) => `${index + 1}: ${line}`).join("\n")}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
