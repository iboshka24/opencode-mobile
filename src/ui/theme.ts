import { Platform } from "react-native";
import type { Theme } from "../core/themes";

export const mono = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
}) as string;

export function card(theme: Theme) {
  return {
    backgroundColor: theme.bgElev,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
  };
}
