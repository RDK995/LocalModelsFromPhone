/**
 * Settings screen for token management
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
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import { saveToken, clearToken } from "@/api/token";

export default function SettingsScreen() {
  const [token, setToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  const handleUpdateToken = async () => {
    if (!token.trim()) {
      Alert.alert("Error", "Please enter a token");
      return;
    }

    setIsLoading(true);
    try {
      await saveToken(token.trim());
      Alert.alert("Success", "Token updated successfully");
      setToken("");
      setShowForm(false);
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to update token"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", onPress: () => {} },
      {
        text: "Logout",
        onPress: async () => {
          try {
            await clearToken();
            router.replace("/setup");
          } catch {
            Alert.alert("Error", "Failed to logout");
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bearer Token</Text>
          {!showForm ? (
            <TouchableOpacity
              style={styles.button}
              onPress={() => setShowForm(true)}
            >
              <Text style={styles.buttonText}>Update Token</Text>
            </TouchableOpacity>
          ) : (
            <View>
              <TextInput
                style={styles.input}
                placeholder="Enter new token"
                value={token}
                onChangeText={setToken}
                editable={!isLoading}
                secureTextEntry={true}
                placeholderTextColor="#999"
                multiline={true}
              />
              <View style={styles.formButtons}>
                <TouchableOpacity
                  style={[
                    styles.formButton,
                    styles.cancelButton,
                    isLoading && styles.buttonDisabled,
                  ]}
                  onPress={() => {
                    setToken("");
                    setShowForm(false);
                  }}
                  disabled={isLoading}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.formButton,
                    styles.submitButton,
                    isLoading && styles.buttonDisabled,
                  ]}
                  onPress={handleUpdateToken}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.button, styles.logoutButton]}
            onPress={handleLogout}
          >
            <Text style={styles.logoutButtonText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 30,
    color: "#000",
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
    color: "#333",
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#ddd",
    color: "#000",
    minHeight: 100,
  },
  button: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  formButtons: {
    flexDirection: "row",
    gap: 12,
  },
  formButton: {
    flex: 1,
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  submitButton: {
    backgroundColor: "#007AFF",
  },
  cancelButton: {
    backgroundColor: "#e0e0e0",
  },
  cancelButtonText: {
    color: "#333",
    fontSize: 14,
    fontWeight: "600",
  },
  logoutButton: {
    backgroundColor: "#ff3b30",
  },
  logoutButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
