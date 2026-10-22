#!/usr/bin/env bash
# Re-renders every diagram in this folder to ../images/*.svg in the dashboard's dark style.
# Needs Node. The first run downloads a headless Chromium for Mermaid (about 150 MB, one time).
#   bash docs/diagrams/render.sh
set -euo pipefail
cd "$(dirname "$0")"
for source in *.mmd; do
  name="${source%.mmd}"
  npx --yes @mermaid-js/mermaid-cli -i "$source" -o "../images/$name.svg" -c mermaid-config.json -b "#0a0a0c"
done
