# Secure Vote

Threshold cryptography-based commit-reveal voting system with fraud proofs and anti-bribery mechanisms.

## Features

### Core Voting System
- **Commit-Reveal with Overwrite**: Voters can update their encrypted votes during commit phase (pre-tally bribery defense)
- **Threshold Encryption**: Committee uses threshold ElGamal for decryption (k/n consensus required)
- **Off-chain Decryption**: Committee decrypts votes off-chain and submits only aggregate results
- **Fraud Proof with Merkle Root**: Challenge period with Merkle commitment for trustless verification (post-tally bribery defense)

### Committee Management
- **Multi-Committee Support**: Multiple committees can coexist, each managing their own proposals
- **Consensus-Based Rotation**: Current committee can propose and approve rotation to new members
- **Flexible Eligibility Rules**: Pluggable eligibility contracts (whitelist, staking, DAO voting, etc.)
- **Bond/Slashing**: Economic security through committee member bonds

### Anti-Bribery Design

#### Pre-tally Bribery Defense
- Vote overwrite: Latest commit is the only valid vote
- Voters can change their mind until commit period ends

#### Post-tally Bribery Defense
- Aggregate-only reveal: Individual votes not published on-chain
- Merkle commitment: Committee commits to vote root without revealing individual votes
- Challenge period: 7-day window for disputes (delays bribery contract verification)
- Fraud proof: Trustless verification if challenged

## Architecture

```
SecureVoting.sol          # Main voting contract
├── Committee Management  # Multi-committee with rotation
├── Proposals            # Create proposals with commit/reveal phases
├── Voting               # Commit encrypted votes (with overwrite)
├── Tally                # Submit aggregate results with Merkle root
├── Fraud Proof          # Challenge mechanism with 7-day period
└── Governance           # Eligibility rule changes

ICommitteeEligibility.sol # Interface for eligibility verification
└── WhitelistEligibility  # Initial implementation (Phase 1)
└── StakingEligibility    # Future: Staking-based (Phase 2)
└── DAOEligibility        # Future: DAO voting-based (Phase 3)
```

## Installation

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
forge install
```

## Usage

### Compile

```bash
forge build
```

### Test

```bash
# Run all tests
forge test

# Run with verbose output
forge test -vv

# Run with gas report
forge test --gas-report

# Run specific test
forge test --match-test test_CommitVote
```

### Deploy

```bash
# Set environment variables
export PRIVATE_KEY=0x...
export RPC_URL=https://...

# Deploy
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
```

## Workflow

### 1. Setup (One-time)

```solidity
// Deploy whitelist eligibility
address[] memory committee = [addr1, addr2, addr3, addr4, addr5];
WhitelistEligibility eligibility = new WhitelistEligibility(committee);

// Off-chain: Committee performs DKG to generate threshold public key
bytes memory publicKey = dkg.generateThresholdKey(committee, threshold);

// Deploy voting contract
SecureVoting voting = new SecureVoting(
    committee,
    3, // threshold (3/5)
    publicKey,
    eligibility
);

// Committee members deposit bonds
voting.depositBond{value: 10 ether}();
```

### 2. Create Proposal

```solidity
uint256 proposalId = voting.createProposal(
    "Should we upgrade the protocol?",
    7 days,  // commit period
    3 days   // reveal period
);
```

### 3. Vote (Commit Phase)

```solidity
// Off-chain: Encrypt vote with committee's public key
bytes memory encryptedVote = elgamal.encrypt(vote, publicKey);

// On-chain: Submit encrypted vote
voting.commitVote(proposalId, encryptedVote);

// Can overwrite vote before deadline
voting.commitVote(proposalId, newEncryptedVote);
```

### 4. Tally (Reveal Phase)

```solidity
// Off-chain:
// 1. Committee members exchange decryption shares
// 2. Decrypt all votes once k/n shares collected
// 3. Aggregate: count yes/no votes
// 4. Build Merkle tree of decrypted votes
// 5. Compute Merkle root

