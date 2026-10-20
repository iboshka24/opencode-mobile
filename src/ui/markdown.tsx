import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { Theme } from "../core/themes";
import { mono } from "./theme";

const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "export", "import", "from", "if", "else", "for", "while",
  "class", "async", "await", "type", "interface", "new", "true", "false", "null", "undefined", "def", "fn",
]);

function highlight(code: string, theme: Theme) {
  const parts = code.split(/(\/\/.*|\/\*[\s\S]*?\*\/|"[^"\n]*"|'[^'\n]*'|`[^`]*`|\b[A-Za-z_][A-Za-z0-9_]*\b)/g);
  return parts.map((part, index) => {
    let color = theme.fg;
    if (part.startsWith("//") || part.startsWith("/*")) color = theme.muted;
    else if (part.startsWith('"') || part.startsWith("'") || part.startsWith("`")) color = theme.green;
    else if (KEYWORDS.has(part)) color = theme.accent;
    return (
      <Text key={index} style={{ color }}>
        {part}
      </Text>
    );
  });
}

function inline(text: string, theme: Theme) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <Text key={index} style={{ fontFamily: mono, color: theme.yellow, backgroundColor: theme.bgAlt }}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <Text key={index} style={{ fontWeight: "700" }}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      return (
        <Text key={index} style={{ color: theme.accent }}>
          {link[1]}
        </Text>
      );
    }
    return <Text key={index}>{part}</Text>;
  });
}

export function Markdown({ text, theme }: { text: string; theme: Theme }) {
  const chunks = text.split(/```/);
  return (
    <View style={{ gap: 8 }}>
      {chunks.map((chunk, index) => {
        if (index % 2 === 1) {
          const newline = chunk.indexOf("\n");
          const code = newline === -1 ? chunk : chunk.slice(newline + 1);
          return (
            <ScrollView key={index} horizontal style={{ backgroundColor: theme.bgAlt, borderRadius: 10, borderWidth: 1, borderColor: theme.border }}>
              <Text style={{ fontFamily: mono, color: theme.fg, fontSize: 12, lineHeight: 18, padding: 10 }}>
                {highlight(code.replace(/\n$/, ""), theme)}
              </Text>
            </ScrollView>
          );
        }
        return chunk.split("\n").map((line, lineIndex) => {
          if (!line.trim()) return <View key={`${index}-${lineIndex}`} style={{ height: 6 }} />;
          const heading = /^(#{1,3})\s+(.*)$/.exec(line);
          if (heading) {
            return (
              <Text key={`${index}-${lineIndex}`} style={{ color: theme.fg, fontFamily: mono, fontSize: heading[1]!.length === 1 ? 18 : 15, fontWeight: "700" }}>
                {heading[2]}
              </Text>
            );
          }
          const bullet = /^[-*]\s+(.*)$/.exec(line);
          return (
            <Text key={`${index}-${lineIndex}`} style={{ color: theme.fg, fontFamily: mono, fontSize: 14, lineHeight: 21 }}>
              {bullet ? `• ${""}` : ""}
              {inline(bullet ? bullet[1]! : line, theme)}
            </Text>
          );
        });
      })}
    </View>
  );
}

export function Collapsible({ title, theme, children }: { title: string; theme: Theme; children: string }) {
  const [open, setOpen] = useState(false);
  if (!children.trim()) return null;
  return (
    <Pressable onPress={() => setOpen((value) => !value)} style={{ marginBottom: 8 }}>
      <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 12 }}>
        {open ? "▾" : "▸"} {title}
      </Text>
      {open ? (
        <Text style={{ color: theme.muted, fontFamily: mono, fontSize: 12, lineHeight: 18, marginTop: 4 }}>{children}</Text>
      ) : null}
    </Pressable>
  );
}
