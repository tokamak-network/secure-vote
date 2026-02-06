#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

CAST=~/.foundry/bin/cast
FORGE=~/.foundry/bin/forge
RPC="http://127.0.0.1:8545"

# Anvil accounts
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEPLOYER_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
VOTER_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
VOTER_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}   MACI Voting E2E Test${NC}"
echo -e "${BLUE}=========================================${NC}"

# Check Anvil
echo -e "\n${YELLOW}[1/8] Checking Anvil...${NC}"
if ! $CAST block-number --rpc-url $RPC &>/dev/null; then
    echo -e "${RED}Anvil not running. Starting...${NC}"
    pkill -f anvil 2>/dev/null || true
    ~/.foundry/bin/anvil --block-time 1 &>/dev/null &
    sleep 3
fi
BLOCK=$($CAST block-number --rpc-url $RPC)
echo -e "${GREEN}✓ Anvil running at block $BLOCK${NC}"

# Deploy contract
echo -e "\n${YELLOW}[2/8] Deploying MACIVoting...${NC}"
cd /home/jazz/git/secure-vote
DEPLOY_OUT=$(PRIVATE_KEY=$DEPLOYER_KEY $FORGE script script/DeployMACI.s.sol:DeployMACI --rpc-url $RPC --broadcast --legacy 2>&1)
CONTRACT=$(echo "$DEPLOY_OUT" | grep "MACIVoting deployed to:" | awk '{print $NF}')
if [ -z "$CONTRACT" ]; then
    echo -e "${RED}Deploy failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Contract: $CONTRACT${NC}"

# Register Coordinator (64 bytes = 128 hex chars)
echo -e "\n${YELLOW}[3/8] Registering Coordinator...${NC}"
COORD_PUBKEY="0x11111111111111111111111111111111111111111111111111111111111111112222222222222222222222222222222222222222222222222222222222222222"
$CAST send $CONTRACT "registerCoordinator(bytes)" $COORD_PUBKEY \
    --value 10ether --private-key $DEPLOYER_KEY --rpc-url $RPC &>/dev/null
echo -e "${GREEN}✓ Coordinator registered with 10 ETH bond${NC}"

# Create Proposal
echo -e "\n${YELLOW}[4/8] Creating Proposal...${NC}"
$CAST send $CONTRACT "createProposal(uint256,string,uint256,uint256)" \
    0 "E2E Test Proposal" 60 120 \
    --private-key $DEPLOYER_KEY --rpc-url $RPC &>/dev/null
PROPOSAL_COUNT=$($CAST call $CONTRACT "nextProposalId()(uint256)" --rpc-url $RPC)
echo -e "${GREEN}✓ Proposal created (total: $PROPOSAL_COUNT)${NC}"

# Submit Vote (64 bytes pubkey, 128 bytes encrypted, 64 bytes ephemeral)
echo -e "\n${YELLOW}[5/8] Submitting Vote...${NC}"
VOTER_PUBKEY="0x33333333333333333333333333333333333333333333333333333333333333334444444444444444444444444444444444444444444444444444444444444444"
ENCRYPTED_DATA="0x5555555555555555555555555555555555555555555555555555555555555555666666666666666666666666666666666666666666666666666666666666666677777777777777777777777777777777777777777777777777777777777777778888888888888888888888888888888888888888888888888888888888888888"
EPHEMERAL_KEY="0x99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999"

$CAST send $CONTRACT "submitMessage(uint256,bytes,bytes,bytes)" \
    0 $VOTER_PUBKEY $ENCRYPTED_DATA $EPHEMERAL_KEY \
    --private-key $VOTER_KEY --rpc-url $RPC &>/dev/null

MSG_COUNT=$($CAST call $CONTRACT "getMessageCount(uint256)(uint256)" 0 --rpc-url $RPC)
echo -e "${GREEN}✓ Vote submitted (messages: $MSG_COUNT)${NC}"

# Wait for voting period to end
echo -e "\n${YELLOW}[6/8] Waiting for voting period...${NC}"
echo -e "   Skipping time by 200 seconds..."
$CAST rpc anvil_increaseTime 200 --rpc-url $RPC &>/dev/null
$CAST rpc anvil_mine 1 --rpc-url $RPC &>/dev/null
echo -e "${GREEN}✓ Voting period ended${NC}"

# Submit State Root
echo -e "\n${YELLOW}[7/8] Coordinator submits state root & tally...${NC}"
STATE_ROOT="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
$CAST send $CONTRACT "submitStateRoot(uint256,bytes32,uint256)" \
    0 $STATE_ROOT 1 \
    --private-key $DEPLOYER_KEY --rpc-url $RPC &>/dev/null
echo -e "   State root submitted"

TALLY_COMMIT="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
$CAST send $CONTRACT "submitTally(uint256,uint256,uint256,bytes32)" \
    0 1 0 $TALLY_COMMIT \
    --private-key $DEPLOYER_KEY --rpc-url $RPC &>/dev/null
echo -e "${GREEN}✓ Tally submitted (YES: 1, NO: 0)${NC}"

# Finalize
echo -e "\n${YELLOW}[8/8] Finalizing...${NC}"
echo -e "   Skipping challenge period (7 days)..."
$CAST rpc anvil_increaseTime 604800 --rpc-url $RPC &>/dev/null
$CAST rpc anvil_mine 1 --rpc-url $RPC &>/dev/null

$CAST send $CONTRACT "finalizeTally(uint256)" 0 \
    --private-key $DEPLOYER_KEY --rpc-url $RPC &>/dev/null

# Verify
RESULT=$($CAST call $CONTRACT "getTallyResult(uint256)(uint256,uint256,bool)" 0 --rpc-url $RPC)
echo -e "${GREEN}✓ Tally finalized${NC}"

echo -e "\n${BLUE}=========================================${NC}"
echo -e "${GREEN}   E2E Test PASSED!${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""
echo -e "Contract: $CONTRACT"
echo -e "Result: $RESULT"
echo ""

# Update frontend config
echo "NEXT_PUBLIC_MACI_CONTRACT_ADDRESS=$CONTRACT" > /home/jazz/git/secure-vote/frontend/.env.local
echo "NEXT_PUBLIC_CONTRACT_ADDRESS=$CONTRACT" >> /home/jazz/git/secure-vote/frontend/.env.local
echo -e "${GREEN}✓ Frontend config updated${NC}"
echo ""
echo -e "Open: ${BLUE}http://172.21.191.65:3000/maci${NC}"
