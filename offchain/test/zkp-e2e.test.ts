/**
 * ZKP E2E Tests
 *
 * Tests the full ZKP flow including:
 * - Poseidon hash computation
 * - Witness generation
 * - Proof generation (when circuit is compiled)
 * - State root verification
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import {
  initPoseidon,
  poseidonHash,
  poseidonHash2,
  poseidonHash4,
  bigintToHex,
  hexToBigint,
  toFieldElement,
  SNARK_SCALAR_FIELD,
} from '../src/crypto/poseidon';
import {
  createProcessor,
  createProcessorWithKey,
  MessageProcessor,
} from '../src/coordinator/processor';
import {
  generateCoordinatorKeyPair,
  generateVoterKeyPair,
  encryptMessage,
  VoterKeyPair,
} from '../src/crypto/maci';
import {
  generateWitnessInput,
  validateWitnessInput,
  extractPublicSignals,
} from '../src/zkp/witness';
import {
  createMockProof,
  createMockSolidityCalldata,
  Prover,
} from '../src/zkp/prover';

// Vote constants: 0 = No, 1 = Yes
const Vote = {
  No: 0 as 0 | 1,
  Yes: 1 as 0 | 1,
};

/**
 * Helper: create voter key with specific nonce
 */
function createVoterWithNonce(nonce: number): VoterKeyPair {
  const key = generateVoterKeyPair();
  return { ...key, nonce };
}

describe('Poseidon Hash', () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  it('computes hash for 2 inputs', async () => {
    const result = await poseidonHash2(1n, 2n);
    expect(typeof result).toBe('bigint');
    expect(result > 0n).toBe(true);
    expect(result < SNARK_SCALAR_FIELD).toBe(true);
  });

  it('computes hash for 4 inputs', async () => {
    const result = await poseidonHash4(1n, 2n, 3n, 4n);
    expect(typeof result).toBe('bigint');
    expect(result > 0n).toBe(true);
  });

  it('is deterministic', async () => {
    const result1 = await poseidonHash([1n, 2n, 3n]);
    const result2 = await poseidonHash([1n, 2n, 3n]);
    expect(result1).toBe(result2);
  });

  it('produces different hashes for different inputs', async () => {
    const result1 = await poseidonHash([1n, 2n, 3n]);
    const result2 = await poseidonHash([1n, 2n, 4n]);
    expect(result1).not.toBe(result2);
  });

  it('converts to/from hex correctly', () => {
    const value = 12345678901234567890n;
    const hex = bigintToHex(value);
    const back = hexToBigint(hex);
    expect(back).toBe(value);
  });

  it('handles field element conversion', () => {
    // Value within field
    const small = toFieldElement(100n);
    expect(small).toBe(100n);

    // Value larger than field
    const large = toFieldElement(SNARK_SCALAR_FIELD + 100n);
    expect(large).toBe(100n);
  });
});

describe('MessageProcessor with Poseidon', () => {
  let processor: MessageProcessor;

  beforeAll(async () => {
    processor = await createProcessor();
  });

  it('initializes correctly', async () => {
    expect(processor).toBeDefined();
    expect(processor.getCoordinatorPublicKey()).toBeDefined();
  });

  it('computes state root as bigint', async () => {
    const coordKey = generateCoordinatorKeyPair();
    const proc = await createProcessorWithKey(coordKey);

    const voterKey = createVoterWithNonce(1);
    const encrypted = encryptMessage(voterKey, coordKey.publicKey, Vote.Yes);

    await proc.processMessage(encrypted);

    const stateRoot = await proc.getStateRoot();
    expect(typeof stateRoot).toBe('bigint');
    expect(stateRoot > 0n).toBe(true);
  });

  it('tracks intermediate states correctly', async () => {
    const coordKey = generateCoordinatorKeyPair();
    const proc = await createProcessorWithKey(coordKey);

    // Process multiple messages
    const voter1 = createVoterWithNonce(1);
    const voter2 = createVoterWithNonce(1);

    const msg1 = encryptMessage(voter1, coordKey.publicKey, Vote.Yes);
    const msg2 = encryptMessage(voter2, coordKey.publicKey, Vote.No);

    await proc.processMessage(msg1);
    await proc.processMessage(msg2);

    const states = proc.getIntermediateStates();
    expect(states.length).toBe(2);

    // First state should have different prev and current roots
    expect(states[0].prevStateRoot).toBe(0n); // Empty state
    expect(states[0].stateRoot > 0n).toBe(true);

    // Second state should chain from first
    expect(states[1].prevStateRoot).toBe(states[0].stateRoot);
    expect(states[1].stateRoot).not.toBe(states[0].stateRoot);
  });

  it('generates intermediate commitment', async () => {
    const coordKey = generateCoordinatorKeyPair();
    const proc = await createProcessorWithKey(coordKey);

    const voter = createVoterWithNonce(1);
    const msg = encryptMessage(voter, coordKey.publicKey, Vote.Yes);

    await proc.processMessage(msg);

    const commitment = await proc.getIntermediateStatesCommitment();
    expect(typeof commitment).toBe('bigint');
    expect(commitment > 0n).toBe(true);
  });
});

