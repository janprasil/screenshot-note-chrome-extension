#!/bin/sh
# Registers the development native host for Chrome. Usage: ./dev-host/install.sh <extension-id>
set -eu
EXTENSION_ID="${1:?Pass the extension ID from chrome://extensions}"
HOST_NAME="cz.janprasil.screenshotnote.bridge"
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)"
TARGET="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

# Chrome starts hosts with a minimal PATH, so pin the node binary.
cat > "$DIR/run-host.sh" <<SH
#!/bin/sh
exec "$NODE" "$DIR/host.mjs"
SH
chmod +x "$DIR/run-host.sh"

mkdir -p "$TARGET"
cat > "$TARGET/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Screenshot Note development bridge",
  "path": "$DIR/run-host.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
JSON
echo "Installed $TARGET/$HOST_NAME.json"
