# Testing Guide

This document walks through testing the complete voting system end-to-end.

## Prerequisites

- Anvil running
- Contract deployed
- `.env.local` configured with contract address

## Quick Test

### Terminal 1: Start Anvil

```bash
cd /home/jazz/git/secure-vote
anvil
```

Keep this running. Note: Anvil provides 10 test accounts with 10,000 ETH each.

### Terminal 2: Deploy Contract

```bash
cd /home/jazz/git/secure-vote

# Deploy using Foundry account 0
forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

**Copy the SecureVoting contract address from the output.**

Example output:
```
== Logs ==
Deploying SecureVoting...
SecureVoting deployed at: 0x5FbDB2315678afecb367f032d93F642f64180aa3
```

### Terminal 3: Configure and Start Frontend

```bash
cd /home/jazz/git/secure-vote/frontend

# Update .env.local with your contract address
echo "NEXT_PUBLIC_CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3" > .env.local

# Start dev server
npm run dev
```

The frontend will be available at http://localhost:3000

## MetaMask Setup

### 1. Add Anvil Network

1. Open MetaMask
2. Click network dropdown (top left)
3. Click "Add Network" → "Add a network manually"
4. Fill in:
   - **Network name:** Anvil Local
   - **RPC URL:** http://127.0.0.1:8545
   - **Chain ID:** 31337
   - **Currency symbol:** ETH
5. Click "Save"

### 2. Import Test Account

Import Foundry account 3 (this will be YOUR voter account):

1. Click account icon (top right) → "Import Account"
2. Select "Private Key"
3. Paste private key:
   ```
   0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
   ```
4. Click "Import"
5. Rename account to "Anvil Voter 3" (optional)

**WARNING:** This is a publicly known test key. NEVER use on mainnet.

The account address is: `0x90F79bf6EB2c4f870365E785982E1f101E93b906`

## Test Flow

### Step 1: Setup Demo (Backend Automation)

1. Open http://localhost:3000
2. Click **"Setup Demo"** button
3. Wait for success message (~10-15 seconds)

**What happens:**
- Generates threshold key (3-of-5)
- Stores key shares in `frontend/key-shares.json`
- Deposits 10 ETH bond from account 0
- Creates proposal: "Should we upgrade the protocol?"
- Submits 2 dummy votes:
  - Account 1 (0x7099...): Yes
  - Account 2 (0x3C44...): No

**Expected output:**
```
Demo setup complete! You can now vote.
```

### Step 2: Connect Wallet

1. Click **"Connect Wallet"** (top right)
2. Select MetaMask
3. Select "Anvil Voter 3" account
4. Click "Connect"

### Step 3: Vote with MetaMask

1. Click **"Vote"** on the proposal
2. Choose **"Yes"** or **"No"**
3. MetaMask popup appears
4. Review transaction details:
   - Contract: `0x5FbD...` (your SecureVoting address)
   - Function: `commitVote`
   - Gas: ~100,000
5. Click **"Confirm"**
6. Wait for transaction confirmation (~2 seconds on Anvil)
7. Success message: "Vote submitted successfully! Redirecting..."

**What happens:**
- Your vote is encrypted in the browser using threshold ElGamal
- Encrypted ciphertext is submitted to the contract via MetaMask
- Your account pays gas (deducted from 10,000 ETH)
- VoteCommitted event is emitted

### Step 4: Decrypt & Tally (Backend Automation)

1. Go to **"Committee"** page (top navigation)
2. See proposal with "Total votes: 3"
3. Click **"Decrypt & Tally"**
4. Wait for completion (~5-10 seconds)
5. Alert shows: "Tally complete! Yes: X, No: Y"

**What happens:**
- Backend fetches all VoteCommitted events from contract
- Decrypts votes using threshold cryptography (3-of-5 shares)
- Aggregates results and generates Merkle root
- Submits tally to contract using account 0

### Step 5: View Results

1. You're automatically redirected to Results page
2. View:
   - **Outcome:** Passed / Rejected / Tied
   - **Yes votes:** Count + percentage
   - **No votes:** Count + percentage
   - **Merkle root:** For verification
   - **Submitter:** Account 0 address
   - **Timestamp:** When tally was submitted

**Expected results:**
- Total votes: 3 (2 dummy + yours)
- If you voted Yes: Yes=2, No=1 → Passed
- If you voted No: Yes=1, No=2 → Rejected

## Verification

### 1. Check Votes Were Recorded

In Terminal 2 (or new terminal):

```bash
cd /home/jazz/git/secure-vote

