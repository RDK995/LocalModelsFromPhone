/**
 * Main chat screen with streaming response
 */

import React, { useState, useEffect, useRef } from "react";
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
} from "react-native";
import { useRouter } from "expo-router";
import { getToken } from "@/api/token";
import { createAPIClient } from "@/api/client";
import type { StreamEvent } from "@/api/client";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [thinking, setThinking] = useState("");
  const [response, setResponse] = useState("");
  const [generationId, setGenerationId] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const clientRef = useRef(createAPIClient("http://localhost:7789"));

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

  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading) {
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputText.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);
    setThinking("");
    setResponse("");

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

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

      const chatRequest = {
        model: "default",
        messages: messages
          .concat(userMessage)
          .map((m) => ({
            role: m.role,
            content: m.content,
          })),
      };

      let currentThinking = "";
      let currentContent = "";

      const generationId = await clientRef.current.chat(chatRequest, {
        onEvent: (event: StreamEvent) => {
          switch (event.type) {
            case "thinking":
              currentThinking += event.data.text;
              setThinking(currentThinking);
              break;
            case "content":
              currentContent += event.data.text;
              setResponse(currentContent);
              // Scroll to bottom
              scrollViewRef.current?.scrollToEnd({ animated: false });
              break;
            case "done":
              console.log("Generation complete:", event.data);
              break;
            case "error":
              throw new Error(`${event.data.code}: ${event.data.message}`);
          }
        },
        onError: (error: Error) => {
          throw error;
        },
        onComplete: () => {
          // Generation complete
        },
        signal: abortController.signal,
      });

      setGenerationId(generationId);

      // Add assistant message to history
      const assistantMessage: Message = {
        id: generationId,
        role: "assistant",
        content: currentContent,
        thinking: currentThinking,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setResponse("");
      setThinking("");
    } catch (error) {
      if (
        error instanceof Error &&
        error.name !== "AbortError"
      ) {
        Alert.alert(
          "Error",
          error instanceof Error ? error.message : "Failed to send message"
        );
      }
    } finally {
      setIsLoading(false);
      setGenerationId(null);
      abortControllerRef.current = null;
    }
  };

  const handleStop = async () => {
    if (!generationId || !isLoading) {
      return;
    }

    try {
      // Cancel the fetch request
      abortControllerRef.current?.abort();

      // Notify server of cancellation
      await clientRef.current.cancelGeneration(generationId);

      setIsLoading(false);
      setGenerationId(null);
    } catch (error) {
      console.error("Failed to cancel:", error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chat</Text>
        <TouchableOpacity onPress={() => router.push("/settings")}>
          <Text style={styles.settingsButton}>Settings</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
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
  settingsButton: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "500",
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
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
  },
  loadingDots: {
    marginTop: 8,
  },
  loadingText: {
    marginTop: 8,
    color: "#666",
    fontSize: 14,
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
