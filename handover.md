# Secure Vote — Handover Document

## Project Purpose

Secure Vote is a blockchain-based private voting system that combines
**MACI** (Minimal Anti-Collusion Infrastructure) with a custom
**Risk-Limiting Audit (RLA)** verification layer called **MaciRLA**.

The core problem: MACI uses ZK proofs to ensure voting correctness, but
verifying all batch proofs on-chain is gas-prohibitive at scale.
MaciRLA replaces full verification with statistical sampling —
verify a subset of proofs, back the rest with economic incentives
(coordinator stake + challenger bond).

Key properties:
- Anti-collusion via MACI's key-change mechanism (voters can't prove their vote)
- Privacy via encrypted ballots (only coordinator decrypts)
- Gas efficiency via margin-adaptive RLA sampling (up to 97% savings)
- Economic security via stake/slash/challenge mechanism

---

## Architecture

```
maci-test/                         # Active development root
├── contracts/
│   ├── MaciRLA.sol                # Core: 7-phase RLA state machine (~1000 lines)
│   ├── MACI.sol                   # Standard MACI contract (from PSE)
│   ├── Poll.sol                   # Poll management
│   ├── Tally.sol                  # Tally contract
│   ├── MessageProcessor.sol       # Message processing
│   ├── crypto/                    # Poseidon, BabyJubJub, Groth16 Verifier
│   ├── trees/                     # Merkle tree implementations (AccQueue)
│   ├── gatekeepers/               # Signup gatekeepers (FreeForAll, Semaphore, etc.)
│   └── interfaces/                # Contract interfaces
│
├── coordinator/src/               # Off-chain coordinator service
│   ├── index.ts                   # Main entry point
│   ├── maci-deploy.ts             # MACI deployment logic
│   ├── proof-pipeline.ts          # Groth16 proof generation pipeline
│   ├── rla-pipeline.ts            # RLA-specific proof workflow
│   └── utils.ts                   # Shared utilities
│
├── frontend/                      # Next.js web UI (Carbon-inspired dark theme)
│   ├── pages/
│   │   ├── index.tsx              # Election list (voter view)
│   │   ├── elections/create.tsx   # Create election form
│   │   ├── elections/[id]/        # Vote page + results
│   │   ├── coordinator/index.tsx  # Coordinator dashboard
│   │   ├── coordinator/[id].tsx   # Per-election coordinator controls
│   │   ├── coordinator/login.tsx  # Auth gate
│   │   └── api/coordinator/       # Backend API routes
│   │       ├── process.ts         # Process messages
│   │       ├── rla-commit.ts      # Phase 1: commit result
│   │       ├── rla-reveal.ts      # Phase 2: reveal sample
│   │       ├── rla-prove.ts       # Phase 3: submit proofs
│   │       ├── rla-proofs.ts      # Check proof status
│   │       ├── rla-finalize.ts    # Phase 7: finalize
│   │       └── challenge-respond.ts
│   ├── components/
│   │   ├── Layout.tsx             # Global layout (dark theme)
│   │   ├── ElectionCard.tsx       # Election summary card
│   │   ├── CoordinatorGuard.tsx   # Auth wrapper
│   │   └── RlaStatus.tsx          # RLA phase status display
│   └── lib/
│       ├── contracts.ts           # ABI definitions, contract addresses
│       └── server.ts              # Server-side helpers
│
├── test/                          # Hardhat E2E tests
│   ├── five-vote-e2e.ts           # 5-voter E2E with real ZK proofs
│   ├── rla-e2e.ts                 # RLA flow E2E test
│   ├── rla-scenarios-e2e.ts       # Multiple margin scenarios
│   ├── benchmark-e2e.ts           # Gas benchmarking
│   └── benchmark-config.ts        # Benchmark parameters
│
├── experiments/                   # Data analysis scripts
│   ├── gas-analysis.ts            # On-chain gas measurement
│   ├── simulate.ts                # RLA sampling simulation
│   ├── real-data-analysis.py      # UMA dispute data analysis
│   └── results/                   # JSON output files
│
├── scripts/                       # Utilities and debugging
│   ├── deploy-platform.ts         # Full platform deployment
│   ├── coordinator-commitments.ts # Manual commitment submission
│   ├── coordinator-prove-batch.ts # Manual batch proof submission
│   ├── download-zkeys.sh          # Fetch trusted setup files
│   ├── start-platform.sh          # One-command local start
│   └── check-*.ts                 # Debugging/inspection scripts
│
├── circuits/                      # Circom circuit configurations
├── zkeys/                         # Trusted setup files (not committed)
└── hardhat.config.ts              # Hardhat configuration
```

