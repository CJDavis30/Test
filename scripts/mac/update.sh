#!/bin/bash
# Pulls the latest Plexus, rebuilds, replaces the installed app, and (with --relaunch) reopens it.
# Run by hand, or by the app's "Check for Updates…" menu item. If anything fails the existing app is left in place.
source "$(dirname "$0")/common.sh"

RELAUNCH=0
for a in "$@"; do [ "$a" = "--relaunch" ] && RELAUNCH=1; done
exec > >(tee -a "$LOGDIR/update.log") 2>&1
echo "=== update $(date) ==="

fail() { osascript -e "display alert \"Plexus couldn’t update\" message \"$1\n\nYour existing copy still works. Details: ~/Library/Logs/Plexus/update.log\"" >/dev/null 2>&1 || true; [ "$RELAUNCH" = 1 ] && open -a "$APP_NAME" 2>/dev/null || true; die "$1"; }

( check_prereqs ) || fail "Prerequisites missing (Node 22.13+, git, npm)."
cd "$REPO"
before="$(git rev-parse HEAD)"
say "Pulling the latest changes…"
git pull --ff-only >>"$LOGDIR/update.log" 2>&1 || fail "git pull failed (local changes or no connection?)."
after="$(git rev-parse HEAD)"
if [ "$before" = "$after" ] && [ -d "$(install_dir)/$APP_NAME.app" ]; then ok "Already up to date."; [ "$RELAUNCH" = 1 ] && open -a "$APP_NAME" || true; exit 0; fi

( build_everything ) || fail "The build failed."
quit_app
DEST="$( place_app | tail -1 )" || fail "Could not replace the installed app."
ok "Updated to $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
[ "$RELAUNCH" = 1 ] && open "$DEST" || true
exit 0
