# Shared helpers for the macOS install / update / uninstall scripts. Sourced, not executed.
set -euo pipefail

APP_NAME="Plexus"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOGDIR="$HOME/Library/Logs/Plexus"
mkdir -p "$LOGDIR"

c_bold=$'\033[1m'; c_dim=$'\033[2m'; c_red=$'\033[31m'; c_grn=$'\033[32m'; c_off=$'\033[0m'
say()  { printf '%s▸%s %s\n' "$c_bold" "$c_off" "$*"; }
ok()   { printf '%s✓%s %s\n' "$c_grn" "$c_off" "$*"; }
die()  { printf '%s✗ %s%s\n' "$c_red" "$*" "$c_off" >&2; exit 1; }

# Plexus needs Node >= 22.13 (stable node:sqlite).
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v major minor
  v="$(node -v | sed 's/^v//')"; major="${v%%.*}"; minor="$(echo "$v" | cut -d. -f2)"
  [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 13 ]; }
}

check_prereqs() {
  if [ "$(uname -s)" != "Darwin" ] && [ -z "${PLEXUS_ALLOW_NON_MAC:-}" ]; then die "This installer is for macOS."; fi
  command -v git >/dev/null 2>&1 || die "git is required. Install the Xcode command line tools:  xcode-select --install"
  command -v npm >/dev/null 2>&1 || die "npm is required. Install Node 22+:  brew install node"
  node_ok || die "Node 22.13 or newer is required (found: $(node -v 2>/dev/null || echo none)). Install it with:  brew install node   (or use nvm)"
  [ -d "$REPO/.git" ] || die "$REPO is not a git checkout, so updates would not work. Clone the repository and run the installer from there."
}

# Where the finished app goes: /Applications if we can write there, otherwise ~/Applications.
install_dir() {
  if [ -w /Applications ]; then echo "/Applications"; else mkdir -p "$HOME/Applications"; echo "$HOME/Applications"; fi
}

# The installed app reads this to find system Node (GUI apps don't inherit your shell PATH) and its own source folder (for updates).
write_config() {
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({ node: process.argv[2], repo: process.argv[3], builtAt: new Date().toISOString() }, null, 2));
  ' "$REPO/config.json" "$(command -v node)" "$REPO"
}

build_everything() {
  say "Installing dependencies (first run downloads Electron, ~100 MB)…"
  (cd "$REPO" && npm install --no-audit --no-fund) >>"$LOGDIR/install.log" 2>&1 || die "npm install failed. See $LOGDIR/install.log"
  say "Building the app…"
  (cd "$REPO" && npm run build) >>"$LOGDIR/install.log" 2>&1 || die "Build failed. See $LOGDIR/install.log"
  write_config
  say "Packaging Plexus.app…"
  (cd "$REPO" && rm -rf release && npm run build:app) >>"$LOGDIR/install.log" 2>&1 || die "Packaging failed. See $LOGDIR/install.log"
}

# electron-builder puts the result in release/mac or release/mac-arm64 depending on the CPU.
built_app() { ls -d "$REPO"/release/mac*/"$APP_NAME.app" 2>/dev/null | head -1; }

# Apple Silicon refuses unsigned code, so give the local build an ad-hoc signature. No Apple Developer account needed.
sign_adhoc() {
  local app="$1"
  xattr -cr "$app" 2>/dev/null || true
  codesign --force --deep --sign - "$app" >>"$LOGDIR/install.log" 2>&1 || say "${c_dim}(ad-hoc signing reported a problem; the app may still run. See install.log)${c_off}"
}

quit_app() {
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  local i=0
  while pgrep -x "$APP_NAME" >/dev/null 2>&1 && [ $i -lt 40 ]; do sleep 0.25; i=$((i+1)); done
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
}

place_app() {
  local built dest
  built="$(built_app)"; [ -n "$built" ] || die "Could not find the built app in $REPO/release"
  dest="$(install_dir)/$APP_NAME.app"
  sign_adhoc "$built"
  quit_app
  rm -rf "$dest"
  ditto "$built" "$dest"
  ok "Installed $dest"
  echo "$dest"
}