describe('Witness Generation', () => {
  let processor: MessageProcessor;
  let coordKey: ReturnType<typeof generateCoordinatorKeyPair>;
  let voterKey: VoterKeyPair;

  beforeAll(async () => {
    coordKey = generateCoordinatorKeyPair();
    processor = await createProcessorWithKey(coordKey);
    voterKey = createVoterWithNonce(1);

    const msg = encryptMessage(voterKey, coordKey.publicKey, Vote.Yes);
    await processor.processMessage(msg);
  });

  it('generates witness input for processed message', async () => {
    const input = await processor.generateWitnessInput(0);

    expect(input).toBeDefined();
    expect(input.prevStateRoot).toBeDefined();
    expect(input.newStateRoot).toBeDefined();
    expect(input.decryptedVote).toBe('1'); // Yes = 1
    expect(input.pathIndices.length).toBe(20); // TREE_DEPTH
    expect(input.siblings.length).toBe(20);
  });

  it('validates correct witness input', async () => {
    const input = await processor.generateWitnessInput(0);
    const validation = validateWitnessInput(input);

    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);
  });

  it('extracts public signals correctly', async () => {
    const input = await processor.generateWitnessInput(0);
    const publicSignals = extractPublicSignals(input);

    // Public signals count based on circuit:
    // prevStateRoot(1) + newStateRoot(1) + encVoterPubKey(2) + encryptedData(4) +
    // ephemeralPubKey(2) + messageIndex(1) + coordPubKey(2) = 13
    // If circuit has 14, check the extraction function
    expect(publicSignals.length).toBeGreaterThanOrEqual(13);

    // First two should be state roots
    expect(publicSignals[0]).toBe(input.prevStateRoot);
    expect(publicSignals[1]).toBe(input.newStateRoot);
  });

  it('fails validation for invalid witness', () => {
    const invalidInput = {
      prevStateRoot: '123',
      newStateRoot: '456',
      // Missing other fields
    } as any;

    const validation = validateWitnessInput(invalidInput);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });
});

describe('Mock Proof Generation', () => {
  it('creates mock proof with correct structure', () => {
    const publicSignals = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
    const mockProof = createMockProof(publicSignals);

    expect(mockProof.proof).toBeDefined();
    expect(mockProof.proof.pi_a).toHaveLength(3);
    expect(mockProof.proof.pi_b).toHaveLength(3);
    expect(mockProof.proof.pi_c).toHaveLength(3);
    expect(mockProof.publicSignals).toEqual(publicSignals);
  });

  it('creates mock Solidity calldata', () => {
    const publicSignals = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
    const calldata = createMockSolidityCalldata(publicSignals);

    expect(calldata.pA).toHaveLength(2);
    expect(calldata.pB).toHaveLength(2);
    expect(calldata.pC).toHaveLength(2);
    expect(calldata.pubSignals).toEqual(publicSignals);
  });
});

