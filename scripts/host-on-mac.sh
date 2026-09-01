#!/usr/bin/env bash
# Run Cartwise permanently on a Mac (e.g. the mac-mini), reachable from every
# device on your tailnet over HTTPS.
#
# Run this ON the host machine, not from another computer:
#   curl -fsSL https://raw.githubusercontent.com/tateo12/cartwise/main/scripts/host-on-mac.sh | bash
set -euo pipefail

REPO="https://github.com/tateo12/cartwise.git"
DIR="$HOME/cartwise"

echo "==> Checking prerequisites"
# The database is `node:sqlite`, added in Node 22.5.0. That is the real floor.
# It matters on older Macs: Node 24's prebuilt binaries need macOS 13.5+, while
# Node 22 supports macOS 11+, so Monterey hosts should install 22 rather than 24.
node_ok=0
if command -v node >/dev/null; then
  ver=$(node -v | cut -c2-)
  major=$(echo "$ver" | cut -d. -f1)
  minor=$(echo "$ver" | cut -d. -f2)
  if [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 5 ]; }; then node_ok=1; fi
fi
if [ "$node_ok" -ne 1 ]; then
  echo "    Node 22.5+ required (found: $(node -v 2>/dev/null || echo none))."
  echo "    On macOS 13.5 or newer: install Node 24 from https://nodejs.org"
  echo "    On macOS 12 or older:   install Node 22 LTS from https://nodejs.org/en/download"
  echo "    Do NOT use 'brew install node' on older macOS: with no bottle available"
  echo "    it compiles node, llvm and cmake from source, which takes hours."
  exit 1
fi
command -v bun >/dev/null || { echo "    Installing bun"; curl -fsSL https://bun.sh/install | bash; export PATH="$HOME/.bun/bin:$PATH"; }

echo "==> Fetching code"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  # The repo is private, so an unauthenticated clone fails with a confusing
  # "repository not found". Say what is actually wrong.
  git clone "$REPO" "$DIR" || {
    echo "    Clone failed. This repo is private, so authenticate first:"
    echo "      gh auth login && gh repo clone tateo12/cartwise $DIR"
    exit 1
  }
fi
cd "$DIR"

echo "==> Building"
bun install --frozen-lockfile
bun run build

echo "==> Starting on port 3000"
# Keep the database beside the checkout so a rebuild never touches it.
export CARTWISE_DB="$DIR/cartwise.db"
bun run start &
sleep 4

echo "==> Publishing over Tailscale with HTTPS"
# `tailscale serve` gives a real certificate and a stable name, so no ports or
# IP addresses to remember, and nothing is exposed to the public internet.
TS=$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)
"$TS" serve --bg 3000 || echo "    Could not auto-publish. Run manually: tailscale serve --bg 3000"

echo
echo "Done. Open this on your phone:"
"$TS" status --json | python3 -c "import sys,json; print('    https://' + json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))" 2>/dev/null \
  || echo "    https://<this-machine>.<your-tailnet>.ts.net"
