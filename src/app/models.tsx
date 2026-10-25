import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isFree } from "../core/catalog";
import { formatCost } from "../core/cost";
import { isZenProvider, modelKey, modelVisible, PUBLIC_ZEN_KEY, resolveApiKey } from "../core/identity";
import { useApp } from "../runtime/state";
import { mono } from "../ui/theme";

export default function ModelsScreen() {
  const app = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [toolsOnly, setToolsOnly] = useState(true);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rank = (model: (typeof app.models)[number]) => (model.providerID === "opencode" || model.providerID === "opencode-go" ? 0 : isFree(model) ? 1 : 2);
    return app.models
      .filter((model) => modelVisible(model, app.secrets))
      .filter((model) => (freeOnly ? isFree(model) : true))
      .filter((model) => (toolsOnly ? model.toolCall : true))
      .filter((model) => !needle || `${model.providerID} ${model.providerName} ${model.id} ${model.name}`.toLowerCase().includes(needle))
      .sort((a, b) => rank(a) - rank(b) || a.providerID.localeCompare(b.providerID) || a.name.localeCompare(b.name))
      .slice(0, 120);
  }, [app.models, app.secrets, app.blockedModels, query, freeOnly, toolsOnly]);

  return (
    <View style={{ flex: 1, backgroundColor: app.theme.bg, paddingTop: insets.top + 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14 }}>
        <Text style={{ color: app.theme.accent, fontFamily: mono, fontSize: 16 }}>models</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: app.theme.fg, fontFamily: mono }}>close</Text>
        </Pressable>
      </View>
      <Text style={{ color: app.theme.muted, fontFamily: mono, fontSize: 11, paddingHorizontal: 14, marginVertical: 6 }}>
        {app.models.length} from {app.catalogStatus === "live" ? "models.dev" : "the bundled snapshot"} · showing {filtered.length}
      </Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="search provider or model"
        placeholderTextColor={app.theme.muted}
        autoCapitalize="none"
        style={{ marginHorizontal: 14, color: app.theme.fg, fontFamily: mono, borderWidth: 1, borderColor: app.theme.border, borderRadius: 10, padding: 10 }}
      />
      <View style={{ flexDirection: "row", gap: 8, padding: 14 }}>
        <Pressable onPress={() => setFreeOnly((value) => !value)}>
          <Text style={{ color: freeOnly ? app.theme.green : app.theme.muted, fontFamily: mono }}>free</Text>
        </Pressable>
        <Pressable onPress={() => setToolsOnly((value) => !value)}>
          <Text style={{ color: toolsOnly ? app.theme.accent : app.theme.muted, fontFamily: mono }}>tools</Text>
        </Pressable>
        <Pressable onPress={() => void app.refreshCatalog()}>
          <Text style={{ color: app.theme.yellow, fontFamily: mono }}>refresh</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 32, gap: 6 }}>
        {filtered.map((model) => {
          const blocked = app.blockedModels.includes(modelKey(model));
          const selected = app.model?.providerID === model.providerID && app.model.id === model.id;
          const price = model.cost ? `${formatCost(model.cost.input ?? 0)}/${formatCost(model.cost.output ?? 0)} per 1M` : "price n/a";
          return (
            <Pressable
              key={`${model.providerID}/${model.id}`}
              onPress={() => {
                if (blocked) return;
                app.setModel(model.providerID, model.id);
                router.back();
              }}
              style={{ borderWidth: 1, borderColor: selected ? app.theme.accent : app.theme.border, borderRadius: 10, padding: 10, backgroundColor: app.theme.bgElev, opacity: blocked ? 0.45 : 1 }}
            >
              <Text style={{ color: app.theme.fg, fontFamily: mono }}>{model.name}</Text>
              <Text style={{ color: app.theme.muted, fontFamily: mono, fontSize: 11 }}>
                {model.providerID}/{model.id}
                {isFree(model) ? " · free" : ""}
                {isZenProvider(model.providerID) && resolveApiKey(model, app.secrets[model.providerID]) === PUBLIC_ZEN_KEY ? " · shared network" : ""}
                {blocked ? " · unavailable in your country" : ""}
                {model.reasoning ? " · reasoning" : ""}
                {model.toolCall ? " · tools" : ""}
              </Text>
              <Text style={{ color: app.theme.muted, fontFamily: mono, fontSize: 11 }}>
                {price}
                {model.context ? ` · ${(model.context / 1000).toFixed(0)}k ctx` : ""}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
