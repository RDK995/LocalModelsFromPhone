/**
 * FR32 / AC26 (M10e-T1): an assistant answer is laid out at the full width of
 * its bubble and all its text stays inside the bubble, above "Sources (n)" and
 * the model name.
 *
 * bun cannot render React Native, so this test computes the layout with
 * yoga-layout -- the flexbox engine React Native uses -- configured the way
 * React Native 0.86 configures it (YGErrataAll, see
 * react-native/ReactCommon/react/renderer/components/view/
 * YogaLayoutableShadowNode.cpp configureYogaTree). The node tree mirrors the
 * JSX in app/chat.tsx (message group -> bubble -> MarkdownText -> list rows of
 * marker + text, ActivityIndicator, SourceList -> header; model label after
 * the bubble) and every style value is read from the real StyleSheet.create
 * blocks in chat.tsx, MarkdownText.tsx and SourceList.tsx, never copied.
 * Text is measured the way React Native's text measurement answers Yoga:
 * words wrapped at a fixed character width (0.5 x fontSize), a line height of
 * 1.2 x fontSize, the used width for "at most" and the given width for
 * "exactly".
 *
 * Shaped like the owner's phone screenshot of 2026-09-30 22:32
 * (.harness/evidence/FR32-owner-phone-squeezed-2026-09-30-2232.png): a web
 * reply whose body is a bulleted list of news items, with five sources.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Yoga, {
  Align,
  Direction,
  Edge,
  Errata,
  FlexDirection,
  Gutter,
  MeasureMode,
} from "yoga-layout";
import type { Node as YogaNode } from "yoga-layout";
import { buildChatItems } from "./chatItems";
import type { ChatItem, PendingTurn } from "./chatItems";
import { parseMarkdown, visibleText } from "./markdown";
import { sourceListHeader } from "./sourceListModel";
import { initialStreamAccumulator } from "./streamReducer";
import type { Message } from "@/store/conversationStore";

const dir = import.meta.dir;
const chatSrc = readFileSync(join(dir, "..", "app", "chat.tsx"), "utf-8");
const mdSrc = readFileSync(join(dir, "MarkdownText.tsx"), "utf-8");
const sourceListSrc = readFileSync(join(dir, "SourceList.tsx"), "utf-8");

type Style = Record<string, string | number>;

/** The object literal for `name` inside the file's StyleSheet.create({...}). */
function styleOf(source: string, name: string): Style {
  const sheet = source.indexOf("StyleSheet.create({");
  if (sheet < 0) throw new Error("no StyleSheet.create");
  const m = new RegExp(`\\n\\s*${name}:\\s*\\{`).exec(source.slice(sheet));
  if (!m) throw new Error(`style ${name} not found`);
  const open = sheet + m.index + m[0].length - 1;
  let depth = 0;
  let end = open;
  for (; end < source.length; end++) {
    if (source[end] === "{") depth++;
    if (source[end] === "}" && --depth === 0) break;
  }
  return new Function(`return (${source.slice(open, end + 1)});`)() as Style;
}

const chatStyles = {
  messagesContent: styleOf(chatSrc, "messagesContent"),
  messageGroup: styleOf(chatSrc, "messageGroup"),
  message: styleOf(chatSrc, "message"),
  userMessage: styleOf(chatSrc, "userMessage"),
  assistantMessage: styleOf(chatSrc, "assistantMessage"),
  messageText: styleOf(chatSrc, "messageText"),
  loadingDots: styleOf(chatSrc, "loadingDots"),
  modelLabel: styleOf(chatSrc, "modelLabel"),
};
const mdStyles = {
  list: styleOf(mdSrc, "list"),
  listRow: styleOf(mdSrc, "listRow"),
  marker: styleOf(mdSrc, "marker"),
  listText: styleOf(mdSrc, "listText"),
};
const sourceStyles = {
  container: styleOf(sourceListSrc, "container"),
  heading: styleOf(sourceListSrc, "heading"),
};

// Styles that only paint (no effect on layout).
const PAINT = new Set([
  "backgroundColor",
  "borderRadius",
  "color",
  "fontWeight",
  "fontStyle",
  "fontSize",
]);

