#!/usr/bin/env bash
# Desktop Dog — uninstaller.
set -euo pipefail

UUID="desktop-dog@custom.local"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

echo "==> Disabling ${UUID}"
gnome-extensions disable "${UUID}" 2>/dev/null || true

echo "==> Removing ${DEST_DIR}"
rm -rf "${DEST_DIR}"

echo "==> Clearing saved settings (optional, ignored if dconf is unavailable)"
dconf reset -f /org/gnome/shell/extensions/desktop-dog/ 2>/dev/null || true

echo
echo "==> Uninstalled. Restart GNOME Shell to fully unload:"
echo "      X11:     Alt+F2, type 'r', Enter"
echo "      Wayland: log out and back in"
