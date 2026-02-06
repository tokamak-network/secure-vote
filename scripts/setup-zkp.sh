#!/bin/bash

# Setup ZKP toolchain for secure-vote circuits
# Downloads Powers of Tau file for trusted setup

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CIRCUITS_DIR="$PROJECT_ROOT/circuits"
PTAU_DIR="$CIRCUITS_DIR/ptau"

echo "=== ZKP Toolchain Setup ==="

# Create directories
mkdir -p "$PTAU_DIR"

# Check if circom is installed
if ! command -v circom &> /dev/null; then
    echo "Error: circom is not installed"
    echo "Install with: curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh && cargo install circom"
    exit 1
fi

echo "circom version: $(circom --version)"

# Check if snarkjs is installed (or install via npx)
if ! command -v snarkjs &> /dev/null; then
    echo "snarkjs not found globally, will use npx"
fi

# Download Powers of Tau (pot15 supports up to 2^15 = 32768 constraints)
PTAU_FILE="$PTAU_DIR/pot15.ptau"
if [ ! -f "$PTAU_FILE" ]; then
    echo "Downloading Powers of Tau (pot15.ptau)..."
    curl -L -o "$PTAU_FILE" \
        "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau"
    echo "Downloaded: $PTAU_FILE"
else
    echo "Powers of Tau already exists: $PTAU_FILE"
fi

# Verify file size (should be ~45MB)
FILE_SIZE=$(stat -f%z "$PTAU_FILE" 2>/dev/null || stat -c%s "$PTAU_FILE" 2>/dev/null)
if [ "$FILE_SIZE" -lt 40000000 ]; then
    echo "Warning: Powers of Tau file seems too small. Re-downloading..."
    rm "$PTAU_FILE"
    curl -L -o "$PTAU_FILE" \
        "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau"
fi

echo ""
echo "=== Setup Complete ==="
echo "Powers of Tau: $PTAU_FILE"
echo ""
echo "Next step: Run ./scripts/compile-circuit.sh to compile the circuit"
