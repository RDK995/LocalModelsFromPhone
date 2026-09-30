/**
 * Renders the tree from parseMarkdown as nested <Text> (FR26). Links are plain,
 * non-tappable text (FR27, this milestone). Pure JS, Expo Go compatible.
 */

import React, { useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { parseMarkdown } from "./markdown";
import type { Block, Inline } from "./markdown";

const BASE_FONT_SIZE = 14;
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

function renderInline(nodes: Inline[]): React.ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "bold":
        return (
          <Text key={i} style={styles.bold}>
            {renderInline(node.children)}
          </Text>
        );
      case "italic":
        return (
          <Text key={i} style={styles.italic}>
            {renderInline(node.children)}
          </Text>
        );
      case "code":
        return (
          <Text key={i} style={styles.inlineCode}>
            {node.text}
          </Text>
        );
      case "link":
        return <Text key={i}>{renderInline(node.children)}</Text>;
    }
  });
}

function renderBlock(block: Block, i: number, style: StyleProp<TextStyle>) {
  switch (block.type) {
    case "paragraph":
      return (
        <Text key={i} style={style}>
          {renderInline(block.children)}
        </Text>
      );
    case "heading": {
      const size = BASE_FONT_SIZE + (block.level <= 3 ? (4 - block.level) * 2 : 0);
      return (
        <Text key={i} style={[style, styles.bold, { fontSize: size }]}>
          {renderInline(block.children)}
        </Text>
      );
    }
    case "list": {
      return (
        <View key={i} style={styles.list}>
          {block.items.map((item, j) => (
            <View key={j} style={[styles.listRow, { paddingLeft: item.depth * 12 }]}>
              <Text style={[style, styles.marker]}>
                {block.ordered ? `${block.start + j}.` : "•"}
              </Text>
              <Text style={[style, styles.listText]}>{renderInline(item.children)}</Text>
            </View>
          ))}
        </View>
      );
    }
    case "codeBlock":
      return (
        <View key={i} style={styles.codeBlock}>
          <Text style={styles.codeBlockText}>{block.text}</Text>
        </View>
      );
    case "quote":
      return (
        <View key={i} style={styles.quote}>
          <Text style={[style, styles.quoteText]}>{renderInline(block.children)}</Text>
        </View>
      );
    case "table":
      return (
        <View key={i} style={styles.list}>
          {block.rows.map((row, r) => (
            <View key={r} style={styles.tableRow}>
              {row.map((cell, c) => (
                <Text
                  key={c}
                  style={[style, styles.tableCell, r === 0 ? styles.bold : null]}
                >
                  {renderInline(cell)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    case "rule":
      return <View key={i} style={styles.rule} />;
  }
}

export function MarkdownText({
  text,
  style,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <View>{blocks.map((block, i) => renderBlock(block, i, style))}</View>;
}

const styles = StyleSheet.create({
  bold: { fontWeight: "bold" },
  italic: { fontStyle: "italic" },
  inlineCode: { fontFamily: MONO, backgroundColor: "#eee" },
  list: { marginTop: 4 },
  listRow: { flexDirection: "row", marginTop: 2 },
  marker: { width: 22 },
  listText: { flex: 1 },
  codeBlock: {
    backgroundColor: "#eee",
    padding: 8,
    borderRadius: 4,
    marginTop: 4,
  },
  codeBlockText: { fontFamily: MONO, fontSize: 13, color: "#000" },
  quote: { borderLeftWidth: 3, borderLeftColor: "#ccc", paddingLeft: 8, marginTop: 4 },
  quoteText: { color: "#666" },
  tableRow: { flexDirection: "row", marginTop: 2 },
  tableCell: { flex: 1, paddingRight: 8 },
  rule: { height: 1, backgroundColor: "#ccc", marginVertical: 6 },
});
