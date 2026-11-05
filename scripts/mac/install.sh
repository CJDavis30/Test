#!/bin/bash
# Installs Plexus as a real Mac app.
#
#   git clone -b <branch> <repo-url> ~/Plexus && cd ~/Plexus && ./scripts/mac/install.sh
#
# The app is built from this folder, so keep it: "Check for Updates…" (Plexus menu) pulls new commits from here and rebuilds.
# Flags:  --check     only verify prerequisites     --no-open   don't launch afterwards
source "$(dirname "$0")/common.sh"

OPEN=1
for a in "$@"; do case "$a" in --check) check_prereqs; ok "Prerequisites look good (node $(node -v))."; exit 0;; --no-open) OPEN=0;; esac; done

say "Installing $APP_NAME from $REPO"
check_prereqs
build_everything
DEST="$(place_app | tail -1)"

cat <<MSG

${c_bold}Done.${c_off} Plexus is in ${DEST}
  • Open it from Launchpad / Spotlight, or drag it to your Dock.
  • Update any time:  Plexus menu → Check for Updates…   (or run ./scripts/mac/update.sh)
  • Your cases live in ~/.plexus (separate from the app, so updates never touch them).
  • Logs: ~/Library/Logs/Plexus
MSG
[ "$OPEN" = 1 ] && open "$DEST"
exit 0
