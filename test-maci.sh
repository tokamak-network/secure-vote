#!/bin/bash
set -e

echo "========================================="
echo "MACI Voting - Quick Test"
echo "========================================="

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Kill existing anvil
pkill -f "anvil" 2>/dev/null || true
sleep 1

# Start Anvil
echo -e "\n${YELLOW}[1/3] Starting Anvil...${NC}"
~/.foundry/bin/anvil --block-time 1 &
ANVIL_PID=$!
sleep 2
echo -e "${GREEN}✓ Anvil running${NC}"

cleanup() {
    kill $ANVIL_PID 2>/dev/null || true
}
trap cleanup EXIT

# Deploy
echo -e "\n${YELLOW}[2/3] Deploying MACIVoting...${NC}"
cd /home/jazz/git/secure-vote

PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

DEPLOY_OUTPUT=$(PRIVATE_KEY=$PRIVATE_KEY ~/.foundry/bin/forge script script/DeployMACI.s.sol:DeployMACI \
    --rpc-url http://127.0.0.1:8545 \
    --broadcast \
    --legacy 2>&1)

CONTRACT=$(echo "$DEPLOY_OUTPUT" | grep "MACIVoting deployed to:" | awk '{print $NF}')
echo -e "${GREEN}✓ Contract: $CONTRACT${NC}"

# Update frontend config
echo -e "\n${YELLOW}[3/3] Configuring frontend...${NC}"
echo "NEXT_PUBLIC_MACI_CONTRACT_ADDRESS=$CONTRACT" > frontend/.env.local
echo "NEXT_PUBLIC_CONTRACT_ADDRESS=$CONTRACT" >> frontend/.env.local
echo -e "${GREEN}✓ Config saved${NC}"

echo ""
echo "========================================="
echo -e "${GREEN}Ready!${NC}"
echo "========================================="
echo ""
echo "Now run in another terminal:"
echo ""
echo "  cd ~/git/secure-vote/frontend && npm run dev"
echo ""
echo "Then:"
echo "  1. Open http://localhost:3000/maci"
echo "  2. Click 'Setup Demo' button"
echo "  3. Connect MetaMask (any Anvil account)"
echo "  4. Vote!"
echo ""
echo -e "${YELLOW}Ctrl+C to stop${NC}"

wait $ANVIL_PID