function applyStyle(node: YogaNode, ...styles: Style[]): void {
  for (const style of styles) {
    for (const [key, value] of Object.entries(style)) {
      if (PAINT.has(key)) continue;
      const v = value as number & `${number}%`;
      switch (key) {
        case "padding": node.setPadding(Edge.All, v); break;
        case "paddingLeft": node.setPadding(Edge.Left, v); break;
        case "marginTop": node.setMargin(Edge.Top, v); break;
        case "marginBottom": node.setMargin(Edge.Bottom, v); break;
        case "marginLeft": node.setMargin(Edge.Left, v); break;
        case "width": node.setWidth(v); break;
        case "maxWidth": node.setMaxWidth(v); break;
        case "flex": node.setFlex(v); break;
        case "flexShrink": node.setFlexShrink(v); break;
        case "gap": node.setGap(Gutter.All, v); break;
        case "flexDirection":
          node.setFlexDirection(value === "row" ? FlexDirection.Row : FlexDirection.Column);
          break;
        case "alignSelf":
          node.setAlignSelf(
            value === "flex-start" ? Align.FlexStart
              : value === "flex-end" ? Align.FlexEnd
                : value === "stretch" ? Align.Stretch
                  : Align.Auto,
          );
          break;
        default:
          throw new Error(`layout style ${key} not modelled by this test`);
      }
    }
  }
}

const PHONE_WIDTH = 393; // iPhone 15/16 Pro points (screenshot 1179 px / 3)
const MEASURED_FONT = 14;

let created: YogaNode[] = [];
afterEach(() => {
  for (const n of created) n.free();
  created = [];
});

const config = Yoga.Config.create();
config.setErrata(Errata.All); // React Native's default (LayoutConformance "compatibility")
config.setPointScaleFactor(3);

function node(...styles: Style[]): YogaNode {
  const n = Yoga.Node.create(config);
  created.push(n);
  applyStyle(n, ...styles);
  return n;
}

