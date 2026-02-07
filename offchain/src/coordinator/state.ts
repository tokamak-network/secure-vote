/**
 * Coordinator State Management
 *
 * Tracks voter states and computes state roots for on-chain submission.
 * Key change mechanism: higher nonce invalidates previous votes.
 *
 * Uses Poseidon hash for ZK-circuit compatibility.
 */

import { G1Point, serializePoint } from '../crypto/elgamal';
import { Vote, getPublicKeyHash } from '../crypto/maci';
import {
  initPoseidon,
  poseidonHash2,
  poseidonHash4,
  poseidonHash2Sync,
  poseidonHash4Sync,
  isPoseidonInitialized,
  bigintToHex,
  hexToBigint,
  toFieldElement,
  SNARK_SCALAR_FIELD,
} from '../crypto/poseidon';

/**
 * Individual voter's state
 */
export interface VoterState {
  pubKey: G1Point;
  pubKeyHash: string;
  vote: Vote | null; // null = registered but not voted
  nonce: number;
}

/**
 * Serialized voter state (for Merkle tree)
 */
export interface SerializedVoterState {
  pubKeyHash: string;
  vote: number; // 0, 1, or -1 for null
  nonce: number;
}

/**
 * Coordinator's full state
 */
export interface CoordinatorState {
  voters: Map<string, VoterState>; // pubKeyHash -> state
  messageCount: number;
  stateRoot: bigint;
}

/**
 * State tree node (for Merkle tree)
 */
interface MerkleNode {
  hash: bigint;
  left?: MerkleNode;
  right?: MerkleNode;
  data?: SerializedVoterState;
}

/**
 * Intermediate state for bisection fraud proof
 */
export interface IntermediateStateData {
  messageIndex: number;
  stateRoot: bigint;
  prevStateRoot: bigint;
}

/**
 * Merkle proof for a leaf
 */
export interface MerkleProof {
  leaf: bigint;
  siblings: bigint[];
  pathIndices: number[];
  root: bigint;
}

// Tree depth for voter states (supports 2^20 = ~1M voters)
export const TREE_DEPTH = 20;

/**
 * Get affine coordinates from G1Point
 */
function getPointCoordinates(point: G1Point): { x: bigint; y: bigint } {
  const affine = point.toAffine();
  return {
    x: toFieldElement(affine.x),
    y: toFieldElement(affine.y),
  };
}

/**
 * Hash a single voter state using Poseidon
 * Poseidon(pubKeyX, pubKeyY, vote, nonce)
 */
export async function hashVoterState(state: VoterState): Promise<bigint> {
  const coords = getPointCoordinates(state.pubKey);
  const vote = state.vote === null ? 255n : BigInt(state.vote);
  const nonce = BigInt(state.nonce);
  return poseidonHash4(coords.x, coords.y, vote, nonce);
}

/**
 * Hash voter state synchronously (requires initPoseidon called first)
 */
export function hashVoterStateSync(state: VoterState): bigint {
  if (!isPoseidonInitialized()) {
    throw new Error('Poseidon not initialized. Call initPoseidon() first.');
  }
  const coords = getPointCoordinates(state.pubKey);
  const vote = state.vote === null ? 255n : BigInt(state.vote);
  const nonce = BigInt(state.nonce);
  return poseidonHash4Sync(coords.x, coords.y, vote, nonce);
}

/**
 * Compute Merkle root from voter states using Poseidon
 *
 * Uses a fixed depth-20 binary tree to match the circuit's MerkleUpdate template.
 * Leaves are placed at positions 0..n-1, remaining positions are 0 (empty).
 */
