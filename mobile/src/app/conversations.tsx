/**
 * Conversations screen (FR7/FR8, M3-T2): lists every stored conversation
 * (M3-T1) newest first, lets the user start a new one, open one, or delete
 * one. This is the landing screen once a token is present (see
 * app-routing/initialRoute.ts and setup.tsx).
 */

import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { createConversationStore } from "@/store/conversationStore";
import { asyncStoragePort } from "@/store/asyncStorage";
import {
  toConversationListView,
  type ConversationRow,
} from "@/ui/conversationList";

export default function ConversationsScreen() {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const router = useRouter();
  const storeRef = useRef(createConversationStore(asyncStoragePort));

  const load = useCallback(async (isPullToRefresh: boolean) => {
    if (isPullToRefresh) {
      setIsRefreshing(true);
    }
    try {
      const conversations = await storeRef.current.list();
      setRows(toConversationListView(conversations).rows);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Refresh every time this screen gains focus, so a conversation
  // created/deleted elsewhere (or on a previous visit) is reflected without
  // a manual pull-to-refresh -- same pattern as models.tsx.
  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load])
  );

  const handleRefresh = useCallback(() => {
    load(true);
  }, [load]);

  const handleNewChat = useCallback(async () => {
    const conversation = await storeRef.current.create();
    router.push({ pathname: "/chat", params: { id: conversation.id } });
  }, [router]);

  const handleOpen = useCallback(
    (id: string) => {
      router.push({ pathname: "/chat", params: { id } });
    },
    [router]
  );

  const handleDelete = useCallback(
    (row: ConversationRow) => {
      Alert.alert(
        "Delete conversation",
        `Delete "${row.title}"? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              await storeRef.current.delete(row.id);
              load(false);
            },
          },
        ]
      );
    },
    [load]
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Conversations</Text>
        <View style={styles.headerLinks}>
          <TouchableOpacity onPress={() => router.push("/models")}>
            <Text style={styles.headerLink}>Models</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/settings")}>
            <Text style={styles.headerLink}>Settings</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.newChatButton} onPress={handleNewChat}>
        <Text style={styles.newChatButtonText}>New chat</Text>
      </TouchableOpacity>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={
            rows.length === 0 ? styles.emptyListContent : undefined
          }
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                No conversations yet. Tap "New chat" to start one.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => handleOpen(item.id)}
              onLongPress={() => handleDelete(item)}
            >
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowUpdated}>{item.updatedLabel}</Text>
            </TouchableOpacity>
          )}
        />
      )}
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
  headerLinks: {
    flexDirection: "row",
    gap: 16,
  },
  headerLink: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "500",
  },
  newChatButton: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 10,
    alignItems: "center",
  },
  newChatButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyListContent: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  rowTitle: {
    fontSize: 15,
    color: "#000",
    flexShrink: 1,
  },
  rowUpdated: {
    fontSize: 12,
    color: "#999",
  },
});