function wrapLines(text: string, maxWidth: number, charWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length * charWidth > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

type TextBox = { node: YogaNode; text: string; fontSize: number };

function textNode(text: string, boxes: TextBox[], ...styles: Style[]): YogaNode {
  const fontSize = styles.reduce<number>(
    (size, s) => (typeof s.fontSize === "number" ? s.fontSize : size),
    MEASURED_FONT,
  );
  const n = node(...styles);
  const charWidth = fontSize * 0.5;
  n.setMeasureFunc((width, widthMode) => {
    const max = widthMode === MeasureMode.Undefined ? Infinity : width;
    const lines = wrapLines(text, max, charWidth);
    const used = Math.max(...lines.map((l) => l.length * charWidth));
    return {
      width: widthMode === MeasureMode.Exactly ? width : Math.min(used, max),
      height: lines.length * fontSize * 1.2,
    };
  });
  boxes.push({ node: n, text, fontSize });
  return n;
}

type Laid = {
  bubble: YogaNode;
  answer: YogaNode;
  answerTexts: TextBox[];
  below: { what: string; node: YogaNode }[];
  modelLabel: YogaNode | null;
};

/** The chat.tsx message tree for one item, inside the messages scroll content. */
function layOut(item: ChatItem): Laid {
  const root = node(chatStyles.messagesContent);
  root.setWidth(PHONE_WIDTH);
  const group = node(chatStyles.messageGroup);
  root.insertChild(group, 0);
  const bubble = node(
    chatStyles.message,
    item.role === "user" ? chatStyles.userMessage : chatStyles.assistantMessage,
  );
  group.insertChild(bubble, 0);

  const answerTexts: TextBox[] = [];
  const answer = node(); // MarkdownText's root <View>
  bubble.insertChild(answer, 0);
  for (const block of parseMarkdown(item.content)) {
    if (block.type === "paragraph") {
      answer.insertChild(
        textNode(visibleText([block]), answerTexts, chatStyles.messageText),
        answer.getChildCount(),
      );
    } else if (block.type === "list") {
      const list = node(mdStyles.list);
      block.items.forEach((it, j) => {
        const row = node(mdStyles.listRow, { paddingLeft: it.depth * 12 });
        row.insertChild(textNode("•", [], chatStyles.messageText, mdStyles.marker), 0);
        const text = visibleText([{ type: "paragraph", children: it.children }]);
        row.insertChild(textNode(text, answerTexts, chatStyles.messageText, mdStyles.listText), 1);
        list.insertChild(row, j);
      });
      answer.insertChild(list, answer.getChildCount());
    } else {
      throw new Error(`block ${block.type} not modelled by this test`);
    }
  }

  const below: Laid["below"] = [];
  if (item.streaming) {
    const spinner = node(chatStyles.loadingDots, { width: 20 }); // ActivityIndicator size "small"
    spinner.setHeight(20);
    bubble.insertChild(spinner, bubble.getChildCount());
    below.push({ what: "streaming indicator", node: spinner });
  }
  if (item.sources) {
    const container = node(sourceStyles.container);
    const header = textNode(`${sourceListHeader(item.sources)} ▼`, [], sourceStyles.heading);
    container.insertChild(header, 0);
    bubble.insertChild(container, bubble.getChildCount());
    below.push({ what: "Sources header", node: header });
  }
  let modelLabel: YogaNode | null = null;
  if (item.role === "assistant" && item.model) {
    modelLabel = textNode(item.model, [], chatStyles.modelLabel);
    group.insertChild(modelLabel, 1);
    below.push({ what: "model label", node: modelLabel });
  }

  root.calculateLayout(PHONE_WIDTH, undefined, Direction.LTR);
  return { bubble, answer, answerTexts, below, modelLabel };
}

function abs(n: YogaNode): { left: number; top: number; width: number; height: number } {
  const own = n.getComputedLayout();
  let left = own.left;
  let top = own.top;
  for (let p = n.getParent(); p; p = p.getParent()) {
    left += p.getComputedLayout().left;
    top += p.getComputedLayout().top;
  }
  return { left, top, width: own.width, height: own.height };
}

// ---- the 22:32 answer --------------------------------------------------------

const NEWS = [
  "Pilot stabbed fellow pilot in apparent attempt to crash Israel-bound plane, Netanyahu says.",
  "OpenAI CEO Sam Altman to skip congressional hearing on rogue AI agents.",
  "Judge allows Paramount to close $110 billion takeover of Warner Bros. Discovery.",
  "Britain believes Iran was involved in incident near air base used by U.S., prime minister says.",
  "Tennessee execution of lone woman on death row halted by federal appeals court.",
  "Supreme Court allows Trump's 'third country' deportation policy to continue.",
];
const ANSWER = NEWS.map((n) => `- ${n}`).join("\n");
const SOURCES = [
  { title: "Pilot stabbed fellow pilot", url: "https://www.reuters.com/world/pilot" },
  { title: "Altman to skip hearing", url: "https://apnews.com/article/altman" },
  { title: "Paramount takeover", url: "https://www.nytimes.com/paramount" },
  { title: "Britain says Iran involved", url: "https://www.bbc.co.uk/news/iran" },
  { title: "Tennessee execution halted", url: "https://www.cnn.com/tennessee" },
];
const MODEL = "nemotron3:33b";

function savedItem(): ChatItem {
  const persisted: Message[] = [
    { id: "u1", role: "user", content: "What's in the news today?", status: "complete" },
    { id: "a1", role: "assistant", content: ANSWER, status: "complete", model: MODEL, sources: SOURCES },
  ];
  const item = buildChatItems(persisted, null)[1] as ChatItem;
  expect(item.streaming).toBe(false);
  return item;
}

function streamingItem(): ChatItem {
  // Mid-stream: sources already arrived from the search, list partly written.
  const partial = ANSWER.slice(0, ANSWER.indexOf("Britain") + "Britain believes Iran".length);
  const pending: PendingTurn = {
    userMessageId: "u1",
    prompt: "What's in the news today?",
    assistantMessageId: "a1",
    accumulator: { ...initialStreamAccumulator, content: partial, sources: SOURCES },
    blocked: false,
  };
  const item = buildChatItems([], pending)[1] as ChatItem;
  expect(item.streaming).toBe(true);
  return item;
}

function expectFitsBubble(laid: Laid): void {
  const contentWidth = PHONE_WIDTH - 2 * (chatStyles.messagesContent.padding as number);
  const bubbleMax = contentWidth * (parseFloat(chatStyles.message.maxWidth as string) / 100);
  const pad = chatStyles.message.padding as number;
  const bubble = abs(laid.bubble);
  const answer = abs(laid.answer);

  // Nothing overlaps: the answer's text ends inside the bubble, above
  // everything drawn after it.
  const answerBottom = Math.max(
    answer.top + answer.height,
    ...laid.answerTexts.map((t) => abs(t.node).top + abs(t.node).height),
  );
  expect(answerBottom).toBeLessThanOrEqual(bubble.top + bubble.height - pad + 0.5);
  for (const b of laid.below) {
    const top = abs(b.node).top;
    expect({ what: b.what, below: top >= answerBottom - 0.5 }).toEqual({ what: b.what, below: true });
  }
  if (laid.modelLabel) {
    expect(abs(laid.modelLabel).top).toBeGreaterThanOrEqual(bubble.top + bubble.height - 0.5);
  }

  // Full width: the bubble opens to its maximum and the answer fills its inside.
  expect(bubble.width).toBeCloseTo(bubbleMax, 0);
  expect(answer.width).toBeCloseTo(bubbleMax - 2 * pad, 0);
  for (const t of laid.answerTexts) {
    const box = abs(t.node);
    expect(box.left + box.width).toBeLessThanOrEqual(answer.left + answer.width + 0.5);
    // A list item's text column is the answer width minus its bullet (22) only.
    expect(box.width).toBeGreaterThan(answer.width * 0.8);
  }
}

describe("the chat tree this test models matches chat.tsx and MarkdownText.tsx", () => {
  it("assistant bubble holds MarkdownText, the streaming indicator and SourceList; model label follows", () => {
    const bubble = chatSrc.indexOf("styles.assistantMessage,\n                    ]}");
    const md = chatSrc.indexOf("<MarkdownText", bubble);
    const spinner = chatSrc.indexOf("<ActivityIndicator style={styles.loadingDots} />", md);
    const sources = chatSrc.indexOf("<SourceList", spinner);
    const label = chatSrc.indexOf("<Text style={styles.modelLabel}>{item.model}</Text>", sources);
    expect([bubble, md, spinner, sources, label].every((i) => i > 0)).toBe(true);
    expect(chatSrc).toContain("style={styles.messageText}");
  });
  it("a list item is a row of a marker Text and a text Text", () => {
    expect(mdSrc).toContain("<View key={i} style={styles.list}>");
    expect(mdSrc).toContain("style={[styles.listRow, { paddingLeft: item.depth * 12 }]}");
    expect(mdSrc).toContain("<Text style={[style, styles.marker]}>");
    expect(mdSrc).toContain("<Text style={[style, styles.listText]}>");
    expect(sourceListSrc).toContain("<View style={styles.container}>");
    expect(sourceListSrc).toContain("<Text style={styles.heading}>");
  });
});

describe("a bulleted web answer fits its bubble (FR32, AC26)", () => {
  it("reopened from saved history: full bubble width, text above Sources (n) and the model name", () => {
    expectFitsBubble(layOut(savedItem()));
  });
  it("while streaming: full bubble width, text above the indicator and Sources (n)", () => {
    expectFitsBubble(layOut(streamingItem()));
  });
  it("while streaming with no sources yet (first words): still full bubble width", () => {
    const item = { ...streamingItem(), content: "- Pilot", sources: undefined };
    expectFitsBubble(layOut(item));
  });
  it("a one-line plain answer also takes the full bubble width", () => {
    expectFitsBubble(layOut({ ...savedItem(), content: "Hello there." }));
  });
});

describe("user messages keep their right-aligned shrink-wrapped look", () => {
  it("a short user message is narrower than the bubble maximum and sits at the right", () => {
    const laid = layOut({ key: "u1", role: "user", content: "hi", streaming: false });
    const bubble = abs(laid.bubble);
    const contentWidth = PHONE_WIDTH - 2 * (chatStyles.messagesContent.padding as number);
    expect(bubble.width).toBeLessThan(contentWidth * 0.5);
    expect(bubble.left + bubble.width).toBeCloseTo(PHONE_WIDTH - (chatStyles.messagesContent.padding as number), 0);
  });
});