# Get proposal details
cast call $CONTRACT_ADDRESS \
  "proposals(uint256)(string,uint256,uint256,uint256,bool)" \
  0 \
  --rpc-url http://127.0.0.1:8545

# Should show totalVotes = 3
```

### 2. Check Tally

```bash
# Get tally
cast call $CONTRACT_ADDRESS \
  "tallies(uint256)(uint256,uint256,bytes32,uint256,address,bool,bool)" \
  0 \
  --rpc-url http://127.0.0.1:8545

# Should show:
# - yesVotes (depends on your vote)
# - noVotes (depends on your vote)
# - votesRoot (Merkle root)
# - submittedAt (timestamp)
# - submitter (account 0)
```

### 3. Check Event Logs

```bash
# Get VoteCommitted events
cast logs \
  --from-block 0 \
  --address $CONTRACT_ADDRESS \
  VoteCommitted(uint256,address,bytes) \
  --rpc-url http://127.0.0.1:8545

# Should show 3 events
```

## Troubleshooting

### "Contract address not set"

**Fix:**
```bash
cd frontend
echo "NEXT_PUBLIC_CONTRACT_ADDRESS=YOUR_ADDRESS" > .env.local
npm run dev  # Restart server
```

### "Key shares not found"

**Fix:**
- Click "Setup Demo" again
- Check `frontend/key-shares.json` exists

### "Transaction failed"

**Possible causes:**
1. Wrong network in MetaMask (should be Anvil, chainId 31337)
2. Contract address incorrect in `.env.local`
3. Anvil not running

**Fix:**
- Check MetaMask network
- Restart Anvil (this resets state, redeploy contract)

### "Insufficient funds"

**Fix:**
- Account should have 10,000 ETH from Anvil
- Restart Anvil to reset balances
- Reimport account to MetaMask

### "Public key not found"

**Fix:**
- Run "Setup Demo" first
- Check browser console for errors
- Verify `frontend/key-shares.json` exists

### Frontend won't start

**Fix:**
```bash
cd frontend
rm -rf node_modules .next
npm install
npm run dev
```

## Clean Slate Test

To start completely fresh:

1. Stop all terminals (Ctrl+C)
2. Delete artifacts:
   ```bash
   cd /home/jazz/git/secure-vote/frontend
   rm -f key-shares.json
   rm -rf .next
   ```
3. Restart Anvil (Terminal 1)
4. Redeploy contract (Terminal 2)
5. Update `.env.local` with new address
6. Start frontend (Terminal 3)
7. Run test flow again

## Success Criteria

- [ ] Setup Demo completes without errors
- [ ] Wallet connects successfully
- [ ] Vote transaction confirms on Anvil
- [ ] Decrypt & Tally completes successfully
- [ ] Results page shows correct counts (3 total votes)
- [ ] Merkle root is displayed
- [ ] No errors in browser console
- [ ] No errors in terminal logs

## Performance Notes

On Anvil (local testnet):
- Setup Demo: ~10 seconds (3 transactions + key generation)
- Vote: ~2 seconds (1 transaction)
- Decrypt & Tally: ~5 seconds (fetch events + decrypt + 1 transaction)

## Next Steps

After successful test:
1. Try voting multiple times (different accounts)
2. Test with different threshold values (modify setup-demo.ts)
3. Implement Merkle proof verification UI
4. Deploy to Sepolia testnet
