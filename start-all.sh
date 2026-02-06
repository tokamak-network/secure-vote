#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

CAST=~/.foundry/bin/cast
FORGE=~/.foundry/bin/forge
RPC="http://127.0.0.1:8545"
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    pkill -f "anvil" 2>/dev/null || true
    pkill -f "next dev" 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

echo -e "${GREEN}=== Secure Vote Demo ===${NC}\n"

# 1. Kill existing processes
echo -e "${YELLOW}[1/5] Cleaning up old processes...${NC}"
pkill -9 -f "anvil" 2>/dev/null || true
pkill -9 -f "next dev" 2>/dev/null || true
sleep 2

# 2. Start Anvil
echo -e "${YELLOW}[2/5] Starting Anvil...${NC}"
~/.foundry/bin/anvil --block-time 1 > /tmp/anvil.log 2>&1 &
ANVIL_PID=$!
sleep 3

if ! $CAST block-number --rpc-url $RPC > /dev/null 2>&1; then
    echo -e "${RED}Failed to start Anvil${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Anvil running (PID: $ANVIL_PID)${NC}"

# 3. Deploy contract
echo -e "${YELLOW}[3/5] Deploying MACIVoting...${NC}"
cd /home/jazz/git/secure-vote
DEPLOY_OUT=$(PRIVATE_KEY=$DEPLOYER_KEY $FORGE script script/DeployMACI.s.sol:DeployMACI --rpc-url $RPC --broadcast --legacy 2>&1)
CONTRACT=$(echo "$DEPLOY_OUT" | grep "MACIVoting deployed to:" | awk '{print $NF}')

if [ -z "$CONTRACT" ]; then
    echo -e "${RED}Failed to deploy contract${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Contract: $CONTRACT${NC}"

# 4. Setup demo (coordinator + proposal)
echo -e "${YELLOW}[4/5] Setting up demo...${NC}"
COORD_PUBKEY="0x11111111111111111111111111111111111111111111111111111111111111112222222222222222222222222222222222222222222222222222222222222222"
$CAST send $CONTRACT "registerCoordinator(bytes)" $COORD_PUBKEY \
    --value 10ether --private-key $DEPLOYER_KEY --rpc-url $RPC > /dev/null 2>&1
$CAST send $CONTRACT "createProposal(uint256,string,uint256,uint256)" \
    0 "Demo Proposal - Vote Now!" 600 600 \
    --private-key $DEPLOYER_KEY --rpc-url $RPC > /dev/null 2>&1
echo -e "${GREEN}✓ Coordinator registered + Proposal created${NC}"

# 5. Update frontend config & start
echo -e "${YELLOW}[5/5] Starting Frontend...${NC}"
echo "NEXT_PUBLIC_MACI_CONTRACT_ADDRESS=$CONTRACT" > /home/jazz/git/secure-vote/frontend/.env.local
echo "NEXT_PUBLIC_CONTRACT_ADDRESS=$CONTRACT" >> /home/jazz/git/secure-vote/frontend/.env.local

cd /home/jazz/git/secure-vote/frontend
export PATH="/home/jazz/.nvm/versions/node/v22.16.0/bin:$PATH"

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}   All services ready!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo -e "Contract: $CONTRACT"
echo -e "Frontend: ${GREEN}http://172.21.191.65:3000/maci${NC}"
echo -e "\nPress Ctrl+C to stop all services\n"

# Run frontend in foreground (keeps script alive)
npm run dev -- -H 0.0.0.0
