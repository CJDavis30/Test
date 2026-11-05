#!/bin/bash
# Removes the Plexus app. Your cases (~/.plexus) are kept unless you pass --purge.
source "$(dirname "$0")/common.sh"
quit_app
rm -rf "/Applications/$APP_NAME.app" "$HOME/Applications/$APP_NAME.app"
ok "Removed $APP_NAME.app"
if [ "${1:-}" = "--purge" ]; then rm -rf "$HOME/.plexus" "$HOME/Library/Logs/Plexus"; ok "Deleted your cases and logs"; else say "Your cases are still in ~/.plexus (pass --purge to delete them)."; fi
