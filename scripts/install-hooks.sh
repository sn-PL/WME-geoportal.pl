#!/usr/bin/env bash
# scripts/install-hooks.sh — install repo-managed githooks via core.hooksPath
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.githooks"
if [ ! -d "$HOOKS_DIR" ]; then
  echo "No .githooks dir found at $HOOKS_DIR" >&2
  exit 1
fi
git -C "$REPO_ROOT" config core.hooksPath .githooks
echo "✓ git core.hooksPath → .githooks"
echo "  Active hooks:"
ls -l "$HOOKS_DIR" | sed 's/^/    /'
echo ""
echo "To bypass once: git commit --no-verify"
