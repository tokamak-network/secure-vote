#!/bin/bash

# Compile SingleMessageProcessor circuit and generate Solidity verifier
# Prerequisites: circom, snarkjs, pot15.ptau

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CIRCUITS_DIR="$PROJECT_ROOT/circuits"
BUILD_DIR="$CIRCUITS_DIR/build"
PTAU_FILE="$CIRCUITS_DIR/ptau/pot15.ptau"

echo "=== Circuit Compilation ==="

# Check prerequisites
if [ ! -f "$PTAU_FILE" ]; then
    echo "Error: Powers of Tau not found at $PTAU_FILE"
    echo "Run ./scripts/setup-zkp.sh first"
    exit 1
fi

# Install circuit dependencies
echo "Installing circuit dependencies..."
cd "$CIRCUITS_DIR"
bun install --silent

# Create build directory
mkdir -p "$BUILD_DIR"

# Step 1: Compile circuit to r1cs, wasm, sym
echo ""
echo "Step 1: Compiling circuit..."
circom "$CIRCUITS_DIR/SingleMessageProcessor.circom" \
    --r1cs \
    --wasm \
    --sym \
    -l "$CIRCUITS_DIR/node_modules/circomlib/circuits" \
    -o "$BUILD_DIR"

echo "  - R1CS: $BUILD_DIR/SingleMessageProcessor.r1cs"
echo "  - WASM: $BUILD_DIR/SingleMessageProcessor_js/SingleMessageProcessor.wasm"
echo "  - SYM: $BUILD_DIR/SingleMessageProcessor.sym"

# Step 2: Generate initial zkey (Groth16 setup)
echo ""
echo "Step 2: Generating initial zkey (Groth16 setup)..."
cd "$BUILD_DIR"
npx snarkjs groth16 setup \
    SingleMessageProcessor.r1cs \
    "$PTAU_FILE" \
    circuit_0000.zkey

# Step 3: Contribute to ceremony (development only - not secure for production)
echo ""
echo "Step 3: Contributing to zkey (development only)..."
echo "development-contribution" | npx snarkjs zkey contribute \
    circuit_0000.zkey \
    circuit_final.zkey \
    --name="Development Contribution" \
    -v

# Step 4: Export verification key
echo ""
echo "Step 4: Exporting verification key..."
npx snarkjs zkey export verificationkey \
    circuit_final.zkey \
    verification_key.json

# Step 5: Generate Solidity verifier
echo ""
echo "Step 5: Generating Solidity verifier..."
npx snarkjs zkey export solidityverifier \
    circuit_final.zkey \
    "$PROJECT_ROOT/src/GeneratedVerifier.sol"

# Fix Solidity version pragma and rename contract
sed -i.bak 's/pragma solidity \^0.6.11;/pragma solidity ^0.8.20;/' \
    "$PROJECT_ROOT/src/GeneratedVerifier.sol"
sed -i.bak 's/contract Groth16Verifier/contract GeneratedGroth16Verifier/' \
    "$PROJECT_ROOT/src/GeneratedVerifier.sol"
rm -f "$PROJECT_ROOT/src/GeneratedVerifier.sol.bak"

# Clean up intermediate files
rm -f circuit_0000.zkey

echo ""
echo "=== Compilation Complete ==="
echo ""
echo "Generated files:"
echo "  - WASM: $BUILD_DIR/SingleMessageProcessor_js/SingleMessageProcessor.wasm"
echo "  - zkey: $BUILD_DIR/circuit_final.zkey"
echo "  - Verification key: $BUILD_DIR/verification_key.json"
echo "  - Solidity verifier: $PROJECT_ROOT/src/GeneratedVerifier.sol"
echo ""
echo "Circuit constraints info:"
npx snarkjs r1cs info "$BUILD_DIR/SingleMessageProcessor.r1cs"
