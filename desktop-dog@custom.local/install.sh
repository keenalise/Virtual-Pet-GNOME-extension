#!/usr/bin/env bash
# Desktop Dog — local installer for GNOME Shell 46 (Ubuntu 24.04).
# Copies the extension into your user extensions folder and compiles the
# GSettings schema so the extension can load.
set -euo pipefail

UUID="desktop-dog@custom.local"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

echo "==> Installing ${UUID}"
echo "    from: ${SRC_DIR}"
echo "    to:   ${DEST_DIR}"

mkdir -p "${DEST_DIR}"
# copy everything except dev-only tooling
rsync -a --delete \
    --exclude 'tools' \
    --exclude 'install.sh' \
    --exclude 'uninstall.sh' \
    --exclude '*.zip' \
    "${SRC_DIR}/" "${DEST_DIR}/" 2>/dev/null \
  || cp -r "${SRC_DIR}/." "${DEST_DIR}/"

echo "==> Compiling GSettings schema"
glib-compile-schemas "${DEST_DIR}/schemas"

echo
echo "==> Done. Next steps:"
echo "    1. Restart GNOME Shell:"
echo "         X11:     press Alt+F2, type 'r', press Enter"
echo "         Wayland: log out and log back in"
echo "    2. Enable the extension:"
echo "         gnome-extensions enable ${UUID}"
echo "       (or toggle it on in the Extension Manager app)"