### Legacy directories (not active)

```
legacy/          # Old threshold-crypto design (ElGamal, committee DKG)
src/             # Foundry contracts (BisectionGame, earlier MACI integration)
offchain/        # Earlier off-chain crypto services
circuits/        # Root-level circom circuits
```

---

## MaciRLA Contract — 7-Phase Protocol

The core state machine in `MaciRLA.sol`:

```
Phase 0: Idle
Phase 1: commitResult()     — Coordinator stakes ETH, publishes all
                               intermediate state commitments + claimed tally
Phase 2: revealSample()     — After BLOCK_HASH_DELAY blocks, derive random
                               batch indices from blockhash
Phase 3: submitBatchProof() — Coordinator submits Groth16 proofs for
                               sampled batches (deadline: 1 day)
Phase 4: finalizeSampling() — All sampled proofs pass → Tentative
Phase 5: challenge()        — 7-day window: anyone posts bond to demand
                               full verification
Phase 6: respondToChallenge() — Coordinator submits remaining proofs
                                 (deadline: 3 days) or gets slashed
Phase 7: finalize()         — No challenge after 7 days → Finalized
```

Key parameters:
| Parameter | Default | Notes |
|---|---|---|
| `CHALLENGE_PERIOD` | 7 days | Challenge window |
| `PROOF_DEADLINE` | 1 day | Sampled proof submission |
| `CHALLENGE_RESPONSE_DEADLINE` | 3 days | Full proof after challenge |
| `CONFIDENCE_X1000` | 2996 | -ln(0.05) × 1000 = 95% confidence |
| `BLOCK_HASH_DELAY` | 1 block | Commit-reveal randomness delay |

Batch types:
- **PM (ProcessMessage)**: Sequential commitment chain. Always fully verified
  (sampling is unsound due to chain dependency).
- **TV (TallyVotes)**: Independent batches. Sampled via RLA formula:
  `S_TV = min(ceil(C × B_TV / B_claimed), B_TV)`

---

## Development Status

### What is built and working

1. **MaciRLA smart contract** — Full 7-phase state machine with:
   - Commit/reveal randomness
   - Margin-adaptive TV sampling
   - Full PM verification enforcement
   - Challenger bond + coordinator stake + slashing
   - Zero-margin full-proof fallback

2. **MACI integration** — Standard MACI contracts (PSE fork) with:
   - Signup, vote encryption, key-change
   - ProcessMessages + TallyVotes circuits
   - Groth16 proof generation and on-chain verification

3. **Frontend** — Next.js app with:
   - Voter view: election list, vote casting, results
   - Coordinator dashboard: RLA phase management, proof submission
   - Dark theme UI (Carbon-inspired)
   - wagmi/viem for wallet integration

4. **Coordinator service** — Off-chain pipeline for:
   - Proof generation (Groth16 via snarkjs)
   - RLA commitment computation
   - Batch proof submission workflow

5. **E2E tests** — Hardhat tests with real ZK proofs:
   - 5-voter and 10-voter scenarios
   - Multiple margin scenarios (high/low/zero)
   - Gas benchmarking

6. **Experiment scripts** — Analysis against 352 real UMA disputes:
   - Gas cost comparison (Full MACI vs MaciRLA)
   - Savings distribution analysis

### Known issues and limitations

1. **Blockhash randomness (A3)** — Current implementation uses blockhash
   for RLA sampling randomness. Block proposers have non-negligible
   influence (last-revealer problem). A VRF or threshold commit-reveal
   scheme is the recommended upgrade for production, but is not
   implemented.

2. **deployed-contracts.json is empty** — No persistent testnet or
   mainnet deployment. The system runs on local Hardhat network only.

3. **Coordinator auth** — Minimal auth gate (`CoordinatorGuard.tsx`).
   Not production-ready authentication.

4. **Frontend state management** — Direct contract reads via wagmi.
   No caching layer or optimistic updates. Can be slow with many polls.

