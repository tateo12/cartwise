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
# node:sqlite is a Node 24 built-in, so 24 is a hard floor, not a preference.
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 24 ]; then
  echo "    Node 24+ required. Install with: brew install node"
  exit 1
fi
command -v bun >/dev/null || { echo "    Installing bun"; curl -fsSL https://bun.sh/install | bash; export PATH="$HOME/.bun/bin:$PATH"; }

echo "==> Fetching code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi
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
