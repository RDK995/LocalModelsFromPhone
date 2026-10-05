/**
 * Renders the tree from parseMarkdown as nested <Text> (FR26). Links are plain,
 * non-tappable text (FR27); a link that matches one of the reply's saved
 * sources is followed by that site's logo, and only the logo is tappable
 * (see SourceLogo). Pure JS, Expo Go compatible.
 */

import React, { useMemo } from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { parseMarkdown } from "./markdown";
import type { Block, Inline } from "./markdown";
import { tableLayout } from "./tableLayout";
import { gridWidth } from "./tableLayout";
import { presentCitation, presentLink } from "./inlineLink";
import type { LinkSource } from "./sourceLinks";
import { SourceLogo } from "./SourceLogo";
import type { IconCache } from "@/store/iconCache";

type LinkContext = {
  sources?: LinkSource[];
  iconCache?: IconCache;
  onOpenSource?: (url: string) => void;
};

const BASE_FONT_SIZE = 14;
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

function renderInline(nodes: Inline[], ctx: LinkContext): React.ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "bold":
        return (
          <Text key={i} style={styles.bold}>
            {renderInline(node.children, ctx)}
          </Text>
        );
      case "italic":
        return (
          <Text key={i} style={styles.italic}>
            {renderInline(node.children, ctx)}
          </Text>
        );
      case "code":
        return (
          <Text key={i} style={styles.inlineCode}>
            {node.text}
          </Text>
        );
      case "cite": {
        const presented = node.numbers.map((n) => presentCitation(n, ctx.sources));
        if (ctx.iconCache && ctx.onOpenSource) {
          const logos: React.ReactNode[] = [];
          for (const p of presented) {
            if (p.kind !== "source") return node.raw;
            logos.push(
              <SourceLogo
                key={logos.length}
                host={p.host}
                url={p.url}
                iconCache={ctx.iconCache}
                onOpen={ctx.onOpenSource}
              />,
            );
          }
          return <Text key={i}>{logos}</Text>;
        }
        return node.raw;
      }
      case "link":
      {
        const presented = presentLink(node.url, ctx.sources);
        if (presented.kind === "source" && ctx.iconCache && ctx.onOpenSource) {
          return (
            <Text key={i}>
              {renderInline(node.children, ctx)}{" "}
              <SourceLogo
                host={presented.host}
                url={presented.url}
                iconCache={ctx.iconCache}
                onOpen={ctx.onOpenSource}
              />
            </Text>
          );
        }
        return <Text key={i}>{renderInline(node.children, ctx)}</Text>;
      }
    }
  });
}

function renderBlock(
  block: Block,
  i: number,
  style: StyleProp<TextStyle>,
  ctx: LinkContext,
  tableWidth: number,
) {
  switch (block.type) {
    case "paragraph":
      return (
        <Text key={i} style={style}>
          {renderInline(block.children, ctx)}
        </Text>
      );
    case "heading": {
      const size = BASE_FONT_SIZE + (block.level <= 3 ? (4 - block.level) * 2 : 0);
      return (
        <Text key={i} style={[style, styles.bold, { fontSize: size }]}>
          {renderInline(block.children, ctx)}
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
              <Text style={[style, styles.listText]}>{renderInline(item.children, ctx)}</Text>
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
          <Text style={[style, styles.quoteText]}>{renderInline(block.children, ctx)}</Text>
        </View>
      );
    case "table": {
      const layout = tableLayout(block.rows);
      if (layout.kind === "grid") {
        return (
          <View key={i} style={[styles.list, styles.tableGrid, { width: tableWidth }]}>
            <View style={styles.tableRow}>
              {layout.header.map((cell, c) => (
                <Text key={c} style={[style, styles.tableCell, styles.bold]}>
                  {renderInline(cell, ctx)}
                </Text>
              ))}
            </View>
            {layout.rows.map((row, r) => (
              <View key={r} style={styles.tableRow}>
                {row.map((cell, c) => (
                  <Text key={c} style={[style, styles.tableCell]}>
                    {renderInline(cell, ctx)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        );
      }
      return (
        <View key={i} style={styles.list}>
          {layout.cards.map((card, r) => (
            <View key={r} style={styles.tableCard}>
              {card.map((line, c) => (
                <Text key={c} style={style}>
                  <Text style={styles.bold}>{renderInline(line.heading, ctx)}</Text>
                  {": "}
                  {renderInline(line.value, ctx)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    }
    case "rule":
      return <View key={i} style={styles.rule} />;
  }
}

export function MarkdownText({
  text,
  style,
  sources,
  iconCache,
  onOpenSource,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  sources?: LinkSource[];
  iconCache?: IconCache;
  onOpenSource?: (url: string) => void;
}) {
  const ctx: LinkContext = { sources, iconCache, onOpenSource };
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const tableWidth = gridWidth(useWindowDimensions().width);
  return <View>{blocks.map((block, i) => renderBlock(block, i, style, ctx, tableWidth))}</View>;
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
  tableGrid: { maxWidth: "100%" },
  tableRow: { flexDirection: "row", marginTop: 2 },
  tableCard: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 4,
    padding: 8,
    marginTop: 4,
  },
  tableCell: { flex: 1, paddingRight: 8 },
  rule: { height: 1, backgroundColor: "#ccc", marginVertical: 6 },
});