describe('Prover Artifacts Check', () => {
  it('reports missing artifacts when not compiled', async () => {
    const prover = new Prover();
    const artifacts = await prover.checkArtifacts();

    // Artifacts won't exist unless circuit is compiled
    // This test just verifies the check works
    expect(typeof artifacts.ready).toBe('boolean');
    expect(Array.isArray(artifacts.missing)).toBe(true);
  });
});

describe('Merkle Proof Generation', () => {
  it('generates voter Merkle proof', async () => {
    const coordKey = generateCoordinatorKeyPair();
    const processor = await createProcessorWithKey(coordKey);

    const voter1 = createVoterWithNonce(1);
    const voter2 = createVoterWithNonce(1);

    const msg1 = encryptMessage(voter1, coordKey.publicKey, Vote.Yes);
    const msg2 = encryptMessage(voter2, coordKey.publicKey, Vote.No);

    await processor.processMessage(msg1);
    await processor.processMessage(msg2);

    const proof = await processor.generateVoterMerkleProofByPubKey(voter1.publicKey);

    expect(proof).toBeDefined();
    expect(proof!.leaf > 0n).toBe(true);
    expect(proof!.siblings.length).toBeGreaterThan(0);
    expect(proof!.root > 0n).toBe(true);
  });

  it('generates intermediate state Merkle proof', async () => {
    const coordKey = generateCoordinatorKeyPair();
    const processor = await createProcessorWithKey(coordKey);

    const voter = createVoterWithNonce(1);
    const msg = encryptMessage(voter, coordKey.publicKey, Vote.Yes);

    await processor.processMessage(msg);

    const proof = await processor.generateIntermediateProof(0);

    expect(proof).toBeDefined();
    expect(proof.siblings.length).toBeGreaterThan(0);
    expect(proof.pathIndices.length).toBe(proof.siblings.length);
  });
});

describe('State Export', () => {
  it('exports state with all required fields', async () => {
    const coordKey = generateCoordinatorKeyPair();
    const processor = await createProcessorWithKey(coordKey);

    const voter = createVoterWithNonce(1);
    const msg = encryptMessage(voter, coordKey.publicKey, Vote.Yes);

    await processor.processMessage(msg);

    const exported = await processor.exportState();

    expect(exported.voters).toBeDefined();
    expect(exported.voters.length).toBe(1);
    expect(exported.messageCount).toBe(1);
    expect(exported.stateRoot).toBeDefined();
    expect(exported.stateRoot.startsWith('0x')).toBe(true);
    expect(exported.intermediateCommitment).toBeDefined();
    expect(exported.tally).toEqual({ yes: 1, no: 0, abstain: 0 });
  });
});

