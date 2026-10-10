
#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$HOME/.local/share/gnome-shell/extensions-backup-$(date +%Y%m%d-%H%M%S)"
EXTENSIONS_DIR="$HOME/.local/share/gnome-shell/extensions"
ICONS_DIR="$HOME/"

echo "==========================================="
echo "      GNOME-Tahoe Installer  0.1-BETA      "
echo "==========================================="
echo "              GNOME 50.x ONLY              "
echo "==========================================="
echo "     Many functions might look glitchy     "
echo "   or not work at all, as this is a BETA   "
echo "                  version                  "
echo "==========================================="
echo "     Please install the MacTahoe themes    "
echo "    and icons before running this script   "
echo "==========================================="
echo " by micronix.t.me or github.com/micronixxx "
echo "==========================================="

# backup ur extensions
if [ -d "$EXTENSIONS_DIR" ] && [ -n "$(ls -A "$EXTENSIONS_DIR" 2>/dev/null)" ]; then
    echo "[1/5] Creating backup of existing GNOME extensions..."
    mkdir -p "$BACKUP_DIR"
    cp -a "$EXTENSIONS_DIR/." "$BACKUP_DIR/"
    echo "      Backup saved to: $BACKUP_DIR"
else
    echo "[1/4] No existing extensions to back up."
fi
echo

# install extensions ^_^
if [ -d "$SCRIPT_DIR/extensions" ] && [ -n "$(ls -A "$SCRIPT_DIR/extensions" 2>/dev/null)" ]; then
    echo "[2/5] Installing GNOME extensions..."
    mkdir -p "$EXTENSIONS_DIR"
    cp -a "$SCRIPT_DIR/extensions/." "$EXTENSIONS_DIR/"
    echo "      Extensions installed successfully."
else
    echo "[2/4] No extensions found. Skipping."
fi
echo


# install top bar icons
if [ -d "$SCRIPT_DIR/assets/icons" ] && [ -n "$(ls -A "$SCRIPT_DIR/assets/icons" 2>/dev/null)" ]; then
    echo "[3/5] Installing icons..."
    mkdir -p "$ICONS_DIR"
    cp -a "$SCRIPT_DIR/assets/icons/." "$ICONS_DIR/"
    echo "      Icons copied to: $ICONS_DIR"
else
    echo "[3/4] No top bar icons found. Skipping."
fi
echo

# copy wallpapers
WALLPAPERS_SOURCE="$SCRIPT_DIR/assets/wallpapers"

if [ -d "$WALLPAPERS_SOURCE" ] && [ -n "$(ls -A "$WALLPAPERS_SOURCE" 2>/dev/null)" ]; then
    echo "[4/4] Installing wallpapers..."

    if command -v xdg-user-dir >/dev/null 2>&1; then
        PICTURES_DIR="$(xdg-user-dir PICTURES 2>/dev/null)"
    else
        PICTURES_DIR=""
    fi

    if [ -z "$PICTURES_DIR" ] || [ "$PICTURES_DIR" = "$HOME" ]; then
        PICTURES_DIR="$HOME/Pictures"
    fi

    WALLPAPERS_DIR="$PICTURES_DIR/Wallpapers"

    mkdir -p "$WALLPAPERS_DIR"
    cp -a "$WALLPAPERS_SOURCE/." "$WALLPAPERS_DIR/"

    echo "      Wallpapers copied to: $WALLPAPERS_DIR"
else
    echo "[4/4] No wallpapers found. Skipping."
fi

echo
echo "=================================="
echo "  GNOME-Tahoe installation done!  "
echo "=================================="
