#!/bin/bash
# Start the full MACI + MaciRLA platform locally.
#
# 1. Starts Anvil (local Ethereum node)
# 2. Compiles contracts + builds Poseidon
# 3. Deploys all contracts (writes addresses to frontend/.env.local)
# 4. Starts the frontend dev server
#
# Usage: bash scripts/start-platform.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo "=== MACI + MaciRLA Platform ==="
echo ""

# Check dependencies
if ! command -v anvil &> /dev/null; then
  echo "Error: anvil not found. Install foundry: https://book.getfoundry.sh/getting-started/installation"
  exit 1
fi

# 1. Start Anvil in background
echo "1. Starting Anvil..."
anvil --block-time 1 --accounts 10 --balance 10000 &
ANVIL_PID=$!
sleep 2

# Ensure Anvil is stopped on exit
cleanup() {
  echo ""
  echo "Stopping Anvil (PID: $ANVIL_PID)..."
  kill $ANVIL_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "   Anvil running on http://127.0.0.1:8545 (PID: $ANVIL_PID)"

# 2. Compile contracts
echo ""
echo "2. Compiling contracts..."
cd "$PROJECT_DIR"
npx hardhat compile
npx hardhat build-poseidon

# 3. Deploy contracts
echo ""
echo "3. Deploying contracts..."
npx hardhat run scripts/deploy-platform.ts --network localhost

# 4. Install frontend deps if needed
echo ""
echo "4. Setting up frontend..."
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
  echo "   Installing frontend dependencies..."
  npm install
fi

# 5. Start frontend
echo ""
echo "5. Starting frontend dev server..."
echo "   Open http://localhost:3001 in your browser"
echo ""
npm run dev
