#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTENSIONS_DIR="$HOME/.local/share/gnome-shell/extensions"

echo "=== GNOME-Tahoe Uninstall ==="

if [ -d "$EXTENSIONS_DIR" ]; then
    rm -rf "$EXTENSIONS_DIR"/*
fi

BACKUP_DIR=$(ls -dt "$HOME"/.local/share/gnome-shell/extensions-backup-* 2>/dev/null | head -1)

if [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
    cp -r "$BACKUP_DIR"/* "$EXTENSIONS_DIR/"
    dconf reset -f /org/gnome/
    dconf load / < "$SCRIPT_DIR/config/gnome.dconf"
fi

echo "=== Удаление завершено ==="
