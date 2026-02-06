/**
 * Coordinator Message Processor
 *
 * Processes encrypted vote messages from voters.
 * Decrypts messages using coordinator's private key and updates state.
 *
 * Key features:
 * - Decrypts messages without generating ZKP (fraud proof model)
 * - Tracks key changes and only counts latest valid votes
 * - Computes state root for on-chain submission (using Poseidon hash)
 * - Supports ZKP proof generation for challenge response
 */

import { G1Point, Scalar } from '../crypto/elgamal';
import {
  EncryptedMessage,
  DecryptedMessage,
  decryptMessage,
  SerializedMessage,
  deserializeMessage,
  Vote,
  CoordinatorKeyPair,
  generateCoordinatorKeyPair,
  getPublicKeyHash,
} from '../crypto/maci';
import {
  StateManager,
  CoordinatorState,
  VoterState,
  IntermediateStateData,
  MerkleProof,
} from './state';
import { initPoseidon, bigintToHex } from '../crypto/poseidon';
import {
  CircuitInput,
  WitnessInputData,
  generateWitnessInput,
} from '../zkp/witness';
import {
  Prover,
  ProverConfig,
  ProofWithSignals,
  SolidityCalldata,
} from '../zkp/prover';

/**
 * Processed message result
 */
export interface ProcessedMessage {
  voterPubKeyHash: string;
  vote: Vote;
  nonce: number;
  applied: boolean;
  reason?: string;
}

/**
 * Batch processing result
 */
export interface BatchResult {
  processed: number;
  applied: number;
  rejected: number;
  stateRoot: bigint;
  stateRootHex: string;
  messages: ProcessedMessage[];
}

/**
 * Intermediate state after processing each message
 * Used for bisection fraud proof game
 */
export interface IntermediateState {
  messageIndex: number;
  stateRoot: bigint;
  prevStateRoot: bigint;
  // Additional data for witness generation
  encryptedMessage?: EncryptedMessage;
  decryptedMessage?: DecryptedMessage;
  prevVoterState?: VoterState | null;
  newVoterState?: VoterState;
}

/**
 * Message Processor
 *
 * Handles the decryption and processing of encrypted vote messages.
 */
export class MessageProcessor {
  private coordinatorKey: CoordinatorKeyPair;
  private stateManager: StateManager;
  private processedMessages: ProcessedMessage[];
  private intermediateStates: IntermediateState[];
  private initialized: boolean;

  constructor(coordinatorKey?: CoordinatorKeyPair) {
    this.coordinatorKey = coordinatorKey || generateCoordinatorKeyPair();
    this.stateManager = new StateManager();
    this.processedMessages = [];
    this.intermediateStates = [];
    this.initialized = false;
  }

  /**
   * Initialize the processor (must call before processing)
   */
  async init(): Promise<void> {
    await initPoseidon();
    await this.stateManager.init();
    this.initialized = true;
  }

  /**
   * Ensure processor is initialized
   */
  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Get coordinator's public key (for voters to encrypt messages)
   */
  getCoordinatorPublicKey(): G1Point {
    return this.coordinatorKey.publicKey;
  }

  /**
   * Get coordinator's key pair (for ZKP witness generation)
   */
  getCoordinatorKeyPair(): CoordinatorKeyPair {
    return this.coordinatorKey;
  }

