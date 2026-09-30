/**
 * The collapsible source list at the end of a web answer (FR28). Starts
 * collapsed as "Sources (n)"; tapping the header expands it. Each source is
 * its own tappable row (logo + title) that opens that source's saved URL.
 * The expanded state lives in component state only. Pure JS, Expo Go compatible.
 */

import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { IconCache } from "@/store/iconCache";
import { SourceLogo } from "./SourceLogo";
import {
  initialSourcesExpanded,
  sourceListEntries,
  sourceListHeader,
  toggleSourcesExpanded,
} from "./sourceListModel";
import type { SourceListInput } from "./sourceListModel";

export function SourceList({
  sources,
  iconCache,
  onOpenSource,
}: {
  sources: SourceListInput[] | undefined;
  iconCache: IconCache;
  onOpenSource: (url: string) => void;
}) {
  const [expanded, setExpanded] = useState(initialSourcesExpanded);
  if (!sources || sources.length === 0) return null;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(toggleSourcesExpanded)}
      >
        <Text style={styles.heading}>
          {sourceListHeader(sources)} {expanded ? "▲" : "▼"}
        </Text>
      </TouchableOpacity>
      {expanded &&
        sourceListEntries(sources).map((entry) => (
          <TouchableOpacity
            key={entry.key}
            accessibilityRole="link"
            onPress={() => onOpenSource(entry.url)}
            style={styles.row}
          >
            {entry.host !== null ? (
              <SourceLogo
                host={entry.host}
                url={entry.url}
                iconCache={iconCache}
                onOpen={onOpenSource}
              />
            ) : (
              <Text>{"\u{1F310}"}</Text>
            )}
            <Text style={styles.title} numberOfLines={2}>
              {entry.title}
            </Text>
          </TouchableOpacity>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8, gap: 6 },
  heading: { fontSize: 12, fontWeight: "bold", color: "#555" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flexShrink: 1, fontSize: 13, color: "#007AFF" },
});
