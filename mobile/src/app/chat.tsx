/**
 * Chat screen bound to a stored conversation (FR7/FR8, M3-T2): takes a
 * conversation id as a route param, loads it from the M3-T1 store, and
 * renders its persisted messages (each assistant reply shows the model that
 * produced it). Sending goes through `sendInConversation`
 * (src/chat/conversationSession.ts), which persists the prompt and the
 * reply through the store -- once a send settles, the conversation is
 * reloaded from the store rather than merged into React state by hand, so
 * the store stays the single source of truth.
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
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getToken } from "@/api/secureStoreToken";
import { createAPIClient } from "@/api/expoFetchClient";
import { stopGeneration, UNAUTHORIZED_MESSAGE } from "@/chat/chatController";
import { sendInConversation } from "@/chat/conversationSession";
import {
  applyStreamEvent,
  initialStreamAccumulator,
} from "@/ui/streamReducer";
import { createConversationStore } from "@/store/conversationStore";
import type { Conversation } from "@/store/conversationStore";
import { asyncStoragePort } from "@/store/asyncStorage";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isLoadingConversation, setIsLoadingConversation] = useState(true);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [thinking, setThinking] = useState("");
  const [response, setResponse] = useState("");
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const router = useRouter();
  const clientRef = useRef(createAPIClient());
  const storeRef = useRef(createConversationStore(asyncStoragePort));

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

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading || !id) {
      return;
    }

    const prompt = inputText.trim();
    setInputText("");
    setIsLoading(true);
    setThinking("");
    setResponse("");
    setBlockedMessage(null);

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

      let accumulated = initialStreamAccumulator;
      let startedGenerationId: string | null = null;

      await sendInConversation(clientRef.current, storeRef.current, id, prompt, {
        onStart: (genId) => {
          startedGenerationId = genId;
          setGenerationId(genId);
        },
        onEvent: (event) => {
          if (event.type === "error") {
            // Persistence and reporting happen via onError below; nothing
            // further to accumulate for display.
            return;
          }
          if (event.type === "done") {
            return;
          }

          accumulated = applyStreamEvent(accumulated, event);
          setThinking(accumulated.thinking);
          setResponse(accumulated.content);
          if (event.type === "content") {
            scrollViewRef.current?.scrollToEnd({ animated: false });
          }
        },
        onBlocked: (message) => {
          setBlockedMessage(message);
        },
        onError: (error: Error) => {
          Alert.alert("Error", error.message);
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
      });
    } finally {
      setIsLoading(false);
      setGenerationId(null);
      setThinking("");
      setResponse("");
      // The store is the single source of truth for persisted messages:
      // reload it now that sendInConversation has settled (complete,
      // stopped, error, or blocked all persist through the store before
      // resolving).
      await loadConversation();
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
            <ScrollView
              ref={scrollViewRef}
              style={styles.messagesContainer}
              contentContainerStyle={styles.messagesContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              {messages.map((message) => (
                <View key={message.id} style={styles.messageGroup}>
                  {message.thinking && (
                    <View style={styles.thinkingContainer}>
                      <Text style={styles.thinkingLabel}>Thinking:</Text>
                      <Text style={styles.thinkingText}>{message.thinking}</Text>
                    </View>
                  )}
                  <View
                    style={[
                      styles.message,
                      message.role === "user"
                        ? styles.userMessage
                        : styles.assistantMessage,
                    ]}
                  >
                    <Text style={styles.messageText}>{message.content}</Text>
                  </View>
                  {message.role === "assistant" && message.model && (
                    <Text style={styles.modelLabel}>{message.model}</Text>
                  )}
                </View>
              ))}

              {thinking && (
                <View style={styles.thinkingContainer}>
                  <Text style={styles.thinkingLabel}>Thinking:</Text>
                  <Text style={styles.thinkingText}>{thinking}</Text>
                </View>
              )}

              {response && (
                <View style={styles.message}>
                  <Text style={styles.messageText}>{response}</Text>
                  {isLoading && <ActivityIndicator style={styles.loadingDots} />}
                </View>
              )}

              {isLoading && !response && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#007AFF" />
                  <Text style={styles.loadingText}>Loading response...</Text>
                </View>
              )}
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
  loadingDots: {
    marginTop: 8,
  },
  loadingText: {
    marginTop: 8,
    color: "#666",
    fontSize: 14,
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
