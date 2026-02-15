#!/bin/bash
# Quick test script for Secure Vote frontend
# Run this after Anvil is running and contract is deployed

set -e

echo "=== Secure Vote Quick Test ==="
echo ""

# Check if Anvil is running
if ! curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://127.0.0.1:8545 > /dev/null 2>&1; then
  echo "❌ Anvil is not running!"
  echo "   Start it with: anvil"
  exit 1
fi
echo "✓ Anvil is running"

# Check if .env.local exists
if [ ! -f .env.local ]; then
  echo "❌ .env.local not found!"
  echo "   Create it with: echo 'NEXT_PUBLIC_CONTRACT_ADDRESS=0x...' > .env.local"
  exit 1
fi
echo "✓ .env.local exists"

# Get contract address from .env.local
CONTRACT_ADDRESS=$(grep NEXT_PUBLIC_CONTRACT_ADDRESS .env.local | cut -d '=' -f2)
if [ -z "$CONTRACT_ADDRESS" ]; then
  echo "❌ Contract address not set in .env.local"
  exit 1
fi
echo "✓ Contract address: $CONTRACT_ADDRESS"

# Check if contract is deployed
PROPOSAL_COUNT=$(cast call $CONTRACT_ADDRESS "getProposalCount()(uint256)" --rpc-url http://127.0.0.1:8545 2>/dev/null || echo "")
if [ -z "$PROPOSAL_COUNT" ]; then
  echo "⚠️  Contract not found at $CONTRACT_ADDRESS"
  echo "   Deploy with: forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  exit 1
fi
echo "✓ Contract deployed (proposals: $PROPOSAL_COUNT)"

# Check if node_modules exists
if [ ! -d node_modules ]; then
  echo "⚠️  Dependencies not installed"
  echo "   Installing..."
  npm install
fi
echo "✓ Dependencies installed"

echo ""
echo "=== Starting development server ==="
echo ""
echo "Open http://localhost:3000 in your browser"
echo ""
echo "Quick steps:"
echo "1. Click 'Setup Demo'"
echo "2. Connect MetaMask (Network: Anvil, Chain ID: 31337)"
echo "3. Import account: 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
echo "4. Vote on proposal"
echo "5. Go to Committee page and click 'Decrypt & Tally'"
echo "6. View results"
echo ""

npm run dev
