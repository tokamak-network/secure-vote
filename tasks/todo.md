# Secure Vote - TODO

## Current Direction: MACI + MaciRLA

**Goal:**
- Gas-efficient private voting using MACI + margin-adaptive Risk-Limiting Audit
- Coordinator processes votes off-chain, submits batch proofs
- MaciRLA samples a subset of proofs based on election margin
- Economic challenge mechanism as secondary defense

**Key references:**
- `maci-test/papers/outline.md` — Protocol design (Sections 1-8)
- `maci-test/papers/section9-evaluation.md` — Implementation & evaluation
- `maci-test/contracts/MaciRLA.sol` — On-chain RLA state machine
- `maci-test/experiments/results/` — Gas analysis & simulation data

---

## Completed

### Phase 1-4: Core Crypto + Coordinator + Contract + Integration
- [x] MACI key generation/change (`offchain/src/crypto/maci/`)
- [x] Coordinator state management & message processing (`offchain/src/coordinator/`)
- [x] MACIVoting.sol contract + 27 tests
- [x] BisectionGame.sol challenge mechanism

### Phase 5: ZKP Circuit
- [x] Circom circuit + Poseidon hash migration
- [x] Groth16 proof generation/verification (snarkjs)
- [x] GeneratedVerifier.sol from actual circuit compilation
- [x] On-chain real proof verification tests

### Phase 7: Official MACI E2E
- [x] `maci-test/` isolated test environment with MACI v2.5.0
- [x] 5-voter & 10-voter E2E tests (real Groth16 proofs)
- [x] ProcessMessages + TallyVotes pipeline verified

### Phase 8: MaciRLA Protocol
- [x] MaciRLA.sol — 7-phase state machine (933 lines)
- [x] Commit-reveal randomness (blockhash-based)
- [x] Margin-adaptive sample count calculation
- [x] Challenge/response with stake/bond economics
- [x] 10-voter E2E tests across 4 margin ratios (9:1, 7:3, 6:4, 5:5)
- [x] Gas analysis: 97% savings at 1000 voters / 80% margin
- [x] Mathematical simulation: 42 scenarios (10-1000 voters)

### Phase 9: Production Platform
- [x] Next.js frontend (voter UI + coordinator dashboard + results page)
- [x] Coordinator service (proof pipeline + MaciRLA workflow)
- [x] RLA progress visualization (phase stepper, savings display)

### Infrastructure
- [x] Legacy code moved to `legacy/` (threshold crypto, old frontend)
- [x] README rewritten for MACI + MaciRLA direction

---

## Open Items

### Security Hardening
- [ ] Coordinator auth: require `COORDINATOR_PASSWORD` env (remove default fallback)
- [ ] Protect `pages/api/coordinator/*` routes with cookie check
- [ ] Add `.gitignore` entries for deploy-config.json, .env.local, *.log

### Production Readiness
- [ ] Production trusted setup (multi-party ceremony for Groth16)
- [ ] Distributed randomness for sampling seed (replace blockhash)
- [ ] Gas optimization pass on MaciRLA.sol
- [ ] L2 deployment consideration

### Testing & Validation
- [ ] Large-scale E2E test (50+ voters with actual proofs, needs high-memory machine)
- [ ] Challenge scenario E2E tests (slash path, timeout path)
- [ ] Foundry BisectionGame tests update (legacy proof data needs refresh)

### Research Extensions
- [ ] Repeated election reputation effects
- [ ] Coordinator-challenger collusion analysis
- [ ] Irrational attacker model

---

## Verification Commands

```bash
# MaciRLA E2E tests (primary)
cd maci-test && npx hardhat test

# Foundry MACI tests
forge test --match-contract "MACIVoting|ZKP|Bisection"

# Platform
cd maci-test && ./scripts/start-platform.sh

# Gas analysis
cd maci-test && npx hardhat test --grep "gas"
```