  /**
   * Process a single encrypted message
   * Tracks intermediate state for bisection fraud proof
   */
  async processMessage(encrypted: EncryptedMessage): Promise<ProcessedMessage> {
    await this.ensureInit();

    // Capture previous state root for intermediate state tracking
    const prevStateRoot = await this.stateManager.getStateRoot();
    const messageIndex = this.intermediateStates.length;

    // Get previous voter state (for witness generation)
    const prevVoterState = this.stateManager.getVoterByPubKey(
      encrypted.voterPubKey
    );

    // Decrypt the message
    let decrypted: DecryptedMessage;
    try {
      decrypted = decryptMessage(encrypted, this.coordinatorKey.privateKey);
    } catch (error) {
      const result: ProcessedMessage = {
        voterPubKeyHash: getPublicKeyHash(encrypted.voterPubKey),
        vote: 0,
        nonce: 0,
        applied: false,
        reason: `decryption_failed: ${error}`,
      };
      this.processedMessages.push(result);

      // Record intermediate state (state unchanged on error)
      this.intermediateStates.push({
        messageIndex,
        stateRoot: prevStateRoot,
        prevStateRoot,
        encryptedMessage: encrypted,
        prevVoterState: prevVoterState || null,
      });

      return result;
    }

    // Check if this is a key change message
    if (decrypted.newPubKey) {
      const updateResult = this.stateManager.handleKeyChange(
        decrypted.voterPubKey,
        decrypted.newPubKey,
        decrypted.vote,
        decrypted.nonce
      );

      const result: ProcessedMessage = {
        voterPubKeyHash: getPublicKeyHash(decrypted.newPubKey),
        vote: decrypted.vote,
        nonce: decrypted.nonce + 1,
        applied: updateResult.applied,
        reason: updateResult.reason,
      };
      this.processedMessages.push(result);

      // Record intermediate state
      const newStateRoot = await this.stateManager.getStateRoot();
      const newVoterState = this.stateManager.getVoterByPubKey(
        decrypted.newPubKey
      );

      this.intermediateStates.push({
        messageIndex,
        stateRoot: newStateRoot,
        prevStateRoot,
        encryptedMessage: encrypted,
        decryptedMessage: decrypted,
        prevVoterState: prevVoterState || null,
        newVoterState,
      });

      return result;
    }

    // Regular vote message
    const updateResult = this.stateManager.updateVote(
      decrypted.voterPubKey,
      decrypted.vote,
      decrypted.nonce
    );

    const result: ProcessedMessage = {
      voterPubKeyHash: getPublicKeyHash(decrypted.voterPubKey),
      vote: decrypted.vote,
      nonce: decrypted.nonce,
      applied: updateResult.applied,
      reason: updateResult.reason,
    };
    this.processedMessages.push(result);

    // Record intermediate state
    const newStateRoot = await this.stateManager.getStateRoot();
    const newVoterState = this.stateManager.getVoterByPubKey(
      decrypted.voterPubKey
    );

    this.intermediateStates.push({
      messageIndex,
      stateRoot: newStateRoot,
      prevStateRoot,
      encryptedMessage: encrypted,
      decryptedMessage: decrypted,
      prevVoterState: prevVoterState || null,
      newVoterState,
    });

    return result;
  }

  /**
   * Process a batch of encrypted messages
   */
  async processBatch(messages: EncryptedMessage[]): Promise<BatchResult> {
    await this.ensureInit();

    const results: ProcessedMessage[] = [];
    let applied = 0;
    let rejected = 0;

    for (const msg of messages) {
      const result = await this.processMessage(msg);
      results.push(result);
      if (result.applied) {
        applied++;
      } else {
        rejected++;
      }
    }

    const stateRoot = await this.stateManager.getStateRoot();

    return {
      processed: messages.length,
      applied,
      rejected,
      stateRoot,
      stateRootHex: bigintToHex(stateRoot),
      messages: results,
    };
  }

  /**
   * Process serialized messages (from on-chain)
   */
  async processSerializedBatch(
    serializedMessages: SerializedMessage[]
  ): Promise<BatchResult> {
    const messages = serializedMessages.map(deserializeMessage);
    return this.processBatch(messages);
  }

  /**
   * Get current state root
   */
  async getStateRoot(): Promise<bigint> {
    await this.ensureInit();
    return this.stateManager.getStateRoot();
  }

  /**
   * Get current state root as hex string
   */
  async getStateRootHex(): Promise<string> {
    const root = await this.getStateRoot();
    return bigintToHex(root);
  }

  /**
   * Get vote tally
   */
  tally(): { yes: number; no: number; abstain: number } {
    return this.stateManager.tally();
  }

  /**
   * Get full coordinator state
   */
  async getState(): Promise<CoordinatorState> {
    await this.ensureInit();
    return this.stateManager.getState();
  }

  /**
   * Get all processed messages
   */
  getProcessedMessages(): ProcessedMessage[] {
    return [...this.processedMessages];
  }

  /**
   * Get intermediate state at a specific message index
   * Used for bisection fraud proof
   */
  getIntermediateState(index: number): IntermediateState | undefined {
    return this.intermediateStates[index];
  }

  /**
   * Get all intermediate states
   */
  getIntermediateStates(): IntermediateState[] {
    return [...this.intermediateStates];
  }

  /**
   * Get intermediate states in format for commitment computation
   */
  getIntermediateStatesData(): IntermediateStateData[] {
    return this.intermediateStates.map((s) => ({
      messageIndex: s.messageIndex,
      stateRoot: s.stateRoot,
      prevStateRoot: s.prevStateRoot,
    }));
  }

  /**
   * Get commitment to all intermediate states (Merkle root)
   * This is submitted on-chain for bisection verification
   */
  async getIntermediateStatesCommitment(): Promise<bigint> {
    await this.ensureInit();
    const data = this.getIntermediateStatesData();
    return this.stateManager.computeIntermediateCommitment(data);
  }

  /**
   * Get intermediate states commitment as hex string
   */
  async getIntermediateStatesCommitmentHex(): Promise<string> {
    const commitment = await this.getIntermediateStatesCommitment();
    return bigintToHex(commitment);
  }

