#!/bin/bash
# Retire the old phoneToLocalModel PWA (C9, FR17)
#
# Removes ONLY the :443 "/app" Tailscale Serve handler -- never `tailscale
# serve reset`, never touches "/" on :443 or anything on :8443, never enables
# Funnel -- and unloads + archives the com.ryankenny.phone-pwa LaunchAgent.
# The agent has KeepAlive=true, so `launchctl bootout` is used (a signal is
# not enough; launchd would just restart it).
#
# Before changing anything, backs up the LaunchAgent plist and the current
# `tailscale serve status --json` to ~/.phone-models/retired-pwa/, so the
# retirement can always be undone. Never overwrites an existing backup.
#
# Idempotent: safe to run more than once. A second run reports "already
# retired" for each part and exits 0.
#
# Never touches /Users/ryankenny/Projects/phoneToLocalModel (no writes, no
# git commands against it). Never uses sudo.

set -euo pipefail

TAILSCALE="${TAILSCALE:-tailscale}"
BUN="${BUN:-/opt/homebrew/bin/bun}"
UIDN="$(id -u)"
LABEL="com.ryankenny.phone-pwa"
HTTPS_PORT=443
SERVE_PATH="/app"
PLIST_SRC="$HOME/Library/LaunchAgents/$LABEL.plist"
BACKUP_DIR="$HOME/.phone-models/retired-pwa"
PREFLIGHT_PLIST_BACKUP="$BACKUP_DIR/$LABEL.plist.backup"
FINAL_PLIST="$BACKUP_DIR/$LABEL.plist"

if ! command -v "$TAILSCALE" &> /dev/null; then
  echo "Error: tailscale CLI not found."
  exit 1
fi
if [[ ! -x "$BUN" ]] && ! command -v "$BUN" &> /dev/null; then
  echo "Error: bun not found at $BUN (used to read tailscale serve status)"
  exit 1
fi

# Reads a serve-status JSON document on stdin and prints one line:
#   present / absent  -- whether :443 has a Handlers["/app"] entry
app_handler_state() {
  "$BUN" -e '
    const raw = await Bun.stdin.text();
    const cfg = raw.trim() ? JSON.parse(raw) : {};
    const web = cfg.Web ?? {};
    const key = Object.keys(web).find((k) => k.endsWith(":443"));
    const present = !!(key && web[key].Handlers && web[key].Handlers["/app"]);
    console.log(present ? "present" : "absent");
  '
}

# Reads a serve-status JSON document on stdin and prints one line: whether
# :443 has a Handlers["/"] entry ("present"/"absent").
root_handler_state() {
  "$BUN" -e '
    const raw = await Bun.stdin.text();
    const cfg = raw.trim() ? JSON.parse(raw) : {};
    const web = cfg.Web ?? {};
    const key = Object.keys(web).find((k) => k.endsWith(":443"));
    const present = !!(key && web[key].Handlers && web[key].Handlers["/"]);
    console.log(present ? "present" : "absent");
  '
}

