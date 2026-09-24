/**
 * Token management using Expo SecureStore
 */

import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "api_bearer_token";

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function tokenExists(): Promise<boolean> {
  const token = await getToken();
  return token !== null;
}