  /**
   * Generate Merkle proof for an intermediate state
   */
  async generateIntermediateProof(
    index: number
  ): Promise<{ siblings: bigint[]; pathIndices: number[] }> {
    await this.ensureInit();
    const data = this.getIntermediateStatesData();
    return this.stateManager.generateIntermediateProof(data, index);
  }

  /**
   * Generate Merkle proof for a voter
   */
  async generateVoterMerkleProof(
    pubKeyHash: string
  ): Promise<MerkleProof | null> {
    await this.ensureInit();
    return this.stateManager.generateMerkleProof(pubKeyHash);
  }

  /**
   * Generate Merkle proof for a voter by public key
   */
  async generateVoterMerkleProofByPubKey(
    pubKey: G1Point
  ): Promise<MerkleProof | null> {
    await this.ensureInit();
    return this.stateManager.generateMerkleProofByPubKey(pubKey);
  }

  /**
   * Get the number of processed messages
   */
  getProcessedMessageCount(): number {
    return this.intermediateStates.length;
  }

  /**
   * Get voter state by public key hash
   */
  getVoter(pubKeyHash: string): VoterState | undefined {
    return this.stateManager.getVoter(pubKeyHash);
  }

  /**
   * Get voter state by public key
   */
  getVoterByPubKey(pubKey: G1Point): VoterState | undefined {
    return this.stateManager.getVoterByPubKey(pubKey);
  }

  /**
   * Export state for on-chain submission or persistence
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
    intermediateCommitment: string;
    tally: { yes: number; no: number; abstain: number };
  }> {
    await this.ensureInit();
    const state = await this.stateManager.exportState();
    const intermediateCommitment = await this.getIntermediateStatesCommitmentHex();

    return {
      ...state,
      intermediateCommitment,
      tally: this.tally(),
    };
  }

  /**
   * Clear all state and start fresh
   */
  reset(): void {
    this.stateManager.clear();
    this.processedMessages = [];
    this.intermediateStates = [];
  }

  // ============ ZKP Proof Generation ============

  /**
   * Generate witness input for a single message at given index
   * Used for bisection fraud proof response
   */
  async generateWitnessInput(messageIndex: number): Promise<CircuitInput> {
    await this.ensureInit();

    const state = this.intermediateStates[messageIndex];
    if (!state) {
      throw new Error(`No intermediate state at index ${messageIndex}`);
    }

    if (!state.encryptedMessage || !state.decryptedMessage) {
      throw new Error(`Message at index ${messageIndex} was not successfully processed`);
    }

    // Get Merkle proof for the voter
    const pubKeyHash = state.newVoterState?.pubKeyHash;
    if (!pubKeyHash) {
      throw new Error(`No voter state for message at index ${messageIndex}`);
    }

    const merkleProof = await this.stateManager.generateMerkleProof(pubKeyHash);
    if (!merkleProof) {
      throw new Error(`Could not generate Merkle proof for voter ${pubKeyHash}`);
    }

    const witnessData: WitnessInputData = {
      encryptedMessage: state.encryptedMessage,
      decryptedMessage: state.decryptedMessage,
      prevState: state.prevVoterState || null,
      merkleProof,
      coordinatorKey: this.coordinatorKey,
      messageIndex,
      prevStateRoot: state.prevStateRoot,
      newStateRoot: state.stateRoot,
    };

    return generateWitnessInput(witnessData);
  }

  /**
   * Generate ZKP proof for a single message
   * Used for bisection fraud proof response
   */
  async generateSingleMessageProof(
    messageIndex: number,
    proverConfig?: ProverConfig
  ): Promise<ProofWithSignals> {
    const input = await this.generateWitnessInput(messageIndex);
    const prover = new Prover(proverConfig);
    return prover.generateProof(input);
  }

  /**
   * Generate Solidity calldata for a single message proof
   */
  async generateSingleMessageCalldata(
    messageIndex: number,
    proverConfig?: ProverConfig
  ): Promise<SolidityCalldata> {
    const proofWithSignals = await this.generateSingleMessageProof(
      messageIndex,
      proverConfig
    );
    const prover = new Prover(proverConfig);
    return prover.generateSolidityCalldata(proofWithSignals);
  }

  /**
   * Verify a proof off-chain
   */
  async verifyProof(
    proofWithSignals: ProofWithSignals,
    proverConfig?: ProverConfig
  ): Promise<boolean> {
    const prover = new Prover(proverConfig);
    return prover.verifyProof(proofWithSignals);
  }
}

/**
 * Create a new message processor with a fresh coordinator key
 */
export async function createProcessor(): Promise<MessageProcessor> {
  const processor = new MessageProcessor();
  await processor.init();
  return processor;
}

/**
 * Create a message processor with an existing coordinator key
 */
export async function createProcessorWithKey(
  coordinatorKey: CoordinatorKeyPair
): Promise<MessageProcessor> {
  const processor = new MessageProcessor(coordinatorKey);
  await processor.init();
  return processor;
}
