/**
 * Root layout for the app using Expo Router
 */

import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: "#007AFF",
      }}
    >
      {/*
        Each screen is a direct child of <Stack>, never wrapped in a
        Fragment: expo-router's Stack maps its children with
        React.Children.toArray, which does not flatten Fragments, and its
        "Unknown child element" warning interpolates the Fragment's Symbol
        type into a string, throwing "Cannot convert Symbol to string" on
        every launch with a stored token (M1-C11).

        All three screens are declared unconditionally (M1-C12): RootLayout
        used to read the stored token once at launch and gate these on
        whether one was found, but which screen the user lands on is already
        decided by app/index.tsx's Redirect and by each screen's own
        `router.replace` call. Gating screen *declarations* on a token read
        that happens once at launch meant that after setup.tsx saved a token
        and called `router.replace("/chat")`, "chat"/"settings" were still
        undeclared (that one-time read was still stale from launch) and
        their options -- chat's `headerShown: false` below, both titles --
        never applied: Chat and Settings got a second, default Stack header
        on top of their own (.harness/reviews/M1-cycle2.md finding B, fix
        cycle 4). The same screen must always be declared with the same
        options regardless of how the app got there.
      */}
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
      <Stack.Screen
        name="setup"
        options={{
          title: "Setup",
          headerShown: true,
        }}
      />
    </Stack>
  );
}