// On-chain: Submit only aggregate + root
voting.submitTally(
    proposalId,
    42, // yes votes
    38, // no votes
    merkleRoot
);
```

### 5. Challenge (Optional)

```solidity
// Anyone can challenge within 7 days
voting.challengeTally{value: 5 ether}(proposalId);

// Committee must reveal proofs or get slashed
// (Dispute resolution mechanism - to be implemented)
```

### 6. Finalize

```solidity
// After 7 days with no successful challenge
voting.finalizeTally(proposalId);
```

### 7. Committee Rotation

```solidity
// Off-chain: New committee performs DKG
bytes memory newPublicKey = dkg.generateThresholdKey(newCommittee, newThreshold);

// Propose rotation
voting.proposeCommitteeRotation(newCommittee, newThreshold, newPublicKey);

// Current committee approves (need k/n approvals)
voting.approveRotation(); // called by member1
voting.approveRotation(); // called by member2
voting.approveRotation(); // called by member3

// Execute once threshold reached
voting.executeRotation();

// Old committee still handles their proposals
// New proposals use new committee
```

## Gas Costs

| Operation | Gas Cost |
|-----------|----------|
| Create Proposal | ~145k |
| Commit Vote | ~72k (avg) |
| Submit Tally | ~150k |
| Challenge Tally | ~53k |
| Finalize Tally | ~58k |
| Committee Rotation | ~267k |

## Security Considerations

### Trust Assumptions
- **Phase 1 (Current)**: Trust committee to correctly decrypt and aggregate (enforced by bonds + fraud proofs)
- **Phase 2 (Future)**: Staking-based committee for permissionless participation
- **Phase 3 (Future)**: ZK proofs for perfect trustlessness

### Known Limitations
1. **Dispute Resolution**: Basic fraud proof mechanism (needs full dispute resolution implementation)
2. **Committee Collusion**: If k/n members collude, they can submit false tallies (mitigated by bonds)
3. **Data Availability**: Encrypted votes stored on-chain (consider IPFS for large-scale)
4. **Post-tally Privacy**: Dispute reveals votes (trade-off for trustlessness)

### Recommended Parameters
- Committee size: 5-7 members
- Threshold: 60-70% (e.g., 3/5, 4/7)
- Bond per member: 10-50 ETH
- Challenge bond: 5-10 ETH
- Challenge period: 7 days
- Min committee duration: 30 days

## Roadmap

### Phase 1: MVP ✅
- [x] Basic commit-reveal voting
- [x] Vote overwrite
- [x] Committee rotation
- [x] Eligibility rules
- [x] Fraud proof with Merkle root
- [x] Bond/slashing

### Phase 2: Enhancement
- [ ] Full dispute resolution mechanism
- [ ] Staking-based eligibility
- [ ] Gas optimizations
- [ ] Off-chain TypeScript library (DKG, ElGamal)
- [ ] Integration tests with real crypto

### Phase 3: Advanced
- [ ] ECDSA threshold signatures (GG20)
- [ ] ZK proofs for perfect privacy
- [ ] Homomorphic aggregation
- [ ] L2 deployment

## Off-chain Components (To Be Implemented)

The following off-chain tools are needed for full operation:

### TypeScript Library (`offchain/`)
```typescript
// DKG - Distributed Key Generation
dkg.generateThresholdKey(members, threshold)

// ElGamal encryption/decryption
elgamal.encrypt(vote, publicKey)
elgamal.decrypt(ciphertext, shares)

// Aggregation
aggregator.tallyVotes(decryptedVotes)
aggregator.buildMerkleTree(votes)
```

## Testing

Current test coverage:
- Basic voting flow
- Vote overwrite
- Committee rotation
- Eligibility changes
- Fraud proof challenges
- Fuzzing tests for edge cases

```bash
# Run tests with coverage
forge coverage
```

## License

MIT

## Acknowledgments

Inspired by:
- Kleros v2 (Shutter Network integration)
- Threshold cryptography research
- Optimistic Rollup fraud proof designs
