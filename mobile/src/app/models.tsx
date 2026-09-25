/**
 * Models screen: lists every model installed on the Mac and marks the one
 * that is actually resident right now, including a model another tool on
 * the Mac loaded that the phone never asked for (F2 / edge case at
 * .harness/requirements.md lines 128-129). Load/Unload controls are not part
 * of this screen (milestone M2b) -- this is read-only.
 */

import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  Alert,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { getToken } from "@/api/secureStoreToken";
import { createAPIClient } from "@/api/expoFetchClient";
import { UnauthorizedError } from "@/api/client";
import { UNAUTHORIZED_MESSAGE } from "@/chat/chatController";
import { toModelListView, type ModelRow } from "@/ui/modelList";

export default function ModelsScreen() {
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [residentLabel, setResidentLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const router = useRouter();
  const clientRef = useRef(createAPIClient());

  const load = useCallback(
    async (isPullToRefresh: boolean) => {
      if (isPullToRefresh) {
        setIsRefreshing(true);
      }
      setErrorMessage(null);

      try {
        const token = await getToken();
        if (!token) {
          router.replace("/setup");
          return;
        }
        clientRef.current.setToken(token);

        const state = await clientRef.current.getState();
        const view = toModelListView(state);
        setRows(view.rows);
        setResidentLabel(view.residentLabel);
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          // Same 401 pattern as chat.tsx: the token on the phone no longer
          // matches the Mac, so send the user to Settings with the token
          // form already open (FR13).
          Alert.alert(
            UNAUTHORIZED_MESSAGE,
            "The password on this phone no longer matches the Mac. Paste the current one from the Mac (pbcopy < ~/.phone-models/token)."
          );
          router.push({
            pathname: "/settings",
            params: { updateToken: "1" },
          });
          return;
        }

        setRows([]);
        setResidentLabel("");
        setErrorMessage(
          error instanceof Error ? error.message : "Can't reach the Mac"
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [router]
  );

  // Refresh every time this screen gains focus, so a model loaded or
  // unloaded elsewhere (another tool on the Mac, or the phone itself on a
  // previous visit) is reflected without a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load])
  );

  const handleRefresh = useCallback(() => {
    load(true);
  }, [load]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {residentLabel !== "" && (
        <Text style={styles.residentLabel}>{residentLabel}</Text>
      )}
      {errorMessage !== null && (
        <Text style={styles.errorText}>{errorMessage}</Text>
      )}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.name}
        contentContainerStyle={
          rows.length === 0 ? styles.emptyListContent : undefined
        }
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowName}>{item.name}</Text>
            <View style={styles.rowMeta}>
              <Text style={styles.rowSize}>{item.sizeLabel}</Text>
              {item.isResident && (
                <Text style={styles.residentMarker}>Loaded</Text>
              )}
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  residentLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: "#ff3b30",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  emptyListContent: {
    flexGrow: 1,
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
  rowName: {
    fontSize: 15,
    color: "#000",
    flexShrink: 1,
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowSize: {
    fontSize: 14,
    color: "#666",
  },
  residentMarker: {
    fontSize: 12,
    fontWeight: "700",
    color: "#34c759",
    borderWidth: 1,
    borderColor: "#34c759",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});
