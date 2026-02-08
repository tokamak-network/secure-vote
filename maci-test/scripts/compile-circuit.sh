#!/usr/bin/env bash
# Compile ProcessMessages_10-3-1-2 circuit and generate zkey
# This circuit supports up to 125 messages (5^3), needed for 50/100 vote benchmarks
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}/.."
CIRCUIT_NAME="ProcessMessages_10-3-1-2"
CIRCUIT_FILE="${PROJECT_DIR}/circuits/${CIRCUIT_NAME}.circom"
OUTPUT_DIR="${PROJECT_DIR}/zkeys/${CIRCUIT_NAME}_test"
PTAU="${PROJECT_DIR}/zkeys/powersOfTau28_hez_final_19.ptau"
PTAU_URL="https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_19.ptau"

# Include paths for circom dependencies
MACI_CIRCUITS="${PROJECT_DIR}/node_modules/.pnpm/maci-circuits@2.5.0_@types+snarkjs@0.7.9/node_modules/maci-circuits/circom"
CIRCOMLIB="${PROJECT_DIR}/node_modules/.pnpm/circomlib@2.0.5/node_modules/circomlib/circuits"
ZK_KIT="${PROJECT_DIR}/node_modules/.pnpm/@zk-kit+circuits@0.4.0/node_modules/@zk-kit/circuits/circom"

CIRCOM="${HOME}/.cargo/bin/circom"

# Check prerequisites
if [ ! -f "${CIRCOM}" ]; then
  echo "ERROR: circom not found at ${CIRCOM}"
  echo "Install: curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh"
  echo "         git clone https://github.com/iden3/circom && cd circom && cargo build --release && cargo install --path circom"
  exit 1
fi

if [ ! -f "${PTAU}" ]; then
  echo "Powers of Tau file not found. Downloading pot19 (~577MB)..."
  curl -L -o "${PTAU}" "${PTAU_URL}"
fi

if [ ! -f "${CIRCUIT_FILE}" ]; then
  echo "ERROR: Circuit file not found at ${CIRCUIT_FILE}"
  exit 1
fi

# Check if already compiled
if [ -f "${OUTPUT_DIR}/${CIRCUIT_NAME}_test.0.zkey" ]; then
  echo "Circuit already compiled. Output at: ${OUTPUT_DIR}"
  echo "Delete ${OUTPUT_DIR} to recompile."
  exit 0
fi

mkdir -p "${OUTPUT_DIR}"

echo "=== Step 1/3: Compiling circuit ==="
echo "  Circuit: ${CIRCUIT_NAME}"
echo "  This may take several minutes..."
"${CIRCOM}" "${CIRCUIT_FILE}" \
  --r1cs --wasm --sym \
  --O1 \
  -l "${MACI_CIRCUITS}" \
  -l "${CIRCOMLIB}" \
  -l "${ZK_KIT}" \
  -o "${OUTPUT_DIR}"

echo "  R1CS constraints: $(npx snarkjs r1cs info "${OUTPUT_DIR}/${CIRCUIT_NAME}.r1cs" 2>&1 | grep 'Constraints' || echo 'check manually')"

echo ""
echo "=== Step 2/3: Generating zkey (Groth16 setup) ==="
echo "  Using ptau: ${PTAU}"
echo "  This may take several minutes and use significant memory..."
npx snarkjs groth16 setup \
  "${OUTPUT_DIR}/${CIRCUIT_NAME}.r1cs" \
  "${PTAU}" \
  "${OUTPUT_DIR}/${CIRCUIT_NAME}_test.0.zkey"

echo ""
echo "=== Step 3/3: Exporting verification key ==="
npx snarkjs zkey export verificationkey \
  "${OUTPUT_DIR}/${CIRCUIT_NAME}_test.0.zkey" \
  "${OUTPUT_DIR}/groth16_vkey.json"

echo ""
echo "=== Compilation complete ==="
echo "Output files:"
ls -lh "${OUTPUT_DIR}/${CIRCUIT_NAME}_test.0.zkey"
ls -lh "${OUTPUT_DIR}/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm"
ls -lh "${OUTPUT_DIR}/groth16_vkey.json"
echo ""
echo "R1CS: ${OUTPUT_DIR}/${CIRCUIT_NAME}.r1cs"
echo "WASM: ${OUTPUT_DIR}/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm"
echo "ZKEY: ${OUTPUT_DIR}/${CIRCUIT_NAME}_test.0.zkey"
echo "VKEY: ${OUTPUT_DIR}/groth16_vkey.json"
