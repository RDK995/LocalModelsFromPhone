#!/bin/bash
# Configure Tailscale Serve for the phone-models server (C10)
#
# Adds exactly one mapping, persistent in the background:
#   tailnet HTTPS :8443  ->  http://127.0.0.1:7789
#
# Tailnet only: never enables Funnel. Never runs `tailscale serve reset` and never
# removes or edits any other mapping (e.g. the existing :443 `/` and `/app`
# handlers). Idempotent: if the mapping is already present it does nothing.
# Refuses to overwrite :8443 if it is already mapped to something else.

set -euo pipefail

HTTPS_PORT=8443
TARGET="http://127.0.0.1:7789"
TAILSCALE="${TAILSCALE:-tailscale}"
BUN="${BUN:-/opt/homebrew/bin/bun}"

if ! command -v "$TAILSCALE" &> /dev/null; then
  echo "Error: tailscale CLI not found. Install Tailscale first."
  exit 1
fi
if [[ ! -x "$BUN" ]] && ! command -v "$BUN" &> /dev/null; then
  echo "Error: bun not found at $BUN (used to read tailscale serve status)"
  exit 1
fi

# Inspect the serve config (JSON on stdin). Prints one of:
#   present   - :$HTTPS_PORT "/" already proxies to $TARGET
#   absent    - nothing is served on :$HTTPS_PORT
#   conflict:<detail> - :$HTTPS_PORT is used for something else
#   funnel    - Funnel is enabled somewhere (refuse to touch the config)
# Also prints "others:<stable JSON of every other Web/TCP entry>" on a 2nd line.
inspect_status() {
  "$BUN" -e '
    const port = process.argv[1], target = process.argv[2];
    const raw = await Bun.stdin.text();
    const cfg = raw.trim() ? JSON.parse(raw) : {};
    const web = cfg.Web ?? {}, tcp = cfg.TCP ?? {};
    const funnel = Object.values(cfg.AllowFunnel ?? {}).some(Boolean);
    const key = Object.keys(web).find((k) => k.endsWith(":" + port));
    let state;
    if (funnel) state = "funnel";
    else if (!key && !tcp[port]) state = "absent";
    else {
      const handlers = key ? web[key].Handlers ?? {} : {};
      const paths = Object.keys(handlers);
      const ok = tcp[port]?.HTTPS === true && paths.length === 1 &&
        paths[0] === "/" && handlers["/"].Proxy === target;
      state = ok ? "present" : "conflict:" + JSON.stringify({ tcp: tcp[port] ?? null, handlers });
    }
    const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
    const others = {
      Web: Object.fromEntries(Object.entries(web).filter(([k]) => k !== key)),
      TCP: Object.fromEntries(Object.entries(tcp).filter(([k]) => k !== port)),
    };
    console.log(state);
    console.log("others:" + JSON.stringify(sortKeys(others)));
  ' "$HTTPS_PORT" "$TARGET"
}

BEFORE="$("$TAILSCALE" serve status --json | inspect_status)"
BEFORE_STATE="$(echo "$BEFORE" | sed -n 1p)"
BEFORE_OTHERS="$(echo "$BEFORE" | sed -n 2p)"

case "$BEFORE_STATE" in
  present)
    echo "Tailscale Serve already maps tailnet HTTPS :$HTTPS_PORT -> $TARGET; nothing to do."
    exit 0
    ;;
  absent)
    ;;
  funnel)
    echo "Error: Tailscale Funnel is enabled on this node; refusing to change Serve config."
    exit 1
    ;;
  conflict:*)
    echo "Error: tailnet :$HTTPS_PORT is already in use by a different mapping; not overwriting."
    echo "       ${BEFORE_STATE#conflict:}"
    exit 1
    ;;
  *)
    echo "Error: could not read tailscale serve status (got: $BEFORE_STATE)"
    exit 1
    ;;
esac

echo "Adding Tailscale Serve mapping: tailnet HTTPS :$HTTPS_PORT -> $TARGET (background, tailnet only)"
"$TAILSCALE" serve --bg --https="$HTTPS_PORT" "$TARGET"

AFTER="$("$TAILSCALE" serve status --json | inspect_status)"
AFTER_STATE="$(echo "$AFTER" | sed -n 1p)"
AFTER_OTHERS="$(echo "$AFTER" | sed -n 2p)"

if [[ "$AFTER_STATE" != "present" ]]; then
  echo "Error: mapping not present after configuration (state: $AFTER_STATE)"
  exit 1
fi
if [[ "$AFTER_OTHERS" != "$BEFORE_OTHERS" ]]; then
  echo "Error: other Serve mappings changed unexpectedly."
  echo "  before: $BEFORE_OTHERS"
  echo "  after:  $AFTER_OTHERS"
  exit 1
fi

echo "Tailscale Serve configured: https://<mac-tailnet-name>:$HTTPS_PORT -> $TARGET"
echo "Other Serve mappings unchanged. Access is restricted to your tailnet (no Funnel)."
"$TAILSCALE" serve status
exit 0