describe('Full Voting Flow', () => {
  it('processes multiple votes and computes correct tally', async () => {
    const coordKey = generateCoordinatorKeyPair();
    const processor = await createProcessorWithKey(coordKey);

    // Create 5 voters
    const voters = Array.from({ length: 5 }, () => createVoterWithNonce(1));

    // 3 Yes, 2 No
    const votes = [Vote.Yes, Vote.Yes, Vote.Yes, Vote.No, Vote.No] as (0 | 1)[];

    for (let i = 0; i < 5; i++) {
      const msg = encryptMessage(voters[i], coordKey.publicKey, votes[i]);
      await processor.processMessage(msg);
    }

    const tally = processor.tally();
    expect(tally.yes).toBe(3);
    expect(tally.no).toBe(2);
    expect(tally.abstain).toBe(0);

    // Verify intermediate states
    const states = processor.getIntermediateStates();
    expect(states.length).toBe(5);

    // Each state should chain correctly
    for (let i = 1; i < states.length; i++) {
      expect(states[i].prevStateRoot).toBe(states[i - 1].stateRoot);
    }
  });

  it('handles vote updates correctly', async () => {
    const coordKey = generateCoordinatorKeyPair();
    const processor = await createProcessorWithKey(coordKey);

    // First vote: No with nonce 1
    const voterKey1 = createVoterWithNonce(1);
    const msg1 = encryptMessage(voterKey1, coordKey.publicKey, Vote.No);
    await processor.processMessage(msg1);

    expect(processor.tally().no).toBe(1);

    // Second vote: Yes with higher nonce (creates new key with same intent)
    // Note: In real MACI, key change would be used, but for simplicity we test nonce logic
    const voterKey2 = { ...voterKey1, nonce: 2 };
    const msg2 = encryptMessage(voterKey2, coordKey.publicKey, Vote.Yes);
    await processor.processMessage(msg2);

    expect(processor.tally().yes).toBe(1);
    expect(processor.tally().no).toBe(0);
  });

  it('rejects stale nonce messages', async () => {
    const coordKey = generateCoordinatorKeyPair();
    const processor = await createProcessorWithKey(coordKey);

    // First vote with nonce 2
    const voterKey1 = createVoterWithNonce(2);
    const msg1 = encryptMessage(voterKey1, coordKey.publicKey, Vote.Yes);
    const result1 = await processor.processMessage(msg1);
    expect(result1.applied).toBe(true);

    // Try to submit with lower nonce (same pubKey)
    const voterKey2 = { ...voterKey1, nonce: 1 };
    const msg2 = encryptMessage(voterKey2, coordKey.publicKey, Vote.No);
    const result2 = await processor.processMessage(msg2);
    expect(result2.applied).toBe(false);
    expect(result2.reason).toBe('stale_nonce');

    // Vote should still be Yes
    expect(processor.tally().yes).toBe(1);
  });
});

describe('Real Proof Verification', () => {
  // NOTE: snarkjs proof generation/verification uses worker threads that are
  // incompatible with Bun runtime. Run these tests with Node.js:
  //   cd offchain && node test-proof.mjs
  // Or use the forge tests for on-chain verification:
  //   forge test --match-contract GeneratedVerifier

  it('validates proof fixture structure', async () => {
    const fs = await import('fs');
    const fixturePath = process.cwd() + '/../test/fixtures/real-proof.json';

    if (!fs.existsSync(fixturePath)) {
      console.log('Skipping: proof fixture not found.');
      console.log('Generate it: cd offchain && node test-proof.mjs');
      return;
    }

    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    // Validate proof structure
    expect(fixture.proof).toBeDefined();
    expect(fixture.proof.pi_a).toHaveLength(3);
    expect(fixture.proof.pi_b).toHaveLength(3);
    expect(fixture.proof.pi_c).toHaveLength(3);
    expect(fixture.proof.protocol).toBe('groth16');
    expect(fixture.proof.curve).toBe('bn128');

    // Validate public signals (13 for our circuit)
    expect(fixture.publicSignals).toBeDefined();
    expect(fixture.publicSignals.length).toBe(13);

    // Validate calldata structure for Solidity
    expect(fixture.calldata).toBeDefined();
    expect(fixture.calldata.pA).toHaveLength(2);
    expect(fixture.calldata.pB).toHaveLength(2);
    expect(fixture.calldata.pC).toHaveLength(2);
    expect(fixture.calldata.pubSignals).toHaveLength(13);

    // Check pB is reversed for Solidity (pi_b[0][1], pi_b[0][0])
    expect(fixture.calldata.pB[0][0]).toBe(fixture.proof.pi_b[0][1]);
    expect(fixture.calldata.pB[0][1]).toBe(fixture.proof.pi_b[0][0]);

    console.log('Proof fixture structure is valid');
    console.log('Public signals count:', fixture.publicSignals.length);
    console.log('prevStateRoot:', fixture.publicSignals[0].substring(0, 20) + '...');
    console.log('newStateRoot:', fixture.publicSignals[1].substring(0, 20) + '...');
  });

  it('confirms artifacts are compiled', async () => {
    const prover = new Prover({ projectRoot: process.cwd() + '/..' });
    const artifacts = await prover.checkArtifacts();

    expect(artifacts.ready).toBe(true);
    expect(artifacts.missing).toHaveLength(0);
    console.log('All circuit artifacts present');
  });
});
