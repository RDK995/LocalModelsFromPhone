/**
 * Chat screen bound to a stored conversation (FR7/FR8, M3-T2): takes a
 * conversation id as a route param, loads it from the M3-T1 store, and
 * renders its persisted messages (each assistant reply shows the model that
 * produced it). Sending goes through `sendInConversation`
 * (src/chat/conversationSession.ts), which persists the prompt and the
 * reply through the store.
 *
 * FR9/FR10 (M4a-T3): the prompt appears the instant Send is pressed and the
 * in-flight reply streams into its own place in the message list, rather
 * than the list only refreshing once the send settles. This is done by
 * minting the prompt/reply's ids up front (`newMessageId`) and holding them,
 * with the streamed-so-far text, in `pending` -- a `PendingTurn` merged with
 * the store's persisted messages by `buildChatItems` (src/ui/chatItems.ts)
 * into the single list rendered below. Once the send settles, the
 * conversation is reloaded from the store *before* `pending` is cleared, so
 * there is never a render where the turn is missing; `buildChatItems` dedupes
 * by id so the pending item is simply replaced in place by the persisted one.
 * Each reply's thinking text is collapsed by default behind a "Show
 * thinking" toggle (`thinkingToggleLabel`/`toggleExpanded`), tracked per
 * message id in `expandedKeys`.
 *
 * The header keeps its own static "Chat" title (not the conversation's
 * title): this is a judgment call (M3-T2's packet leaves it open), kept to
 * minimize churn in the runtime-smoke text assertions that already look for
 * "Chat".
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Linking,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { MarkdownText } from "@/ui/MarkdownText";
import { SourceList } from "@/ui/SourceList";
import { getToken } from "@/api/secureStoreToken";
import { createAPIClient } from "@/api/expoFetchClient";
import { stopGeneration, UNAUTHORIZED_MESSAGE } from "@/chat/chatController";
import { sendInConversation, newMessageId } from "@/chat/conversationSession";
import { describeError } from "@/api/errorMessages";
import {
  applyStreamEvent,
  initialStreamAccumulator,
} from "@/ui/streamReducer";
import {
  buildChatItems,
  thinkingToggleLabel,
  toggleExpanded,
  stepLabel,
  stepsToggleLabel,
} from "@/ui/chatItems";
import type { PendingTurn } from "@/ui/chatItems";
import { webSwitchDisplayValue, webSwitchState } from "@/ui/webSwitch";
import type { WebSwitchState } from "@/ui/webSwitch";
import { createConversationStore } from "@/store/conversationStore";
import type { Conversation } from "@/store/conversationStore";
import { asyncStoragePort } from "@/store/asyncStorage";
import { createIconCache } from "@/store/iconCache";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isLoadingConversation, setIsLoadingConversation] = useState(true);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  // null until the first capability check settles (switch disabled, no text).
  const [webState, setWebState] = useState<WebSwitchState | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const router = useRouter();
  const clientRef = useRef(createAPIClient());
  const storeRef = useRef(createConversationStore(asyncStoragePort));
  // Site logos come from the Mac only. The token is set here too, so a logo
  // requested before the mount effect has run does not get a 401.
  const iconCacheRef = useRef(
    createIconCache(asyncStoragePort, async (host) => {
      const token = await getToken();
      if (!token) return null;
      clientRef.current.setToken(token);
      return clientRef.current.siteIcon(host);
    }),
  );

  const loadConversation = useCallback(async () => {
    if (!id) {
      return;
    }
    const found = await storeRef.current.get(id);
    setConversation(found);
    setIsLoadingConversation(false);
  }, [id]);

  // Initialize client with token on mount
  useEffect(() => {
    const initializeClient = async () => {
      try {
        const token = await getToken();
        if (!token) {
          // Token missing, go back to setup
          router.replace("/setup");
          return;
        }
        clientRef.current.setToken(token);
      } catch {
        Alert.alert("Error", "Failed to load token");
        router.replace("/setup");
      }
    };

    initializeClient();
  }, [router]);

  // Capability gate for the web switch (FR18): fetch the state and decide
  // whether the resident model has tools. Failures disable the switch
  // quietly (no Alert) so the rest of the screen keeps working.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const refresh = async () => {
        try {
          const token = await getToken();
          if (!token) {
            return;
          }
          clientRef.current.setToken(token);
          const state = await clientRef.current.getState();
          if (!cancelled) {
            setWebState(webSwitchState(state.models, state.resident));
          }
        } catch {
          if (!cancelled) {
            setWebState(webSwitchState(null, null));
          }
        }
      };
      void refresh();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const handleWebSwitch = async (value: boolean) => {
    if (!id) {
      return;
    }
    try {
      const updated = await storeRef.current.setWebSearch(id, value);
      setConversation(updated);
    } catch (error) {
      console.error("Failed to update web search switch:", error);
    }
  };

  const handleOpenSource = (url: string) => {
    Linking.openURL(url).catch((error) => {
      console.error("Failed to open source:", error);
    });
  };

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading || !id) {
      return;
    }

    const prompt = inputText.trim();
    const userMessageId = newMessageId();
    const assistantMessageId = newMessageId();
    setInputText("");
    setIsLoading(true);
    setBlockedMessage(null);
    // Set synchronously, before the token re-read below awaits, so the
    // prompt appears in the list on this render rather than after the send
    // settles (FR9/FR10).
    setPending({
      userMessageId,
      prompt,
      assistantMessageId,
      accumulator: initialStreamAccumulator,
      blocked: false,
    });

    try {
      // Re-read the token before every request so a token pasted in
      // Settings takes effect on the very next chat request, even if
      // this screen was already mounted when the token was updated.
      const token = await getToken();
      if (!token) {
        router.replace("/setup");
        return;
      }
      clientRef.current.setToken(token);

      let startedGenerationId: string | null = null;

      await sendInConversation(
        clientRef.current,
        storeRef.current,
        id,
        prompt,
        {
          onStart: (genId) => {
            startedGenerationId = genId;
            setGenerationId(genId);
          },
          onEvent: (event) => {
            setPending((prev) =>
              prev
                ? { ...prev, accumulator: applyStreamEvent(prev.accumulator, event) }
                : prev
            );
            if (event.type === "content") {
              scrollViewRef.current?.scrollToEnd({ animated: false });
            }
          },
          onBlocked: (message) => {
            setPending((prev) => (prev ? { ...prev, blocked: true } : prev));
            setBlockedMessage(message);
          },
          onError: (error: Error) => {
            Alert.alert("Error", describeError(error));
          },
          onUnauthorized: () => {
            Alert.alert(
              UNAUTHORIZED_MESSAGE,
              "The password on this phone no longer matches the Mac. Paste the current one from the Mac (pbcopy < ~/.phone-models/token)."
            );
            router.push({
              pathname: "/settings",
              params: { updateToken: "1" },
            });
          },
          onComplete: () => {
            void startedGenerationId;
          },
        },
        { userMessageId, assistantMessageId }
      );
    } finally {
      // The store is the single source of truth for persisted messages:
      // reload it now that sendInConversation has settled (complete,
      // stopped, error, or blocked all persist through the store before
      // resolving), then clear the pending turn -- in that order, so there
      // is never a render where the turn is missing from the list.
      await loadConversation();
      setPending(null);
      setIsLoading(false);
      setGenerationId(null);
    }
  };

  const handleStop = async () => {
    if (!generationId || !isLoading) {
      return;
    }

    try {
      // Notify the server of cancellation. Deliberately does not abort the
      // fetch: the stream keeps being read until the server's terminal
      // `done {status:"cancelled"}` event ends it, and only then does the
      // `finally` in handleSendMessage clear isLoading/generationId.
      await stopGeneration(clientRef.current, generationId);
    } catch (error) {
      console.error("Failed to cancel:", error);
    }
  };

  const messages = conversation?.messages ?? [];
  const chatItems = buildChatItems(messages, pending);

  return (
    <SafeAreaView style={styles.container}>
      {/*
        The Stack header for the "chat" route is hidden (see _layout.tsx):
        chat renders its own header below, so there is nothing else above
        this KeyboardAvoidingView and keyboardVerticalOffset can stay at 0.
      */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Chat</Text>
          <View style={styles.headerLinks}>
            <TouchableOpacity onPress={() => router.push("/conversations")}>
              <Text style={styles.settingsButton}>Conversations</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push("/models")}>
              <Text style={styles.settingsButton}>Models</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push("/settings")}>
              <Text style={styles.settingsButton}>Settings</Text>
            </TouchableOpacity>
          </View>
        </View>

        {isLoadingConversation ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
          </View>
        ) : (
          <>
            <View style={styles.webSwitchContainer}>
              <View style={styles.webSwitchRow}>
                <Text style={styles.webSwitchLabel}>Web search</Text>
                <Switch
                  value={webSwitchDisplayValue(conversation?.web_search, webState)}
                  onValueChange={(value) => void handleWebSwitch(value)}
                  disabled={!webState?.enabled}
                />
              </View>
              {webState && !webState.enabled && webState.explanation && (
                <Text style={styles.webSwitchExplanation}>
                  {webState.explanation}
                </Text>
              )}
            </View>

            <ScrollView
              ref={scrollViewRef}
              style={styles.messagesContainer}
              contentContainerStyle={styles.messagesContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              {chatItems.map((item) => (
                <View key={item.key} style={styles.messageGroup}>
                  {item.thinking && (
                    <View style={styles.thinkingToggleRow}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        onPress={() =>
                          setExpandedKeys((prev) => toggleExpanded(prev, item.key))
                        }
                      >
                        <Text style={styles.thinkingToggleText}>
                          {thinkingToggleLabel(expandedKeys.has(item.key))}
                        </Text>
                      </TouchableOpacity>
                      {expandedKeys.has(item.key) && (
                        <View style={styles.thinkingContainer}>
                          <Text style={styles.thinkingLabel}>Thinking:</Text>
                          <Text style={styles.thinkingText}>{item.thinking}</Text>
                        </View>
                      )}
                    </View>
                  )}
                  {item.steps && (
                    <View style={styles.stepsContainer}>
                      {item.streaming ? (
                        item.steps.map((step, index) => (
                          <Text key={index} style={styles.stepText}>
                            {stepLabel(step)}
                          </Text>
                        ))
                      ) : (
                        <>
                          <TouchableOpacity
                            accessibilityRole="button"
                            onPress={() =>
                              setExpandedKeys((prev) =>
                                toggleExpanded(prev, `${item.key}:steps`)
                              )
                            }
                          >
                            <Text style={styles.thinkingToggleText}>
                              {stepsToggleLabel(
                                expandedKeys.has(`${item.key}:steps`),
                                item.steps.length
                              )}
                            </Text>
                          </TouchableOpacity>
                          {expandedKeys.has(`${item.key}:steps`) &&
                            item.steps.map((step, index) => (
                              <Text key={index} style={styles.stepText}>
                                {stepLabel(step)}
                              </Text>
                            ))}
                        </>
                      )}
                    </View>
                  )}
                  <View
                    style={[
                      styles.message,
                      item.role === "user"
                        ? styles.userMessage
                        : styles.assistantMessage,
                    ]}
                  >
                    {item.content.length > 0 &&
                      (item.role === "assistant" ? (
                        <MarkdownText
                          text={item.content}
                          style={styles.messageText}
                          sources={item.sources}
                          iconCache={iconCacheRef.current}
                          onOpenSource={handleOpenSource}
                        />
                      ) : (
                        <Text style={styles.messageText}>{item.content}</Text>
                      ))}
                    {item.streaming && (
                      <ActivityIndicator style={styles.loadingDots} />
                    )}
                    {item.sources && (
                      <SourceList
                        sources={item.sources}
                        iconCache={iconCacheRef.current}
                        onOpenSource={handleOpenSource}
                      />
                    )}
                  </View>
                  {item.role === "assistant" && item.model && (
                    <Text style={styles.modelLabel}>{item.model}</Text>
                  )}
                </View>
              ))}
            </ScrollView>

            {blockedMessage && (
              <View style={styles.blockedContainer}>
                <Text style={styles.blockedText}>{blockedMessage}</Text>
                <TouchableOpacity
                  style={styles.loadModelButton}
                  onPress={() => router.push("/models")}
                >
                  <Text style={styles.loadModelButtonText}>Load a model</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.inputContainer}>
              <TextInput
                style={[styles.input, isLoading && styles.inputDisabled]}
                placeholder="Type a message..."
                value={inputText}
                onChangeText={setInputText}
                editable={!isLoading}
                placeholderTextColor="#999"
              />
              {isLoading ? (
                <TouchableOpacity
                  style={[styles.button, styles.stopButton]}
                  onPress={handleStop}
                >
                  <Text style={styles.buttonText}>Stop</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.button,
                    !inputText.trim() && styles.buttonDisabled,
                  ]}
                  onPress={handleSendMessage}
                  disabled={!inputText.trim()}
                >
                  <Text style={styles.buttonText}>Send</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#000",
  },
  headerLinks: {
    flexDirection: "row",
    gap: 16,
  },
  settingsButton: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "500",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
  },
  messageGroup: {
    marginBottom: 16,
  },
  message: {
    marginBottom: 8,
    padding: 12,
    borderRadius: 8,
    maxWidth: "85%",
  },
  userMessage: {
    alignSelf: "flex-end",
    backgroundColor: "#007AFF",
  },
  assistantMessage: {
    alignSelf: "flex-start",
    backgroundColor: "#f0f0f0",
  },
  messageText: {
    fontSize: 14,
    color: "#000",
  },
  modelLabel: {
    fontSize: 11,
    color: "#999",
    marginTop: 2,
    marginLeft: 4,
  },
  thinkingToggleRow: {
    marginBottom: 4,
  },
  thinkingToggleText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#007AFF",
  },
  thinkingContainer: {
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fff9e6",
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#ffa500",
  },
  thinkingLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#ff6b00",
  },
  thinkingText: {
    fontSize: 13,
    color: "#333",
    marginTop: 4,
    fontStyle: "italic",
  },
  webSwitchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  webSwitchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  webSwitchLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#000",
  },
  webSwitchExplanation: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
  },
  stepsContainer: {
    marginBottom: 4,
  },
  stepText: {
    fontSize: 12,
    color: "#888",
    fontStyle: "italic",
    marginTop: 2,
  },
  loadingDots: {
    marginTop: 8,
  },
  blockedContainer: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#ffe6e6",
    borderTopWidth: 1,
    borderTopColor: "#eee",
    alignItems: "center",
    gap: 8,
  },
  blockedText: {
    color: "#ff3b30",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
  loadModelButton: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  loadModelButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 13,
  },
  inputContainer: {
    flexDirection: "row",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f5f5f5",
    fontSize: 14,
    color: "#000",
  },
  inputDisabled: {
    opacity: 0.6,
  },
  button: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    paddingHorizontal: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  stopButton: {
    backgroundColor: "#ff3b30",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
});
