#!/usr/bin/env bash
# 把 workbuddy-patch 应用到干净的 Sub2API v0.1.175 检出。
set -euo pipefail

DEST="${1:?usage: apply.sh <dest-dir> [tag]}"
TAG="${2:-v0.1.175}"
REPO_URL="${REPO_URL:-https://github.com/Wei-Shaw/sub2api.git}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH="$SCRIPT_DIR/workbuddy-patch.diff"

[ -f "$PATCH" ] || { echo "patch not found: $PATCH" >&2; exit 1; }

if [ ! -d "$DEST/.git" ]; then
  echo "cloning $TAG into $DEST ..."
  git clone --depth 1 --branch "$TAG" "$REPO_URL" "$DEST"
fi

cd "$DEST"
git switch -c workbuddy-patch 2>/dev/null || true
git apply --check "$PATCH"
git apply "$PATCH"
echo "patch applied. build with: cd backend && go build ./..."
