#!/usr/bin/env bash
# Install/refresh the Bees Network beta services as systemd --user units and
# register the desktop app for autostart on login.
#
# Idempotent: safe to re-run after changing the unit templates.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node)"
STATE="$HOME/.local/state/bees"
UNIT_DIR="$HOME/.config/systemd/user"
AUTOSTART_DIR="$HOME/.config/autostart"

if [[ -z "$NODE" ]]; then
  echo "error: node not found on PATH" >&2
  exit 1
fi

mkdir -p "$STATE" "$UNIT_DIR" "$AUTOSTART_DIR"

for unit in bees-orchestrator bees-coordinator; do
  sed -e "s|__NODE__|$NODE|g" \
      -e "s|__ROOT__|$ROOT|g" \
      -e "s|__STATE__|$STATE|g" \
      "$ROOT/deploy/services/$unit.service" > "$UNIT_DIR/$unit.service"
  echo "installed $UNIT_DIR/$unit.service"
done

# Desktop app: supervised service (Restart=always) instead of a fire-and-forget
# autostart entry, so an overnight crash self-heals.
DISPLAY_VAL="${DISPLAY:-:1}"
XAUTH_VAL="${XAUTHORITY:-}"
if [[ -z "$XAUTH_VAL" ]]; then
  for candidate in "/run/user/$(id -u)/gdm/Xauthority" "$HOME/.Xauthority"; do
    [[ -f "$candidate" ]] && XAUTH_VAL="$candidate" && break
  done
fi
sed -e "s|__ROOT__|$ROOT|g" \
    -e "s|__STATE__|$STATE|g" \
    -e "s|__DISPLAY__|$DISPLAY_VAL|g" \
    -e "s|__XAUTHORITY__|$XAUTH_VAL|g" \
    "$ROOT/deploy/services/bee-node-app.service" > "$UNIT_DIR/bee-node-app.service"
echo "installed $UNIT_DIR/bee-node-app.service (DISPLAY=$DISPLAY_VAL XAUTHORITY=${XAUTH_VAL:-unset})"

# Remove the legacy autostart entry to avoid launching a duplicate instance.
rm -f "$AUTOSTART_DIR/bee-node.desktop"

systemctl --user daemon-reload
systemctl --user enable --now bees-orchestrator.service bees-coordinator.service
systemctl --user enable bee-node-app.service

# Keep user services running across logout/reboot (needs sudo once).
if ! loginctl show-user "$USER" 2>/dev/null | grep -q 'Linger=yes'; then
  echo "Enabling linger for $USER (requires sudo)..."
  sudo loginctl enable-linger "$USER"
fi

echo
systemctl --user --no-pager --full status bees-orchestrator.service bees-coordinator.service bee-node-app.service || true
