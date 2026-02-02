# Secure Vote - Off-chain Cryptography Library

TypeScript library for threshold cryptography operations in secure voting.

## Features

- **ElGamal Encryption** on BN254 (alt_bn128) curve
- **Shamir Secret Sharing** for threshold key management
- **Distributed Key Generation** (DKG) simplified version
- **Threshold Decryption** with k/n committee consensus
- **Vote Aggregation** with Merkle tree for fraud proofs

## Installation

```bash
npm install
```

## Usage

### 1. Generate Threshold Key

```typescript
import { generateThresholdKey } from './src';

// Generate key for 5 committee members with threshold 3
const { publicKey, shares, threshold } = generateThresholdKey(5, 3);

// Distribute shares[i] to committee member i
```

### 2. Encrypt Vote

```typescript
import { encrypt } from './src';

// Voter encrypts their vote (0 = no, 1 = yes)
const vote = 1n;
const ciphertext = encrypt(vote, publicKey);

// Submit ciphertext to blockchain
```

### 3. Create Decryption Shares

```typescript
import { createDecryptionShare } from './src';

// Each committee member creates a decryption share
const share = createDecryptionShare(
  ciphertext,
  shares[memberIndex],
  memberIndex + 1
);

// Share is sent to other committee members (off-chain)
```

### 4. Aggregate and Tally

```typescript
import { VoteAggregator, createAllDecryptionShares } from './src';

const aggregator = new VoteAggregator();

// Add all encrypted votes
for (const [voter, ciphertext, timestamp] of votes) {
  aggregator.addVote(voter, ciphertext, timestamp);
}

// Create decryption shares (by k committee members)
const secretShares = [
  { memberIndex: 1, share: shares[0] },
  { memberIndex: 3, share: shares[2] },
  { memberIndex: 5, share: shares[4] },
];

const sharesMap = createAllDecryptionShares(
  aggregator.getVotes(),
  secretShares
);

// Decrypt and tally
const decryptedVotes = aggregator.decryptVotes(sharesMap);
const result = aggregator.tallyVotes(decryptedVotes);

console.log('Yes:', result.yesVotes);
console.log('No:', result.noVotes);
console.log('Merkle Root:', result.votesRoot);
```

### 5. Generate Merkle Proof (for Disputes)

```typescript
// Generate proof for a specific vote
const proof = aggregator.generateMerkleProof(result.votes, voteIndex);

// Verify proof
const isValid = VoteAggregator.verifyMerkleProof(
  vote,
  voteIndex,
  proof,
  result.votesRoot
);
```

## API Reference

### ElGamal Encryption

#### `encrypt(message: bigint, publicKey: G1Point): Ciphertext`

Encrypt a message with ElGamal.

- `message`: 0 (no) or 1 (yes)
- `publicKey`: Committee's threshold public key
- Returns: Ciphertext `{c1, c2}`

#### `decrypt(ciphertext: Ciphertext, secretKey: Scalar): G1Point`

Decrypt with full secret key (not threshold).

#### `decryptMessage(ciphertext: Ciphertext, secretKey: Scalar): bigint | null`

Decrypt and solve discrete log (for small messages).

#### `serializeCiphertext(ciphertext: Ciphertext): string`

Serialize ciphertext to hex string for on-chain storage.

#### `deserializeCiphertext(hex: string): Ciphertext`

Deserialize ciphertext from hex string.

---

### Shamir Secret Sharing

#### `splitSecret(secret: Scalar, n: number, k: number): Share[]`

Split secret into n shares with threshold k.

#### `reconstructSecret(shares: Share[]): Scalar`

Reconstruct secret from k or more shares.

---

### Distributed Key Generation

#### `generateThresholdKey(n: number, k: number): ThresholdKeyPair`

Generate threshold keypair.

- `n`: Total committee members
- `k`: Threshold (minimum members needed)
- Returns: `{ publicKey, shares, threshold, totalParties }`

#### `createDecryptionShare(ciphertext: Ciphertext, secretShare: Share, memberIndex: number): DecryptionShare`

Create decryption share for a ciphertext.

#### `thresholdDecrypt(ciphertext: Ciphertext, decryptionShares: DecryptionShare[]): bigint | null`

Decrypt with threshold decryption shares.

---

### Vote Aggregation

#### `class VoteAggregator`

Manages encrypted votes and aggregation.

**Methods:**

- `addVote(voter: string, ciphertext: Ciphertext, timestamp: number)`: Add encrypted vote (supports overwrite)
- `getVotes(): Vote[]`: Get all votes
- `decryptVotes(sharesMap: Map<string, DecryptionShare[]>): DecryptedVote[]`: Decrypt all votes
- `tallyVotes(decryptedVotes: DecryptedVote[]): TallyResult`: Aggregate and generate Merkle root
- `generateMerkleProof(decryptedVotes: DecryptedVote[], voteIndex: number): string[]`: Generate proof
- `static verifyMerkleProof(vote, index, proof, root): boolean`: Verify proof

---

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Build
npm run build
```

## Example

See `examples/voting-flow.ts` for a complete end-to-end example.

```bash
# Run example (after build)
ts-node examples/voting-flow.ts
```

## Architecture

```
src/
├── crypto/
│   ├── elgamal.ts       # ElGamal encryption/decryption
│   ├── shamir.ts        # Shamir Secret Sharing
│   └── dkg.ts           # Threshold key generation & decryption
├── aggregator.ts        # Vote aggregation & Merkle tree
└── index.ts             # Main exports

test/
└── crypto.test.ts       # Unit tests (11 tests)
```

## Security Considerations

### Cryptography

- **Curve**: BN254 (alt_bn128) - EVM compatible
- **Field**: 254-bit prime field
- **Security**: ~128-bit security level

### Limitations

1. **Simple DKG**: Uses Shamir SS, not full DKG protocol
   - For production, use Pedersen DKG or Feldman VSS
2. **Small Message Space**: Discrete log works for small values only
   - Suitable for yes/no votes and small counts
3. **No Verification**: Decryption shares not verified
   - Add VSS commitments for verifiability

### Threat Model

**Protects Against:**
- Pre-tally bribery (vote overwrite)
- Post-tally bribery (aggregate-only reveal)
- k-1 malicious committee members

**Assumes:**
- At least k honest committee members
- Honest majority for DKG
- Secure off-chain communication

## Roadmap

### Phase 1: ✅ Complete
- [x] ElGamal encryption
- [x] Shamir Secret Sharing
- [x] Simple threshold decryption
- [x] Merkle tree aggregation
- [x] Unit tests

### Phase 2: Planned
- [ ] Verifiable Secret Sharing (VSS)
- [ ] Pedersen DKG
- [ ] Share verification
- [ ] Precomputation tables (speed)

### Phase 3: Advanced
- [ ] ECDSA threshold signatures
- [ ] BLS signature aggregation
- [ ] Browser WASM build
- [ ] Integration tests with contracts

## License

MIT

## References

- ElGamal Encryption: Taher Elgamal, 1985
- Shamir Secret Sharing: Adi Shamir, 1979
- BN254 Curve: Paulo Barreto, Michael Naehrig, 2005
- Noble Curves: https://github.com/paulmillr/noble-curves
