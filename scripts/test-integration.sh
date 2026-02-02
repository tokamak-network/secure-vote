#!/bin/bash

# Integration test script
# 1. Start local Foundry network (anvil)
# 2. Deploy contracts
# 3. Run integration test
# 4. Cleanup

set -e

echo "=== Secure Vote Integration Test ==="
echo

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Start anvil in background
echo -e "${YELLOW}Step 1: Starting local Foundry network (anvil)...${NC}"
anvil > /dev/null 2>&1 &
ANVIL_PID=$!
echo -e "${GREEN}✓ Anvil started (PID: $ANVIL_PID)${NC}"
sleep 2
echo

# Cleanup function
cleanup() {
    echo
    echo -e "${YELLOW}Cleaning up...${NC}"
    kill $ANVIL_PID 2>/dev/null || true
    echo -e "${GREEN}✓ Stopped anvil${NC}"
}

trap cleanup EXIT

# Step 2: Deploy contracts
echo -e "${YELLOW}Step 2: Deploying contracts...${NC}"

# Deploy WhitelistEligibility and SecureVoting
DEPLOY_OUTPUT=$(forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 2>&1)

# Extract contract address (simplified - in production use proper parsing)
CONTRACT_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -oP "SecureVoting deployed at: \K0x[a-fA-F0-9]{40}" | head -1)

if [ -z "$CONTRACT_ADDRESS" ]; then
    echo -e "${RED}✗ Failed to deploy contracts${NC}"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

echo -e "${GREEN}✓ Contracts deployed${NC}"
echo "  SecureVoting: $CONTRACT_ADDRESS"
echo

# Step 3: Run integration test
echo -e "${YELLOW}Step 3: Running integration test...${NC}"
echo

cd offchain
export CONTRACT_ADDRESS=$CONTRACT_ADDRESS
npm run integration

echo
echo -e "${GREEN}=== Integration Test Complete ===${NC}"
