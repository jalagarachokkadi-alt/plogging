#!/bin/sh
# Usage: tools/bump.sh v38   — sets the version in app.js and sw.js (and today's date), so phones update.
set -e
V="$1"; [ -n "$V" ] || { echo "usage: tools/bump.sh vNN"; exit 1; }
D=$(date +%Y-%m-%d)
cd "$(dirname "$0")/.."
sed -i.bak "s/const APP_VERSION=\"[^\"]*\", APP_DATE=\"[^\"]*\"/const APP_VERSION=\"$V\", APP_DATE=\"$D\"/" app.js
sed -i.bak "s/const VERSION=\"[^\"]*\";/const VERSION=\"$V\";/" sw.js
rm -f app.js.bak sw.js.bak
grep -o 'APP_VERSION="[^"]*"' app.js; grep -o 'VERSION="[^"]*"' sw.js