# Prints the Proxy target of :443 "/app" from a serve-status JSON document on
# stdin (empty string if absent).
app_handler_target() {
  "$BUN" -e '
    const raw = await Bun.stdin.text();
    const cfg = raw.trim() ? JSON.parse(raw) : {};
    const web = cfg.Web ?? {};
    const key = Object.keys(web).find((k) => k.endsWith(":443"));
    const target = key && web[key].Handlers && web[key].Handlers["/app"]
      ? web[key].Handlers["/app"].Proxy ?? "" : "";
    console.log(target);
  '
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# --- Step 1: pre-flight backup, before changing anything -----------------
# Never overwritten: if it already exists (e.g. a previous run), this whole
# step is skipped.
if [[ -f "$PREFLIGHT_PLIST_BACKUP" ]]; then
  echo "already retired: pre-flight backup already exists at $PREFLIGHT_PLIST_BACKUP"
else
  if [[ -f "$PLIST_SRC" ]]; then
    cp "$PLIST_SRC" "$PREFLIGHT_PLIST_BACKUP"
    echo "Backed up plist: $PLIST_SRC -> $PREFLIGHT_PLIST_BACKUP"
  else
    echo "Note: $PLIST_SRC not present; nothing to back up there."
  fi
  STATUS_TS="$(date -u +%Y%m%dT%H%M%SZ)"
  STATUS_BACKUP="$BACKUP_DIR/tailscale-serve-status-$STATUS_TS.json"
  "$TAILSCALE" serve status --json > "$STATUS_BACKUP"
  echo "Backed up tailscale serve status --json: $STATUS_BACKUP"
fi

# --- Step 2: remove ONLY the :443 /app Serve handler ----------------------
APP_STATE_BEFORE="$("$TAILSCALE" serve status --json | app_handler_state)"
if [[ "$APP_STATE_BEFORE" == "absent" ]]; then
  echo "already retired: :443 $SERVE_PATH Serve handler"
else
  echo "Removing :443 $SERVE_PATH Serve handler..."
  "$TAILSCALE" serve --https="$HTTPS_PORT" --set-path="$SERVE_PATH" off
  APP_STATE_AFTER="$("$TAILSCALE" serve status --json | app_handler_state)"
  if [[ "$APP_STATE_AFTER" != "absent" ]]; then
    echo "Error: :443 $SERVE_PATH handler still present after removal attempt."
    exit 1
  fi
  echo "Removed :443 $SERVE_PATH Serve handler."
fi

# Safety check: "/" on :443 must never be touched by this script.
ROOT_STATE="$("$TAILSCALE" serve status --json | root_handler_state)"
if [[ "$ROOT_STATE" != "present" ]]; then
  echo "Error: :443 / handler is missing after the Serve change; refusing to continue."
  exit 1
fi

# --- Step 3: unload and archive the LaunchAgent ---------------------------
if launchctl print "gui/$UIDN/$LABEL" &> /dev/null; then
  echo "Unloading LaunchAgent $LABEL..."
  launchctl bootout "gui/$UIDN/$LABEL"
  echo "Unloaded LaunchAgent $LABEL."
else
  echo "already retired: LaunchAgent $LABEL is not loaded"
fi

if [[ -f "$PLIST_SRC" ]]; then
  if [[ -f "$FINAL_PLIST" ]]; then
    echo "Error: $FINAL_PLIST already exists; refusing to overwrite an existing backup."
    echo "       $PLIST_SRC was left in place; move it manually."
    exit 1
  fi
  mv "$PLIST_SRC" "$FINAL_PLIST"
  echo "Moved plist: $PLIST_SRC -> $FINAL_PLIST"
else
  echo "already retired: plist not present at $PLIST_SRC"
fi

# --- Undo commands ---------------------------------------------------------
# The original /app target is read from whichever plist backup exists
# (the archived original, or -- on the very first run before Step 3 moved it
# -- the pre-flight copy), falling back to the pre-retirement serve-status
# backup.
APP_TARGET=""
STATUS_BACKUP_FILE="$(ls "$BACKUP_DIR"/tailscale-serve-status-*.json 2>/dev/null | sort | head -1)"
if [[ -n "$STATUS_BACKUP_FILE" ]]; then
  APP_TARGET="$(app_handler_target < "$STATUS_BACKUP_FILE")"
fi
RESTORE_PLIST_SRC="$FINAL_PLIST"
if [[ ! -f "$RESTORE_PLIST_SRC" && -f "$PREFLIGHT_PLIST_BACKUP" ]]; then
  RESTORE_PLIST_SRC="$PREFLIGHT_PLIST_BACKUP"
fi

echo ""
echo "To undo this retirement:"
echo "  cp \"$RESTORE_PLIST_SRC\" \"$PLIST_SRC\""
echo "  launchctl bootstrap gui/$UIDN \"$PLIST_SRC\""
if [[ -n "$APP_TARGET" ]]; then
  echo "  $TAILSCALE serve --bg --https=$HTTPS_PORT --set-path=$SERVE_PATH $APP_TARGET"
else
  echo "  (could not read the original $SERVE_PATH target from the backup; inspect $BACKUP_DIR)"
fi

exit 0
