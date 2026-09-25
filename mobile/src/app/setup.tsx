/**
 * Setup screen for entering the bearer token
 */

import React, { useState } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { saveToken } from "@/api/secureStoreToken";

export default function SetupScreen() {
  const [token, setToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleTokenSubmit = async () => {
    if (!token.trim()) {
      Alert.alert("Error", "Please enter a token");
      return;
    }

    setIsLoading(true);
    try {
      await saveToken(token.trim());
      // Navigate to chat screen
      router.replace("/chat");
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to save token"
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter Bearer Token</Text>
      <Text style={styles.subtitle}>
        Paste the token from your server
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Bearer token"
        value={token}
        onChangeText={setToken}
        editable={!isLoading}
        secureTextEntry={true}
        placeholderTextColor="#999"
        multiline={true}
      />

      <TouchableOpacity
        style={[styles.button, isLoading && styles.buttonDisabled]}
        onPress={handleTokenSubmit}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 10,
    color: "#000",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 30,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#ddd",
    color: "#000",
    minHeight: 100,
  },
  button: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
