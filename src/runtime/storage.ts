import * as SecureStore from "expo-secure-store";
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

const STATE_KEY = "oc-state-v1";

export async function readState(): Promise<string | null> {
  if (Platform.OS === "web") {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(STATE_KEY);
  }
  const file = new File(Paths.document, "opencode-state.json");
  if (!file.exists) return null;
  return file.text();
}

export async function writeState(value: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof localStorage !== "undefined") localStorage.setItem(STATE_KEY, value);
    return;
  }
  const file = new File(Paths.document, "opencode-state.json");
  if (!file.exists) file.create();
  await file.write(value);
}

function secretKey(id: string): string {
  return `oc.k.${id.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export async function readSecret(id: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(`oc-secret:${id}`);
  }
  try {
    return await SecureStore.getItemAsync(secretKey(id));
  } catch {
    return null;
  }
}

export async function writeSecret(id: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof localStorage === "undefined") return;
    if (value) localStorage.setItem(`oc-secret:${id}`, value);
    else localStorage.removeItem(`oc-secret:${id}`);
    return;
  }
  const key = secretKey(id);
  if (!value) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Missing entries throw on some platforms.
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}
