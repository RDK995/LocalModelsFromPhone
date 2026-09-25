#!/usr/bin/env node
/**
 * Runtime smoke check: executes a real production iOS JS bundle (the exact
 * JavaScript Expo Go runs) in a Node `vm` context, with the native side of
 * React Native (Fabric UI manager, TurboModules, Expo modules) replaced by
 * small in-memory fakes, then starts the app the way the native host does
 * (`RN$AppRegistry.runApplication("main", ...)`) and waits for the first
 * screen to settle.
 *
 * It fails (exit 1) if any JS exception reaches React Native's exception
 * handler (the path that shows "There was a problem running ..." in Expo Go),
 * or if the expected first screen does not render.
 *
 * Usage:
 *   node scripts/runtime-smoke.mjs <bundle.js> --token=<present|absent|wrong>
 *
 * What this proves: the bundled JS (app code + real expo-router, React,
 * react-native JS, react-native-screens JS) starts, RootLayout renders, and
 * the first screen (Chat when a token is stored, Setup otherwise) is
 * committed to the (fake) native view tree without a JS exception.
 *
 * The `--token=absent` run additionally drives the real first-time path
 * (M1-C12): once Setup has rendered, it dispatches the same native Fabric
 * events the real TextInput/Touchable native views send in response to a
 * finger (`topChange` on the token TextInput's instance, then `topClick` on
 * the "Continue" button's instance, found by walking the committed tree),
 * via the fake UI manager's `registerEventHandler` callback (the same
 * mechanism already used below for `topInsetsChange`). Event props like
 * `onChange`/`onClick` are not functions on a Fabric host node's committed
 * props (native only sees a boolean "is a listener registered" flag); the
 * JS handler lives on the React fiber and is only reachable by dispatching
 * the matching native event through `dispatchFabricEvent`, not by calling
 * `node.props.onChange` directly. This runs setup.tsx's actual
 * `handleTokenSubmit` -> `saveToken` -> `router.replace("/chat")`. It then
 * asserts Chat mounted (its own in-app header text is present) with the
 * native Stack header hidden (one top bar), not two. This proves
 * RootLayout's screen options apply to a screen reached by client-side
 * navigation after Setup, not only to a screen reached by the initial
 * launch redirect.
 *
 * The `--token=wrong` run (M1-C15, FR13) stores a token so Chat is the first
 * screen, but every request the app makes gets back HTTP 401
 * `{"error":"unauthorized"}` from a fake `ExpoFetchModule` (the native module
 * behind `expo/fetch`, which the app's real API client uses -- see
 * `src/api/expoFetchClient.ts` and `node_modules/expo/src/winter/fetch/`).
 * Once Chat has rendered, it dispatches `topChange` "hello" on the message
 * TextInput and `topClick` on "Send" (same mechanism as the Setup -> Chat
 * drive above), which runs chat.tsx's real `handleSendMessage` ->
 * `sendMessage` -> `client.getState()` -> the fake 401 -> `onUnauthorized`.
 * It then asserts (a) the native Alert module (`AlertManager.alertWithArgs`,
 * see `node_modules/react-native/Libraries/Alert/{Alert,RCTAlertManager.ios}.js`)
 * was called with title "Password wrong or changed" and not with title
 * "Error", and (b) Settings is mounted with its token form already open
 * ("Bearer Token" and "Save" present, "Update Token" absent). This proves
 * chat.tsx's and settings.tsx's screen wiring for a 401 (FR13) in a real
 * bundle, not just chatController's unit-tested logic.
 *
 * What it cannot prove: anything native (layout, keyboard geometry, how the
 * native header draws), Hermes-specific engine behaviour, the Expo Go version
 * on the phone, real network/streaming to the server (the 401 response for
 * `--token=wrong` is synthesised in-process, not sent over a socket), a
 * non-401 chat flow, or that a real finger tap dispatches events identically
 * to calling the handler directly (the gesture responder / hit-testing
 * geometry is not exercised, only the `onPress` callback it would eventually
 * invoke).
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const log = console.log.bind(console);
const hostSetTimeout = setTimeout;
const HostPromise = Promise;
const hostQueueMicrotask = queueMicrotask;

const bundlePath = process.argv[2];
const tokenArg = (
  process.argv.find(a => a.startsWith("--token=")) ?? "--token=present"
).split("=")[1];
if (!bundlePath || !["present", "absent", "wrong"].includes(tokenArg)) {
  console.error(
    "usage: runtime-smoke.mjs <bundle.js> --token=present|absent|wrong"
  );
  process.exit(2);
}
const STORED_TOKEN =
  tokenArg === "present"
    ? "smoke-test-token"
    : tokenArg === "wrong"
      ? "wrong-smoke-token"
      : null;

const exceptions = [];
const consoleErrors = [];
const softErrors = [];
const alerts = []; // { title, message } from the fake AlertManager, below.
let commits = 0;
const roots = new Map();

// ---- Fake Fabric UI manager: keeps the committed host tree in memory. ----
let dispatchFabricEvent = null;
const fabric = {
  registerEventHandler: fn => {
    dispatchFabricEvent = fn;
  },
  createNode: (tag, viewName, rootTag, props, instanceHandle) => {
    // The native safe-area provider reports insets once it is laid out;
    // until then react-native-safe-area-context renders no children.
    if (viewName === "RNCSafeAreaProvider") {
      hostSetTimeout(
        () =>
          dispatchFabricEvent?.(
            instanceHandle,
            "topInsetsChange",
            safeAreaMetrics
          ),
        0
      );
    }
    return { tag, viewName, props: props ?? {}, children: [], instanceHandle };
  },
  cloneNode: n => ({ ...n, children: [...n.children] }),
  cloneNodeWithNewChildren: n => ({ ...n, children: [] }),
  cloneNodeWithNewProps: (n, p) => ({
    ...n,
    props: { ...n.props, ...p },
    children: [...n.children],
  }),
  cloneNodeWithNewChildrenAndProps: (n, p) => ({
    ...n,
    props: { ...n.props, ...p },
    children: [],
  }),
  createChildSet: () => [],
  appendChild: (parent, child) => {
    parent.children.push(child);
  },
  appendChildToSet: (set, child) => {
    set.push(child);
  },
  completeRoot: (rootTag, set) => {
    commits += 1;
    roots.set(rootTag, set);
  },
  unstable_DefaultEventPriority: 32,
  unstable_DiscreteEventPriority: 2,
  unstable_ContinuousEventPriority: 8,
  unstable_IdleEventPriority: 268435456,
  unstable_getCurrentEventPriority: () => 32,
  getBoundingClientRect: () => [0, 0, 390, 844],
  measure: (n, cb) => cb?.(0, 0, 390, 844, 0, 0),
  measureInWindow: (n, cb) => cb?.(0, 0, 390, 844),
  measureLayout: (n, r, f, cb) => cb?.(0, 0, 390, 844),
};
const fabricProxy = new Proxy(fabric, {
  get: (t, p) =>
    p in t ? t[p] : typeof p === "string" ? () => undefined : undefined,
});

// ---- Fake TurboModules / legacy native modules. ----
const window = { width: 390, height: 844, scale: 3, fontScale: 1 };
const safeAreaMetrics = {
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
  frame: { x: 0, y: 0, ...window },
};
const constants = {
  PlatformConstants: {
    forceTouchAvailable: false,
    osVersion: "26.0",
    systemName: "iOS",
    interfaceIdiom: "phone",
    isTesting: false,
    isMacCatalyst: false,
    reactNativeVersion: { major: 0, minor: 86, patch: 3, prerelease: null },
  },
  DeviceInfo: {
    Dimensions: { window, screen: window },
    isIPhoneX_deprecated: true,
  },
  I18nManager: {
    isRTL: false,
    doLeftAndRightSwapInRTL: true,
    localeIdentifier: "en_US",
  },
  StatusBarManager: { HEIGHT: 47, DEFAULT_BACKGROUND_COLOR: 0 },
  Appearance: {},
  SourceCode: { scriptURL: "http://localhost:8081/index.bundle" },
  RNCSafeAreaContext: {
    initialWindowMetrics: safeAreaMetrics,
  },
};
const moduleOverrides = {
  // Bridgeless RN routes queueMicrotask/setImmediate (and so React's
  // scheduling and Promise resolution) through these native modules.
  NativeMicrotasksCxx: { queueMicrotask: cb => hostQueueMicrotask(cb) },
  NativeIdleCallbacks: {
    requestIdleCallback: cb =>
      hostSetTimeout(
        () => cb({ didTimeout: false, timeRemaining: () => 50 }),
        0
      ),
    cancelIdleCallback: id => clearTimeout(id),
  },
  Appearance: {
    getColorScheme: () => "light",
    addListener() {},
    removeListeners() {},
  },
  // RN's iOS `Alert.alert` calls `RCTAlertManager.alertWithArgs`, which is
  // this TurboModule's `alertWithArgs` (see
  // node_modules/react-native/Libraries/Alert/{Alert,RCTAlertManager.ios}.js).
  // Recorded (not just accepted) so the --token=wrong drive below can assert
  // which alert title was shown.
  AlertManager: {
    alertWithArgs: (args, callback) => {
      alerts.push({ title: args?.title, message: args?.message });
      callback?.(0, undefined);
    },
  },
  ExceptionsManager: {
    reportException: d =>
      exceptions.push({
        via: "ExceptionsManager",
        message: d?.message,
        stack: d?.stack,
      }),
    reportFatalException: (m, s) =>
      exceptions.push({
        via: "ExceptionsManager(fatal)",
        message: m,
        stack: s,
      }),
    reportSoftException: () => {},
    updateExceptionMessage: () => {},
    dismissRedbox: () => {},
  },
};
function makeModule(name) {
  const base = moduleOverrides[name] ?? {};
  return new Proxy(base, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === "getConstants") return () => constants[name] ?? {};
      if (p === "then" || typeof p !== "string") return undefined;
      if (constants[name] && p in constants[name]) return constants[name][p];
      return () => undefined;
    },
  });
}
const moduleCache = new Map();
// Modules that must look absent (dev-client / updates hosts): Expo Go's
// production path does not provide them, and faking them changes code paths.
const ABSENT = /DevLauncher|DevMenu|Updates/;
const getModule = name => {
  if (ABSENT.test(name)) return null;
  if (!moduleCache.has(name)) moduleCache.set(name, makeModule(name));
  return moduleCache.get(name);
};

// ---- Fake Expo modules (globalThis.expo). ----
class EventEmitter {
  #l = new Map();
  addListener(e, fn) {
    if (!this.#l.has(e)) this.#l.set(e, new Set());
    this.#l.get(e).add(fn);
    return { remove: () => this.#l.get(e)?.delete(fn) };
  }
  removeListener(e, fn) {
    this.#l.get(e)?.delete(fn);
  }
  removeAllListeners(e) {
    this.#l.delete(e);
  }
  emit(e, ...a) {
    for (const fn of this.#l.get(e) ?? []) fn(...a);
  }
  listenerCount(e) {
    return this.#l.get(e)?.size ?? 0;
  }
}
class SharedObject extends EventEmitter {
  release() {}
}
class SharedRef extends SharedObject {}
class NativeModule extends EventEmitter {}

// ---- Fake ExpoFetchModule: backs `expo/fetch`'s NativeRequest/NativeResponse
// (see node_modules/expo/src/winter/fetch/{fetch,NativeRequest,FetchResponse}.ts).
// `fetch()` there does `new ExpoFetchModule.NativeRequest(response)` (where
// `response` is a `FetchResponse extends ExpoFetchModule.NativeResponse`),
// then `await request.start(url, init, body)`. `FetchResponse`'s
// status/statusText/url/redirected/_rawHeaders/bodyUsed getters fall back to
// `super.<prop>` (this class), so they must be prototype getters here, not
// instance fields, or `super` would not see them. Every request gets back a
// canned 401 -- only meaningfully exercised by --token=wrong (present/absent
// never call fetch, so this never fires for them). ----
const UNAUTHORIZED_BODY = '{"error":"unauthorized"}';
const unauthorizedBodyBytes = new TextEncoder().encode(UNAUTHORIZED_BODY);
class FakeNativeResponse extends SharedObject {
  constructor() {
    super();
    this._status = 401;
    this._statusText = "Unauthorized";
    this._url = "";
    this._redirected = false;
    this._bodyUsed = false;
  }
  get status() {
    return this._status;
  }
  get statusText() {
    return this._statusText;
  }
  get url() {
    return this._url;
  }
  get redirected() {
    return this._redirected;
  }
  get _rawHeaders() {
    return [["content-type", "application/json"]];
  }
  get bodyUsed() {
    return this._bodyUsed;
  }
  async startStreaming() {
    this._bodyUsed = true;
    return unauthorizedBodyBytes;
  }
  cancelStreaming() {}
  async arrayBuffer() {
    this._bodyUsed = true;
    return unauthorizedBodyBytes.buffer;
  }
  async text() {
    this._bodyUsed = true;
    return UNAUTHORIZED_BODY;
  }
}
class FakeNativeRequest extends SharedObject {
  constructor(response) {
    super();
    this.response = response;
  }
  async start(url) {
    if (this.response) this.response._url = String(url);
    return this.response;
  }
  cancel() {}
}
// Same shape Expo Go receives from the bundle host (see the manifest's
// extra.expoClient): built from this project's app.json.
const appJson = JSON.parse(
  readFileSync(new URL("../app.json", import.meta.url), "utf-8")
);
const expoClient = { ...appJson.expo, hostUri: "127.0.0.1:8081" };
const manifest = {
  ...expoClient,
  extra: { expoClient, ...(appJson.expo.extra ?? {}) },
};
// Mutable so the --token=absent run can observe setup.tsx's real
// `saveToken()` call (via expo-secure-store's `setValueWithKeyAsync`) when it
// drives the app from Setup to Chat (see the module doc comment).
let secureStoreValue = STORED_TOKEN;
const expoOverrides = {
  ExpoSecureStore: {
    getValueWithKeyAsync: async () => secureStoreValue,
    getValueWithKeySync: () => secureStoreValue,
    // expo-secure-store calls this as (value, key, options).
    setValueWithKeyAsync: async value => {
      secureStoreValue = value;
    },
    deleteValueWithKeyAsync: async () => {
      secureStoreValue = null;
    },
  },
  ExponentConstants: {
    manifest,
    linkingUri: "exp://127.0.0.1:8081/--/",
    executionEnvironment: "storeClient",
    appOwnership: "expo",
    experienceUrl: "exp://127.0.0.1:8081",
    isDevice: true,
    statusBarHeight: 47,
    platform: {
      ios: {
        platform: "iPhone",
        model: "iPhone",
        userInterfaceIdiom: "handset",
        systemVersion: "26.0",
      },
    },
    getWebViewUserAgentAsync: async () => null,
  },
  ExpoLinking: {
    getLinkingURL: () => "exp://127.0.0.1:8081",
    addListener() {},
    removeListeners() {},
  },
  ExpoFetchModule: {
    NativeRequest: FakeNativeRequest,
    NativeResponse: FakeNativeResponse,
  },
};
const expoModules = new Proxy(
  {},
  {
    get(t, name) {
      if (typeof name !== "string" || ABSENT.test(name)) return undefined;
      if (!(name in t)) {
        const o = Object.assign(new NativeModule(), expoOverrides[name] ?? {});
        t[name] = new Proxy(o, {
          get: (x, p) => {
            if (p in x) return x[p];
            if (p === "then" || typeof p !== "string") return undefined;
            // Capitalised members of Expo modules are native classes
            // (e.g. ExpoFetchModule.NativeResponse) that JS subclasses.
            if (/^[A-Z]/.test(p)) return (x[p] = class extends SharedObject {});
            return () => undefined;
          },
        });
      }
      return t[name];
    },
  }
);

// ---- The JS global the bundle runs in. ----
const g = {
  console: {
    ...console,
    log() {},
    info() {},
    debug() {},
    warn() {},
    error: (...a) => consoleErrors.push(a.map(String).join(" ")),
  },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  clearImmediate,
  queueMicrotask,
  requestAnimationFrame: cb => hostSetTimeout(() => cb(performance.now()), 0),
  cancelAnimationFrame: clearTimeout,
  requestIdleCallback: cb =>
    hostSetTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0),
  cancelIdleCallback: clearTimeout,
  performance,
  nativePerformanceNow: () => performance.now(),
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  AbortController,
  AbortSignal,
  Headers,
  Request,
  Response,
  FormData,
  Blob,
  Event,
  EventTarget,
  // No network in the smoke run: the first screen must not depend on it.
  fetch: () => Promise.reject(new Error("runtime-smoke: network disabled")),
  RN$Bridgeless: true,
  RN$registerCallableModule: () => {},
  RN$handleException: (e, isFatal) => {
    // Non-fatal (soft) errors are only logged in a production app; only a
    // fatal one produces Expo Go's "There was a problem running" screen.
    if (!isFatal) {
      softErrors.push(String(e?.message ?? e));
      return true;
    }
    exceptions.push({
      via: `RN$handleException(fatal=${isFatal})`,
      message: String(e?.message ?? e),
      stack: e?.stack,
    });
    return true;
  },
  __turboModuleProxy: name => getModule(name),
  nativeModuleProxy: new Proxy(
    {},
    { get: (t, p) => (typeof p === "string" ? getModule(p) : undefined) }
  ),
  nativeFabricUIManager: fabricProxy,
  expo: {
    modules: expoModules,
    EventEmitter,
    SharedObject,
    SharedRef,
    NativeModule,
    uuidv4: () => "0",
    uuidv5: () => "0",
  },
};
// Run in this (dedicated) process's own realm rather than a vm context:
// RN/Expo install globals with Object.defineProperty getters (e.g. the lazy
// `fetch` polyfill), which a contextified vm global does not honour.
for (const [k, v] of Object.entries(g)) {
  Object.defineProperty(globalThis, k, {
    value: v,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}
globalThis.global = globalThis;
globalThis.window = globalThis;
globalThis.self = globalThis;
delete globalThis.navigator;

process.on("uncaughtException", e =>
  exceptions.push({
    via: "uncaught",
    message: String(e?.message ?? e),
    stack: e?.stack,
  })
);
process.on("unhandledRejection", e =>
  exceptions.push({
    via: "unhandledRejection",
    message: String(e?.message ?? e),
    stack: e?.stack,
  })
);

try {
  vm.runInThisContext(readFileSync(bundlePath, "utf-8"), {
    filename: "bundle.js",
  });
  globalThis.RN$AppRegistry.runApplication("main", {
    rootTag: 1,
    initialProps: {},
    fabric: true,
  });
} catch (e) {
  exceptions.push({
    via: "startup",
    message: String(e?.message ?? e),
    stack: e?.stack,
  });
}

await new HostPromise(r => hostSetTimeout(r, 1500));

// ---- Report. ----
// Walks the committed (fake) native tree, collecting rendered text, native
// Stack header configs, and (keyed by the nearest enclosing handler) which
// on-screen text a real `onClick` (from react-native's Pressability, wired
// up by Touchables) belongs to, plus any text-input-like host nodes (their
// `onChange` is TextInput's real handler, which calls the component's
// `onChangeText`). Called more than once by the --token=absent flow below,
// since typing and pressing "Continue" each cause a fresh commit.
function collectTree() {
  const texts = [];
  const headers = [];
  const pressables = []; // [{ node, texts: [...] }] - node.instanceHandle to dispatch a tap
  const textInputs = [];
  const walk = (n, ancestorPressable) => {
    if (!n) return;
    // A Fabric host node's committed props never carry the JS handler
    // function for a native event, only `true` (native is just told a
    // listener exists); see the module doc comment. `onClick` here comes
    // from Pressability's responderEventHandlers (TouchableOpacity etc).
    const pressable = n.props?.onClick === true ? n : ancestorPressable;
    if (n.viewName === "RCTRawText" && n.props?.text) {
      texts.push(n.props.text);
      if (pressable) {
        let entry = pressables.find(p => p.node === pressable);
        if (!entry) {
          entry = { node: pressable, texts: [] };
          pressables.push(entry);
        }
        entry.texts.push(n.props.text);
      }
    }
    if (n.viewName === "RNSScreenStackHeaderConfig")
      headers.push({ title: n.props.title, hidden: n.props.hidden ?? false });
    if (n.props?.onChange === true && /TextInput/i.test(n.viewName ?? ""))
      textInputs.push(n);
    n.children?.forEach(c => walk(c, pressable));
  };
  (roots.get(1) ?? []).forEach(n => walk(n, null));
  return { texts, headers, pressables, textInputs };
}

const expectedScreen = STORED_TOKEN ? "Chat" : "Setup";
const first = collectTree();
log(`bundle: ${bundlePath}`);
log(`stored token: ${tokenArg}; expected first screen: ${expectedScreen}`);
log(`rendered text: ${JSON.stringify([...new Set(first.texts)])}`);
log(`native stack headers: ${JSON.stringify(first.headers)}`);

const rendered = first.texts.length > 0;
const reachedFirstScreen =
  first.texts.some(t => t.includes(expectedScreen)) ||
  first.headers.some(h => h.title === expectedScreen);

// ---- M1-C12: token-absent run also drives Setup -> Chat, the way a
// first-time user does, and checks RootLayout's screen options (headerShown
// etc.) apply on that path too, not only on the initial-launch redirect. ----
let driveToChat = null;
if (tokenArg === "absent" && exceptions.length === 0 && reachedFirstScreen) {
  const tokenInput = first.textInputs[0];
  if (!tokenInput) {
    driveToChat = { ok: false, reason: "Setup's token TextInput not found in the rendered tree" };
  } else {
    // Dispatch the native `topChange` event TextInput's underlying view
    // sends on every keystroke (RCTTextInputViewConfig's bubblingEventTypes;
    // TextInput's `_onChange` reads `nativeEvent.text`/`.eventCount`).
    dispatchFabricEvent?.(tokenInput.instanceHandle, "topChange", {
      text: "smoke-test-token",
      eventCount: 1,
      target: tokenInput.tag,
    });
    await new HostPromise(r => hostSetTimeout(r, 300));
    const afterType = collectTree();
    const continueButton = afterType.pressables.find(p =>
      p.texts.some(t => t.includes("Continue"))
    );
    if (!continueButton) {
      driveToChat = {
        ok: false,
        reason: "Continue button's onClick not found after typing a token",
      };
    } else {
      // Dispatch the native `topClick` event a real tap sends (View's base
      // config; Pressability's onClick handler calls onPress from it). No
      // `pointerType` on the payload, so Pressability doesn't ignore it as a
      // duplicate PointerEvent-based tap, and dispatching straight at this
      // node's own instance (not a nested pressable's) keeps
      // `currentTarget === target`.
      dispatchFabricEvent?.(continueButton.node.instanceHandle, "topClick", {});
      await new HostPromise(r => hostSetTimeout(r, 1500));
      const afterPress = collectTree();
      const chatMounted = afterPress.texts.includes("Chat");
      const backOnSetup = afterPress.texts.some(t =>
        t.includes("Enter Bearer Token")
      );
      const singleTopBar = afterPress.headers.some(h => h.hidden === true);
      driveToChat = {
        ok:
          exceptions.length === 0 &&
          chatMounted &&
          !backOnSetup &&
          singleTopBar,
        chatMounted,
        backOnSetup,
        singleTopBar,
        rendered_text: [...new Set(afterPress.texts)],
        native_stack_headers: afterPress.headers,
      };
    }
  }
  log(`drive Setup -> Chat: ${JSON.stringify(driveToChat)}`);
}

// ---- M1-C15 (FR13): token-wrong run drives Chat's Send button while every
// request 401s, proving chat.tsx's onUnauthorized wiring (not just
// chatController's unit-tested logic) in a real bundle -- the alert shown,
// and navigation to Settings with the token form already open. ----
let driveChat401 = null;
if (tokenArg === "wrong" && exceptions.length === 0 && reachedFirstScreen) {
  const messageInput = first.textInputs[0];
  if (!messageInput) {
    driveChat401 = {
      ok: false,
      reason: "Chat's message TextInput not found in the rendered tree",
    };
  } else {
    // Same mechanism as the Setup -> Chat drive above: dispatch the native
    // `topChange` a keystroke sends, then find "Send"'s onClick (only
    // present once typing enables the button) and dispatch the native
    // `topClick` a tap sends.
    dispatchFabricEvent?.(messageInput.instanceHandle, "topChange", {
      text: "hello",
      eventCount: 1,
      target: messageInput.tag,
    });
    await new HostPromise(r => hostSetTimeout(r, 300));
    const afterType = collectTree();
    const sendButton = afterType.pressables.find(p =>
      p.texts.some(t => t.includes("Send"))
    );
    if (!sendButton) {
      driveChat401 = {
        ok: false,
        reason: "Send button's onClick not found after typing a message",
      };
    } else {
      dispatchFabricEvent?.(sendButton.node.instanceHandle, "topClick", {});
      await new HostPromise(r => hostSetTimeout(r, 1500));
      const afterPress = collectTree();
      const texts = afterPress.texts;
      const wrongAlertShown = alerts.some(
        a => a.title === "Password wrong or changed"
      );
      const errorAlertShown = alerts.some(a => a.title === "Error");
      const settingsMounted =
        texts.some(t => t.includes("Bearer Token")) &&
        texts.some(t => t.includes("Save")) &&
        !texts.some(t => t.includes("Update Token"));
      driveChat401 = {
        ok:
          exceptions.length === 0 &&
          wrongAlertShown &&
          !errorAlertShown &&
          settingsMounted,
        wrongAlertShown,
        errorAlertShown,
        settingsMounted,
        alerts,
        rendered_text: [...new Set(texts)],
      };
    }
  }
  log(`drive Chat 401 -> Settings: ${JSON.stringify(driveChat401)}`);
}

for (const e of exceptions) {
  log(`JS EXCEPTION via ${e.via}: ${e.message}`);
  if (e.stack) log(String(e.stack).split("\n").slice(0, 6).join("\n"));
}
for (const e of softErrors)
  log(`non-fatal (logged only): ${e.split("\n")[0].slice(0, 160)}`);
for (const e of consoleErrors)
  log(`console.error: ${e.split("\n")[0].slice(0, 160)}`);
log(`root commits: ${commits}`);

const pass =
  exceptions.length === 0 &&
  rendered &&
  reachedFirstScreen &&
  (driveToChat === null || driveToChat.ok === true) &&
  (driveChat401 === null || driveChat401.ok === true);
if (pass) {
  log(
    `RESULT: PASS (app launched, ${expectedScreen} rendered, no JS exception${
      driveToChat ? ", Setup -> Chat drive reached Chat with one top bar" : ""
    }${
      driveChat401
        ? ", Chat 401 drive reached Settings with the token form open"
        : ""
    })`
  );
  process.exit(0);
}
log(
  `RESULT: FAIL (exceptions=${exceptions.length}, rendered=${rendered}, reached ${expectedScreen}=${reachedFirstScreen}${
    driveToChat ? `, driveToChat.ok=${driveToChat.ok}` : ""
  }${driveChat401 ? `, driveChat401.ok=${driveChat401.ok}` : ""})`
);
process.exit(1);
