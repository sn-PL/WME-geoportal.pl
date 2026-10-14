#!/usr/bin/env bash
# scripts/update-wme-sdk-typings.sh
# Ensures local wme-sdk-typings.tgz is in sync with remote production SDK.
# Usage:
#   ./scripts/update-wme-sdk-typings.sh           # update if outdated (default)
#   ./scripts/update-wme-sdk-typings.sh --check   # exit 0 if up-to-date, 1 if outdated (CI-friendly)
#   ./scripts/update-wme-sdk-typings.sh --force   # force re-download
#   ./scripts/update-wme-sdk-typings.sh --verbose # detailed version diff
# Env:
#   REMOTE_URL / LOCAL_FILE can be overridden
set -euo pipefail

REMOTE_URL="${REMOTE_URL:-https://web-assets.waze.com/wme_sdk_docs/production/latest/wme-sdk-typings.tgz}"
LOCAL_FILE="${LOCAL_FILE:-wme-sdk-typings.tgz}"
# Resolve repo root (script is in scripts/)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$LOCAL_FILE" != /* ]]; then
  LOCAL_FILE="$REPO_ROOT/$LOCAL_FILE"
fi

CHECK_ONLY=false
FORCE=false
VERBOSE=false
for arg in "$@"; do
  case "$arg" in
    --check|--check-only) CHECK_ONLY=true ;;
    --force|-f) FORCE=true ;;
    --verbose|-v) VERBOSE=true ;;
    --help|-h)
      echo "Usage: $0 [--check] [--force] [--verbose]"
      echo "  --check   fail if local is outdated (for CI / pre-commit)"
      echo "  --force   re-download even if cached ETag matches"
      echo "  --verbose show version diff from package.json inside tgz"
      exit 0
      ;;
  esac
done

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }; }
need_cmd curl
need_cmd tar
need_cmd cmp
need_cmd mktemp

TMP_FILE="$(mktemp)"
TMP_HDR="$(mktemp)"
cleanup() { rm -f "$TMP_FILE" "$TMP_HDR"; }
trap cleanup EXIT

echo "→ Fetching remote SDK typings…" >&2
echo "  $REMOTE_URL" >&2
# Use curl with fail, follow redirects, show progress on verbose
CURL_OPTS=("-sL" "--fail" "--retry" "2" "--connect-timeout" "15")
if $VERBOSE; then CURL_OPTS=("-L" "--fail" "--retry" "2"); fi
if ! curl "${CURL_OPTS[@]}" "$REMOTE_URL" -o "$TMP_FILE" -D "$TMP_HDR" 2>&1; then
  echo "⚠ Network unavailable — cannot verify remote typings (checked $REMOTE_URL)" >&2
  echo "  Skipping freshness check (offline mode). Run again when online." >&2
  # Don't block commits when offline — exit 0
  exit 0
fi

if [ ! -s "$TMP_FILE" ]; then
  echo "✗ Downloaded file empty" >&2
  exit 2
fi

# Quick tgz sanity check
if ! tar -tzf "$TMP_FILE" >/dev/null 2>&1; then
  echo "✗ Downloaded file is not a valid tgz" >&2
  exit 2
fi

get_version() {
  local f="$1"
  tar -xzf "$f" -O package/package.json 2>/dev/null | grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown"
}

REMOTE_VER="$(get_version "$TMP_FILE")"
LOCAL_VER="none"
if [ -f "$LOCAL_FILE" ]; then
  LOCAL_VER="$(get_version "$LOCAL_FILE" 2>/dev/null || echo "invalid")"
else
  LOCAL_VER="(missing)"
fi

REMOTE_SHA="$(sha256sum "$TMP_FILE" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$TMP_FILE" | cut -d' ' -f1 || echo "unknown")"
LOCAL_SHA="none"
if [ -f "$LOCAL_FILE" ]; then
  LOCAL_SHA="$(sha256sum "$LOCAL_FILE" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$LOCAL_FILE" | cut -d' ' -f1 || echo "unknown")"
fi

if $VERBOSE; then
  echo "  Remote version: $REMOTE_VER  sha256: ${REMOTE_SHA:0:12}…"
  echo "  Local  version: $LOCAL_VER  sha256: ${LOCAL_SHA:0:12}…"
fi

if [ "$REMOTE_SHA" = "$LOCAL_SHA" ] && [ "$FORCE" = false ]; then
  if $VERBOSE || ! $CHECK_ONLY; then echo "✓ wme-sdk-typings.tgz is up-to-date ($REMOTE_VER)" >&2; fi
  exit 0
fi

if $CHECK_ONLY; then
  echo "✗ wme-sdk-typings.tgz is OUTDATED" >&2
  echo "  Local:  $LOCAL_VER ($LOCAL_SHA)" >&2
  echo "  Remote: $REMOTE_VER ($REMOTE_SHA)" >&2
  echo "" >&2
  echo "Fix: run ./scripts/update-wme-sdk-typings.sh  (or: make update-typings)" >&2
  echo "     git add wme-sdk-typings.tgz && git commit" >&2
  exit 1
fi

# Update
echo "→ Updating $LOCAL_FILE ($LOCAL_VER → $REMOTE_VER)…" >&2
cp -f "$TMP_FILE" "$LOCAL_FILE"
if $VERBOSE; then ls -lh "$LOCAL_FILE" >&2; fi
echo "✓ Updated $LOCAL_FILE to $REMOTE_VER" >&2
# Optional: ensure file is tracked
if git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git -C "$REPO_ROOT" check-ignore -q "$LOCAL_FILE" 2>/dev/null; then
    echo "⚠ $LOCAL_FILE is gitignored — add !wme-sdk-typings.tgz to .gitignore to track it" >&2
  fi
fi
