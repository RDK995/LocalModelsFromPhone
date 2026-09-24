/**
 * Root layout for the app using Expo Router
 */

import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { getToken } from "@/api/token";

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
              headerShown: true,
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