export async function computeMerkleRoot(
  voters: Map<string, VoterState>
): Promise<bigint> {
  await initPoseidon();

  // Sort by pubKeyHash for deterministic ordering
  const sortedEntries = Array.from(voters.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  // Build leaf nodes
  const leaves: bigint[] = [];
  for (const [_, state] of sortedEntries) {
    leaves.push(hashVoterStateSync(state));
  }

  // Build fixed depth-20 Merkle tree
  return buildMerkleRootFixedDepth(leaves, TREE_DEPTH);
}

/**
 * Precomputed zero-subtree hashes for each level.
 * zeroHashes[0] = 0 (empty leaf)
 * zeroHashes[i] = Poseidon(zeroHashes[i-1], zeroHashes[i-1])
 */
let zeroHashes: bigint[] | null = null;

function getZeroHashes(): bigint[] {
  if (zeroHashes) return zeroHashes;
  zeroHashes = new Array(TREE_DEPTH + 1);
  zeroHashes[0] = 0n;
  for (let i = 1; i <= TREE_DEPTH; i++) {
    zeroHashes[i] = poseidonHash2Sync(zeroHashes[i - 1], zeroHashes[i - 1]);
  }
  return zeroHashes;
}

/**
 * Build Merkle root using fixed depth with zero-padding for empty leaves.
 * Matches the circuit's MerkleUpdate template exactly.
 *
 * Optimized: uses precomputed zero-subtree hashes so we only hash
 * populated portions of the tree.
 */
function buildMerkleRootFixedDepth(leaves: bigint[], depth: number): bigint {
  const zeros = getZeroHashes();

  // Sparse representation: only track non-zero nodes
  let currentLevel = new Map<number, bigint>();
  for (let i = 0; i < leaves.length; i++) {
    currentLevel.set(i, leaves[i]);
  }

  for (let level = 0; level < depth; level++) {
    const nextLevel = new Map<number, bigint>();
    // Collect all parent indices that have at least one non-zero child
    const parentIndices = new Set<number>();
    for (const idx of currentLevel.keys()) {
      parentIndices.add(Math.floor(idx / 2));
    }
    for (const parentIdx of parentIndices) {
      const left = currentLevel.get(parentIdx * 2) ?? zeros[level];
      const right = currentLevel.get(parentIdx * 2 + 1) ?? zeros[level];
      const hash = poseidonHash2Sync(left, right);
      // Only store if different from zero-subtree hash at next level
      if (hash !== zeros[level + 1]) {
        nextLevel.set(parentIdx, hash);
      }
    }
    currentLevel = nextLevel;
  }

  return currentLevel.get(0) ?? zeros[depth];
}

/**
 * Build compact Merkle root (variable depth) from leaf hashes.
 * Used for intermediate state commitments (not circuit-facing).
 */
function buildCompactMerkleRoot(leaves: bigint[]): bigint {
  if (leaves.length === 0) return 0n;
  if (leaves.length === 1) return leaves[0];

  const padded = [...leaves];
  if (padded.length % 2 === 1) padded.push(padded[padded.length - 1]);

  const parents: bigint[] = [];
  for (let i = 0; i < padded.length; i += 2) {
    parents.push(poseidonHash2Sync(padded[i], padded[i + 1]));
  }
  return buildCompactMerkleRoot(parents);
}

/**
 * Generate Merkle proof for a voter in a fixed depth-20 tree.
 * Returns exactly TREE_DEPTH siblings and pathIndices.
 */
export async function generateMerkleProof(
  voters: Map<string, VoterState>,
  targetPubKeyHash: string
): Promise<MerkleProof | null> {
  await initPoseidon();

  const zeros = getZeroHashes();

  // Sort voters
  const sortedEntries = Array.from(voters.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  // Find target index
  const targetIndex = sortedEntries.findIndex(
    ([hash]) => hash === targetPubKeyHash
  );
  if (targetIndex === -1) {
    return null;
  }

  // Build leaves as sparse map
  const leafMap = new Map<number, bigint>();
  for (let i = 0; i < sortedEntries.length; i++) {
    leafMap.set(i, hashVoterStateSync(sortedEntries[i][1]));
  }

  // Build proof through TREE_DEPTH levels
  const siblings: bigint[] = [];
  const pathIndices: number[] = [];
  let currentIndex = targetIndex;
  let currentLevel = leafMap;

  for (let level = 0; level < TREE_DEPTH; level++) {
    const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
    siblings.push(currentLevel.get(siblingIndex) ?? zeros[level]);
    pathIndices.push(currentIndex % 2);

    // Compute next level (sparse)
    const nextLevel = new Map<number, bigint>();
    const parentIndices = new Set<number>();
    for (const idx of currentLevel.keys()) {
      parentIndices.add(Math.floor(idx / 2));
    }
    // Also ensure the target's parent is computed
    parentIndices.add(Math.floor(currentIndex / 2));

    for (const parentIdx of parentIndices) {
      const left = currentLevel.get(parentIdx * 2) ?? zeros[level];
      const right = currentLevel.get(parentIdx * 2 + 1) ?? zeros[level];
      const hash = poseidonHash2Sync(left, right);
      if (hash !== zeros[level + 1]) {
        nextLevel.set(parentIdx, hash);
      }
    }

    currentIndex = Math.floor(currentIndex / 2);
    currentLevel = nextLevel;
  }

  const root = currentLevel.get(0) ?? zeros[TREE_DEPTH];

  return {
    leaf: leafMap.get(targetIndex)!,
    siblings,
    pathIndices,
    root,
  };
}

/**
 * Coordinator State Manager
 */
export class StateManager {
  private voters: Map<string, VoterState>;
  private messageCount: number;
  private initialized: boolean;

  constructor() {
    this.voters = new Map();
    this.messageCount = 0;
    this.initialized = false;
  }

  /**
   * Initialize Poseidon (call before using state computations)
   */
  async init(): Promise<void> {
    await initPoseidon();
    this.initialized = true;
  }

  /**
   * Ensure initialized
   */
  private ensureInit(): void {
    if (!this.initialized && !isPoseidonInitialized()) {
      throw new Error('StateManager not initialized. Call init() first.');
    }
    this.initialized = true;
  }

  /**
   * Pre-register a voter with zero-state (vote=0, nonce=0).
   * This places Poseidon(pubKeyX, pubKeyY, 0, 0) in the Merkle tree so
   * the circuit's MerkleUpdate can verify the old root for new voters.
   */
  preRegisterVoter(pubKey: G1Point): void {
    const pubKeyHash = getPublicKeyHash(pubKey);
    if (this.voters.has(pubKeyHash)) return;

    this.voters.set(pubKeyHash, {
      pubKey,
      pubKeyHash,
      vote: 0,
      nonce: 0,
    });
  }

  /**
   * Register a voter (initial state)
   */
  registerVoter(pubKey: G1Point, nonce: number = 0): void {
    const pubKeyHash = getPublicKeyHash(pubKey);

    const existing = this.voters.get(pubKeyHash);
    if (existing && existing.nonce >= nonce) {
      // Ignore if existing registration has higher or equal nonce
      return;
    }

    this.voters.set(pubKeyHash, {
      pubKey,
      pubKeyHash,
      vote: null,
      nonce,
    });
  }

  /**
   * Update voter's vote
   * Returns true if update was applied (higher nonce or same nonce)
   */
  updateVote(
    pubKey: G1Point,
    vote: Vote,
    nonce: number
  ): { applied: boolean; reason?: string } {
    const pubKeyHash = getPublicKeyHash(pubKey);
    const existing = this.voters.get(pubKeyHash);

    if (!existing) {
      // New voter
      this.voters.set(pubKeyHash, {
        pubKey,
        pubKeyHash,
        vote,
        nonce,
      });
      this.messageCount++;
      return { applied: true };
    }

    if (nonce < existing.nonce) {
      // Old message with lower nonce - ignore
      return { applied: false, reason: 'stale_nonce' };
    }

    if (nonce === existing.nonce && existing.vote !== null) {
      // Same nonce but already voted - ignore duplicate
      return { applied: false, reason: 'duplicate' };
    }

    // Update with new vote (same or higher nonce)
    this.voters.set(pubKeyHash, {
      pubKey,
      pubKeyHash,
      vote,
      nonce,
    });
    this.messageCount++;
    return { applied: true };
  }

  /**
   * Handle key change: register new key and invalidate old key's votes
   * The new key inherits the voting right
   */
  handleKeyChange(
    oldPubKey: G1Point,
    newPubKey: G1Point,
    vote: Vote,
    oldNonce: number
  ): { applied: boolean; reason?: string } {
    const oldPubKeyHash = getPublicKeyHash(oldPubKey);
    const newPubKeyHash = getPublicKeyHash(newPubKey);

    const oldState = this.voters.get(oldPubKeyHash);

    if (!oldState) {
      // Old key not found - treat as new voter with new key
      return this.updateVote(newPubKey, vote, oldNonce + 1);
    }

    if (oldNonce < oldState.nonce) {
      // Stale key change message
      return { applied: false, reason: 'stale_nonce' };
    }

    // Mark old key's vote as invalidated by setting high nonce
    // but keeping the vote null (effectively revoked)
    this.voters.set(oldPubKeyHash, {
      ...oldState,
      vote: null,
      nonce: oldNonce,
    });

    // Register new key with incremented nonce
    this.voters.set(newPubKeyHash, {
      pubKey: newPubKey,
      pubKeyHash: newPubKeyHash,
      vote,
      nonce: oldNonce + 1,
    });

    this.messageCount++;
    return { applied: true };
  }

  /**
   * Get current state root (async)
   */
  async getStateRoot(): Promise<bigint> {
    return computeMerkleRoot(this.voters);
  }

  /**
   * Get current state root as hex string (async)
   */
  async getStateRootHex(): Promise<string> {
    const root = await this.getStateRoot();
    return bigintToHex(root);
  }

  /**
   * Get tally of votes
   */
  tally(): { yes: number; no: number; abstain: number } {
    let yes = 0;
    let no = 0;
    let abstain = 0;

    for (const [_, state] of this.voters) {
      if (state.vote === 1) {
        yes++;
      } else if (state.vote === 0) {
        no++;
      } else {
        abstain++;
      }
    }

    return { yes, no, abstain };
  }

  /**
   * Get all voters
   */
  getVoters(): Map<string, VoterState> {
    return new Map(this.voters);
  }

  /**
   * Get voter by public key hash
   */
  getVoter(pubKeyHash: string): VoterState | undefined {
    return this.voters.get(pubKeyHash);
  }

  /**
   * Get voter by public key
   */
  getVoterByPubKey(pubKey: G1Point): VoterState | undefined {
    const pubKeyHash = getPublicKeyHash(pubKey);
    return this.voters.get(pubKeyHash);
  }

  /**
   * Get message count
   */
  getMessageCount(): number {
    return this.messageCount;
  }

  /**
   * Get full coordinator state (async)
   */
  async getState(): Promise<CoordinatorState> {
    return {
      voters: new Map(this.voters),
      messageCount: this.messageCount,
      stateRoot: await this.getStateRoot(),
    };
  }

  /**
   * Generate Merkle proof for a voter
   */
  async generateMerkleProof(pubKeyHash: string): Promise<MerkleProof | null> {
    return generateMerkleProof(this.voters, pubKeyHash);
  }

  /**
   * Generate Merkle proof by public key
   */
  async generateMerkleProofByPubKey(pubKey: G1Point): Promise<MerkleProof | null> {
    const pubKeyHash = getPublicKeyHash(pubKey);
    return this.generateMerkleProof(pubKeyHash);
  }

  /**
   * Export state for serialization
   */
  async exportState(): Promise<{
    voters: Array<{
      pubKeyHash: string;
      pubKey: string;
      vote: number;
      nonce: number;
    }>;
    messageCount: number;
    stateRoot: string;
  }> {
    const voterArray = Array.from(this.voters.entries()).map(
      ([hash, state]) => ({
        pubKeyHash: hash,
        pubKey: Buffer.from(serializePoint(state.pubKey)).toString('hex'),
        vote: state.vote === null ? -1 : state.vote,
        nonce: state.nonce,
      })
    );

    return {
      voters: voterArray,
      messageCount: this.messageCount,
      stateRoot: bigintToHex(await this.getStateRoot()),
    };
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.voters.clear();
    this.messageCount = 0;
  }

  /**
   * Compute Merkle root commitment for intermediate states
   * Used for bisection fraud proof verification
   */
  async computeIntermediateCommitment(
    intermediateStates: IntermediateStateData[]
  ): Promise<bigint> {
    await initPoseidon();

    if (intermediateStates.length === 0) {
      return 0n;
    }

    // Hash each intermediate state: Poseidon(messageIndex, prevStateRoot, stateRoot)
    const leaves: bigint[] = [];
    for (const state of intermediateStates) {
      const hash = poseidonHash4Sync(
        BigInt(state.messageIndex),
        state.prevStateRoot,
        state.stateRoot,
        0n // padding
      );
      leaves.push(hash);
    }

    return buildCompactMerkleRoot(leaves);
  }

  /**
   * Generate Merkle proof for an intermediate state at a given index
   * Returns proof path for on-chain verification
   */
  async generateIntermediateProof(
    intermediateStates: IntermediateStateData[],
    index: number
  ): Promise<{ siblings: bigint[]; pathIndices: number[] }> {
    await initPoseidon();

    if (index >= intermediateStates.length) {
      throw new Error('Index out of bounds');
    }

    // Hash all leaves
    const leaves: bigint[] = [];
    for (const state of intermediateStates) {
      const hash = poseidonHash4Sync(
        BigInt(state.messageIndex),
        state.prevStateRoot,
        state.stateRoot,
        0n
      );
      leaves.push(hash);
    }

    // Pad to power of 2 for balanced tree
    const targetSize = Math.pow(2, Math.ceil(Math.log2(Math.max(leaves.length, 2))));
    const paddedLeaves = [...leaves];
    while (paddedLeaves.length < targetSize) {
      paddedLeaves.push(paddedLeaves[paddedLeaves.length - 1]);
    }

    // Build proof
    const siblings: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = index;
    let currentLevel = paddedLeaves;

    while (currentLevel.length > 1) {
      const siblingIndex =
        currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      siblings.push(currentLevel[siblingIndex] || currentLevel[currentIndex]);
      pathIndices.push(currentIndex % 2); // 0 = left, 1 = right

      // Compute next level
      const nextLevel: bigint[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1] || left;
        nextLevel.push(poseidonHash2Sync(left, right));
      }

      currentIndex = Math.floor(currentIndex / 2);
      currentLevel = nextLevel;
    }

    return { siblings, pathIndices };
  }
}
