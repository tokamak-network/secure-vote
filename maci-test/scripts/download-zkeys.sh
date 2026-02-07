#!/usr/bin/env bash
# Download MACI test zkeys (10-2-1-2 parameters)
# ProcessMessages batch size = 5^1 = 5 messages
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZKEYS_DIR="${SCRIPT_DIR}/../zkeys"
URL="https://maci-develop-fra.s3.eu-central-1.amazonaws.com/v2.0.0/maci_artifacts_10-2-1-2_test.tar.gz"
TARBALL="/tmp/maci_test_zkeys.tar.gz"

if [ -d "${ZKEYS_DIR}/ProcessMessages_10-2-1-2_test" ]; then
  echo "zkeys already downloaded at ${ZKEYS_DIR}"
  exit 0
fi

echo "Downloading MACI test zkeys (~500MB)..."
curl -L -o "${TARBALL}" "${URL}"

echo "Extracting to ${ZKEYS_DIR}..."
mkdir -p "${ZKEYS_DIR}"
tar -xzf "${TARBALL}" --strip-components=1 -C "${ZKEYS_DIR}"

echo "Cleaning up tarball..."
rm -f "${TARBALL}"

echo "Done. Zkey files:"
ls -la "${ZKEYS_DIR}/"
