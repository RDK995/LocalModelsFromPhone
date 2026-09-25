/**
 * Models screen: lists every model installed on the Mac and marks the one
 * that is actually resident right now, including a model another tool on
 * the Mac loaded that the phone never asked for (F2 / edge case at
 * .harness/requirements.md lines 128-129). Load and Unload each start the
 * operation on the server, then poll `GET /v1/state` until it finishes,
 * showing a busy label meanwhile and, on a failed load, the server's failure
 * reason (FR3, FR4, FR5).
 *
 * If the server answers `confirmation_required` (a reply is still being
 * generated, or the resident model wasn't loaded by this app), an
 * `Alert.alert` warns the user and asks them to confirm before retrying with
 * `confirm: true` (FR6). Cancelling leaves the screen exactly as it was: no
 * busy label, no error, nothing sent to the server.
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
  TouchableOpacity,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { StateResponse } from "@shared/api";
import { getToken } from "@/api/secureStoreToken";
import { createAPIClient } from "@/api/expoFetchClient";
import { ServerError, UnauthorizedError } from "@/api/client";
import { UNAUTHORIZED_MESSAGE } from "@/chat/chatController";
import { toModelListView, type ModelRow } from "@/ui/modelList";
import { runModelAction } from "@/ui/modelActions";
import { buildConfirmationWarning } from "@/ui/confirmation";

export default function ModelsScreen() {
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [residentLabel, setResidentLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [canUnload, setCanUnload] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);
  const router = useRouter();
  const clientRef = useRef(createAPIClient());

  const applyState = useCallback((state: StateResponse) => {
    const view = toModelListView(state);
    setRows(view.rows);
    setResidentLabel(view.residentLabel);
    setBusyLabel(view.busyLabel);
    setFailureMessage(view.failureMessage);
    setCanUnload(view.canUnload);
  }, []);

  // Sent to Settings with the token form open, the same 401 pattern as
  // chat.tsx (FR13).
  const routeToUnauthorized = useCallback(() => {
    Alert.alert(
      UNAUTHORIZED_MESSAGE,
      "The password on this phone no longer matches the Mac. Paste the current one from the Mac (pbcopy < ~/.phone-models/token)."
    );
    router.push({
      pathname: "/settings",
      params: { updateToken: "1" },
    });
  }, [router]);

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
        applyState(state);
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          routeToUnauthorized();
          return;
        }

        setRows([]);
        setResidentLabel("");
        setBusyLabel(null);
        setFailureMessage(null);
        setCanUnload(false);
        setErrorMessage(
          error instanceof Error ? error.message : "Can't reach the Mac"
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [router, applyState, routeToUnauthorized]
  );

  // The busy label, resident label, rows and failure/error messages must not
  // change while the confirmation dialog is up or after a Cancel (FR6), so
  // they are only touched once polling actually starts -- either because no
  // confirmation was needed, or because the user confirmed.
  const runAction = useCallback(
    async (
      start: (confirm: boolean) => Promise<unknown>,
      confirmButtonLabel: string,
      residentModelName: string | null
    ) => {
      setIsActionPending(true);

      try {
        const token = await getToken();
        if (!token) {
          router.replace("/setup");
          return;
        }
        clientRef.current.setToken(token);

        await runModelAction({
          start,
          getState: () => clientRef.current.getState(),
          onPoll: (state) => {
            setErrorMessage(null);
            applyState(state);
          },
          confirm: (reasons) =>
            new Promise<boolean>((resolve) => {
              const warning = buildConfirmationWarning(
                reasons,
                residentModelName
              );
              Alert.alert(warning.title, warning.message, [
                { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                { text: confirmButtonLabel, onPress: () => resolve(true) },
              ]);
            }),
        });
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          routeToUnauthorized();
          return;
        }

        setBusyLabel(null);
        setErrorMessage(
          error instanceof ServerError || error instanceof Error
            ? error.message
            : "Can't reach the Mac"
        );
      } finally {
        setIsActionPending(false);
      }
    },
    [router, applyState, routeToUnauthorized]
  );

  const handleLoad = useCallback(
    (name: string) => {
      const residentRow = rows.find((row) => row.isResident);
      runAction(
        (confirm) => clientRef.current.loadModel({ name, confirm }),
        "Load anyway",
        residentRow ? residentRow.name : null
      );
    },
    [runAction, rows]
  );

  const handleUnload = useCallback(() => {
    const residentRow = rows.find((row) => row.isResident);
    runAction(
      (confirm) => clientRef.current.unloadModel({ confirm }),
      "Unload anyway",
      residentRow ? residentRow.name : null
    );
  }, [runAction, rows]);

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
      {busyLabel !== null && (
        <View style={styles.busyRow}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.busyLabel}>{busyLabel}</Text>
        </View>
      )}
      {failureMessage !== null && (
        <Text style={styles.errorText}>{failureMessage}</Text>
      )}
      {errorMessage !== null && (
        <Text style={styles.errorText}>{errorMessage}</Text>
      )}
      {canUnload && (
        <TouchableOpacity
          style={[
            styles.unloadButton,
            isActionPending && styles.buttonDisabled,
          ]}
          onPress={handleUnload}
          disabled={isActionPending}
        >
          <Text style={styles.buttonText}>Unload</Text>
        </TouchableOpacity>
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
              {item.canLoad && (
                <TouchableOpacity
                  style={[
                    styles.loadButton,
                    isActionPending && styles.buttonDisabled,
                  ]}
                  onPress={() => handleLoad(item.name)}
                  disabled={isActionPending}
                >
                  <Text style={styles.loadButtonText}>Load</Text>
                </TouchableOpacity>
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
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  busyLabel: {
    fontSize: 14,
    color: "#666",
  },
  unloadButton: {
    backgroundColor: "#ff3b30",
    borderRadius: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  loadButton: {
    backgroundColor: "#007AFF",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  loadButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 13,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.5,
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
