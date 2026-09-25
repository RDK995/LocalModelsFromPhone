/**
 * Root layout for the app using Expo Router
 */

import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { getToken } from "@/api/secureStoreToken";

export default function RootLayout() {
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if token exists on app startup
    getToken().then((token) => {
      setHasToken(token !== null);
    });
  }, []);

  if (hasToken === null) {
    // Loading state
    return null;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: "#007AFF",
      }}
    >
      {hasToken ? (
        <>
          <Stack.Screen
            name="chat"
            options={{
              title: "Chat",
              // Chat renders its own in-screen header (title + Settings
              // link); showing the Stack header too doubled the header and
              // meant KeyboardAvoidingView's offset had to account for a
              // header it didn't own. Hiding it here keeps a single header
              // and lets chat.tsx use a keyboardVerticalOffset of 0 (see
              // M1-C9 / .harness/reviews/M1-cycle2.md finding B).
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="settings"
            options={{
              title: "Settings",
              headerShown: true,
            }}
          />
        </>
      ) : (
        <Stack.Screen
          name="setup"
          options={{
            title: "Setup",
            headerShown: true,
          }}
        />
      )}
    </Stack>
  );
}