5. **PM full verification gas** — PM batches are always fully verified.
   For very large elections (1000+ voters), PM verification alone may
   be expensive. No optimization path exists for PM batches due to the
   sequential chain structure (see Lemma 2 in the formal analysis).

---

## How to Run

### Prerequisites

- Node.js 18+
- pnpm
- git

### Quick start

```bash
cd maci-test
pnpm install
./scripts/download-zkeys.sh    # ~200MB, required for proof generation
npx hardhat compile
npx hardhat test               # Runs E2E tests with real ZK proofs
```

### Run the full platform (local)

```bash
cd maci-test
./scripts/start-platform.sh
# Starts: Hardhat node → deploys contracts → launches frontend at :3000
```

### Run specific tests

```bash
npx hardhat test test/rla-e2e.ts           # RLA flow only
npx hardhat test test/rla-scenarios-e2e.ts # Multiple margin scenarios
npx hardhat test test/benchmark-e2e.ts     # Gas benchmarking
```

---

## Remaining Work (Development)

### High priority

- [ ] **Testnet deployment** — Deploy to Sepolia or other L2 testnet.
      Update `deployed-contracts.json` and frontend env vars.
- [ ] **VRF randomness** — Replace blockhash with Chainlink VRF or
      similar for production-grade sampling randomness.
- [ ] **Statistical consistency check** — Implement the on-chain z-test
      for sub-threshold fraud detection (Proposition 5.1 in the formal
      analysis). Requires comparing batch-level tally means against
      the claimed margin. Integer arithmetic only.

### Medium priority

- [ ] **Frontend polish** — Error handling, loading states, mobile
      responsiveness, results page improvements.
- [ ] **Coordinator authentication** — Proper auth (wallet signature
      or API key) for coordinator endpoints.
- [ ] **Multi-coordinator support** — Current design assumes a single
      coordinator per election. Consider multi-coordinator scenarios.
- [ ] **Gas optimization** — Profile and optimize MaciRLA contract for
      large batch counts. Consider batched proof submission.

### Low priority

- [ ] **Event indexing** — Add subgraph or indexer for historical
      election data instead of direct contract reads.
- [ ] **Challenge UI** — Frontend interface for challengers to submit
      bonds and monitor challenge responses.
- [ ] **Documentation** — API documentation for coordinator endpoints,
      contract NatSpec improvements.

---

## Key Design Decisions

1. **PM full verification is mandatory** — PM batches form a sequential
   commitment chain (batch i depends on batch i-1). Sampling PM batches
   creates a security gap that no finite stake can close. This is proven
   formally and enforced in the contract (`S_PM = B_PM` always).

2. **Margin-adaptive sampling** — The number of TV batches sampled
   depends on the claimed margin. Wider margins require fewer samples.
   This is the source of gas savings.

3. **Blockhash commit-reveal** — The coordinator commits the result
   before the sampling randomness is known. After `BLOCK_HASH_DELAY`
   blocks, the blockhash provides the random seed. This prevents the
   coordinator from choosing which batches to prepare proofs for.

4. **Dual defense (sampling + challenge)** — Sampling alone has a
   false-negative rate of α (5%). The challenge window adds a second
   layer: any party can demand full verification by posting a bond.
   Combined fraud-success probability = α × P(no rational challenger).

5. **MACI contracts are a PSE fork** — The MACI contracts
   (MACI.sol, Poll.sol, Tally.sol, MessageProcessor.sol) are from the
   Privacy & Scaling Explorations team with minimal modifications.
   MaciRLA.sol is the only custom contract.

---

## Repository Hygiene

- `maci-test/paper/` — Contains confidential research files. Gitignored.
  Do not commit anything from this directory.
- `*.md` files inside `maci-test/` — Research/analysis notes. Gitignored
  (except README.md). Do not commit.
- `maci-test/charts/` — Generated figures. Gitignored.
- Trusted setup files (`zkeys/`) — Downloaded via script, not committed.

---

## Developer

- **Suhyeon Lee** — orion-alpha [at] korea.ac.kr

## References

- MACI documentation: https://maci.pse.dev/
- PSE MACI GitHub: https://github.com/privacy-scaling-explorations/maci
- RLA theory: Lindeman & Stark, "A Gentle Introduction to Risk-Limiting
  Audits", IEEE S&P 2012
