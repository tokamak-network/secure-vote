# Secure Vote

MACI-based private voting with MaciRLA (Risk-Limiting Audit) for gas-efficient on-chain verification.

## Overview

Secure Vote combines [MACI](https://maci.pse.dev/) (Minimum Anti-Collusion Infrastructure) with a novel margin-adaptive sampling protocol called **MaciRLA**. Instead of verifying every ZKP batch proof on-chain, MaciRLA samples a subset based on the election margin and backs the remaining proofs with economic incentives (stake/challenge).

**Core insight**: The wider the margin, the more batches an attacker must corrupt to flip the result, and the easier it is to detect via sampling. Safe elections are cheap to verify.

### Key Properties

- **Anti-collusion**: MACI's key-change mechanism prevents vote buying/coercion
- **Privacy**: Votes are encrypted; only the coordinator sees individual votes
- **Gas efficiency**: Margin-adaptive sampling reduces on-chain verification by up to 97%
- **Economic security**: Coordinator stake + challenger bond create a dual defense layer

## How It Works

### MACI Layer

1. Voters sign up with a public key and submit encrypted votes on-chain
2. Voters can change their key at any time, invalidating any prior proof of their vote (anti-bribery)
3. A coordinator processes votes off-chain and generates Groth16 batch proofs (ProcessMessages + TallyVotes)

### MaciRLA Layer (Verification Optimization)

Instead of verifying all batch proofs on-chain (Full MACI), MaciRLA runs a 7-phase protocol:

```
1. Commit     Coordinator stakes ETH + submits result commitments
2. Sample     Blockhash-based random seed selects which batches to verify
3. Prove      Coordinator submits Groth16 proofs for sampled batches only
4. Tentative  All sampled proofs pass → result is tentatively accepted
5. Challenge  7-day window: anyone can post bond to demand full proofs
6. Respond    Coordinator submits remaining proofs (or gets slashed)
7. Finalize   No challenge → finalized; successful response → finalized
```

### Security Model

**Pillar 1 — Probabilistic Detection (Sampling)**

Sample count is derived from the election margin:

```
S = ceil(-ln(alpha) * N / M)
```

Where `N` = total batches, `M` = minimum batches to corrupt for result flip, `alpha` = false-accept probability (default 0.05). Wider margins mean smaller `M` relative to `N`, so fewer samples suffice.

**Pillar 2 — Economic Deterrence (Challenge)**

After sampling passes, a Bayesian update drops the posterior corruption probability. A rational challenger will challenge only if the expected reward exceeds the bond. The coordinator's stake must satisfy:

```
stake >= V_corr * alpha / (1 - alpha)
```

At alpha=0.05, a stake of just 1/19th of the corruption value makes cheating unprofitable.

**Combined soundness**: `P(false accept) = P(sampling miss) * P(no rational challenge) <= alpha * (1-q)`

## Gas Savings (Experimental Results)

Measured per-proof gas: PM ~474k, TV ~402k. Extrapolated to larger elections:

| Voters | Margin | Full MACI Gas | MaciRLA Gas | Savings |
|--------|--------|---------------|-------------|---------|
| 100 | 80% | 37.9M | 7.4M | **80%** |
| 100 | 20% | 37.9M | 20.8M | **44%** |
| 500 | 80% | 156.3M | 7.9M | **94%** |
| 500 | 20% | 156.3M | 25.8M | **83%** |
| 1000 | 80% | 304.2M | 7.9M | **97%** |
| 1000 | 20% | 304.2M | 26.7M | **91%** |
| 1000 | 2% | 304.2M | 196.7M | **35%** |
| 1000 | 0% | 304.2M | 297.2M | 2% |

At high margins, sample count converges to ~8-10 regardless of voter count — verification cost approaches O(1).

## Architecture

```
maci-test/                      # Active development (MACI + MaciRLA)
├── contracts/
│   ├── MaciRLA.sol             # 7-phase RLA state machine
│   └── mocks/                  # Test helpers
├── coordinator/                # Off-chain proof pipeline
├── frontend/                   # Next.js voting UI + coordinator dashboard
├── experiments/                # Gas analysis & simulation scripts
│   └── results/                # gas-analysis-results.json, simulation-results.json
├── papers/                     # Protocol design & evaluation
├── test/                       # Hardhat E2E tests (10-voter real proofs)
├── circuits/                   # Groth16 circuit configs
├── zkeys/                      # Trusted setup files
└── scripts/                    # Build & test automation

src/                            # Foundry contracts (earlier MACI integration)
├── MACIVoting.sol              # MACI voting contract
├── BisectionGame.sol           # Interactive challenge game
├── Verifier.sol                # ZKP verifier interface
└── GeneratedVerifier.sol       # Generated Groth16 verifier

offchain/                       # Off-chain services
├── src/crypto/maci/            # MACI key management & encryption
├── src/crypto/poseidon.ts      # Poseidon hash utility
├── src/coordinator/            # Vote processing & state management
└── src/zkp/                    # Witness & proof generation

circuits/                       # Circom ZKP circuits
scripts/                        # ZKP setup & compilation scripts
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (for maci-test)
- Foundry (for src/ contracts)

### Install & Test (MaciRLA — primary)

```bash
cd maci-test
pnpm install

# Download test zkeys (required for proof generation)
./scripts/download-zkeys.sh

# Compile contracts
npx hardhat compile

# Run E2E tests (10-voter, real Groth16 proofs)
npx hardhat test
```

### Install & Test (Foundry contracts)

```bash
forge install
forge build

# Run MACI-related tests only
forge test --match-contract "MACIVoting|ZKP|Bisection"
```

### Run the Platform

```bash
cd maci-test
./scripts/start-platform.sh
```

This starts the Hardhat node, deploys contracts, and launches the frontend at `http://localhost:3000`.

## Protocol Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `CHALLENGE_PERIOD` | 7 days | Window for challengers after tentative result |
| `PROOF_DEADLINE` | 1 day | Deadline for sampled proof submission |
| `CHALLENGE_RESPONSE_DEADLINE` | 3 days | Coordinator response window after challenge |
| `CONFIDENCE_X1000` | 2996 | `-ln(0.05) * 1000`, 95% confidence level |
| `BLOCK_HASH_DELAY` | 1 block | Commit-reveal randomness delay |

## Research

The protocol design is documented in `maci-test/papers/`:

- `outline.md` — Full protocol specification (system model, game-theoretic analysis, soundness proofs)
- `section9-evaluation.md` — Implementation details and experimental evaluation

Key references:
- MACI (Ethereum Foundation PSE) — base voting layer
- Risk-Limiting Audits (Lindeman & Stark, 2012) — margin-adaptive sampling theory
- Proof of Sampling (Zhang et al., 2024) — game-theoretic sampling verification
- TrueBit / Optimistic Rollups — challenge/response pattern

## Legacy

The initial threshold cryptography design (commit-reveal with committee-based ElGamal decryption) has been moved to `legacy/`. This includes:

- `legacy/src/` — SecureVoting.sol, eligibility contracts
- `legacy/frontend/` — Original demo frontend
- `legacy/offchain/` — DKG, Shamir, ElGamal, silent-setup
- `legacy/script/` — Threshold deployment script
- `legacy/test/` — SecureVoting tests

These files are preserved for reference but are not part of the active development path.

## License

MIT
