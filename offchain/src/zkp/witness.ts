/**
 * Witness Generator for SingleMessageProcessor Circuit
 *
 * Generates witness inputs for proving correct message processing.
 * Must match the circuit's expected input format exactly.
 */

import { G1Point } from '../crypto/elgamal';
import {
  EncryptedMessage,
  DecryptedMessage,
  CoordinatorKeyPair,
} from '../crypto/maci';
import { VoterState, MerkleProof, TREE_DEPTH } from '../coordinator/state';
import { toFieldElement, bigintToHex, poseidonHash, poseidonHash2, SNARK_SCALAR_FIELD, initPoseidon } from '../crypto/poseidon';

/**
 * Circuit input structure
 * Must match SingleMessageProcessor.circom public/private inputs
 */
export interface CircuitInput {
  // Public inputs (10 total)
  prevStateRoot: string;
  newStateRoot: string;
  encryptedVoterPubKeyX: string;
  encryptedVoterPubKeyY: string;
  encryptedData: string[]; // [4] elements
  ephemeralPubKeyX: string;
  ephemeralPubKeyY: string;
  messageIndex: string;
  coordinatorPubKeyX: string;
  coordinatorPubKeyY: string;

  // Private inputs
  coordinatorPrivKey: string;
  decryptedVote: string;
  decryptedNonce: string;
  voterPubKeyX: string;
  voterPubKeyY: string;
  previousVoterNonce: string;
  previousVoterVote: string;
  pathIndices: number[];
  siblings: string[];
}

/**
 * Data needed to generate a witness for a single message
 */
export interface WitnessInputData {
  encryptedMessage: EncryptedMessage;
  decryptedMessage: DecryptedMessage;
  prevState: VoterState | null;
  merkleProof: MerkleProof;
  coordinatorKey: CoordinatorKeyPair;
  messageIndex: number;
  prevStateRoot: bigint;
  newStateRoot: bigint;
}

/**
 * Extract point coordinates as field elements
 */
function getPointCoords(point: G1Point): { x: bigint; y: bigint } {
  const affine = point.toAffine();
  return {
    x: toFieldElement(affine.x),
    y: toFieldElement(affine.y),
  };
}

/**
 * Convert bigint to circuit string (decimal)
 */
function toCircuitString(value: bigint): string {
  return value.toString();
}

/**
 * Pad array to specified length with zeros
 */
function padArray(arr: bigint[], length: number): bigint[] {
  const result = [...arr];
  while (result.length < length) {
    result.push(0n);
  }
  return result.slice(0, length);
}

/**
 * Compute the shared secret as the circuit does (simplified ECDH via Poseidon)
 */
async function computeCircuitSharedSecret(
  privateKey: bigint,
  ephemeralPubKeyX: bigint,
  ephemeralPubKeyY: bigint
): Promise<bigint> {
  await initPoseidon();
  return poseidonHash([privateKey, ephemeralPubKeyX, ephemeralPubKeyY]);
}

/**
 * Compute the encrypted data that the circuit will decrypt correctly
 * Circuit decryption: plaintext[i] = ciphertext[i] - hash(sharedSecret, i)
 * So ciphertext[i] = plaintext[i] + hash(sharedSecret, i)
 */
async function computeCircuitEncryptedData(
  sharedSecret: bigint,
  plaintext: bigint[]
): Promise<bigint[]> {
  await initPoseidon();
  const ciphertext: bigint[] = [];
  for (let i = 0; i < plaintext.length; i++) {
    const keyStream = await poseidonHash2(sharedSecret, BigInt(i));
    // ciphertext = plaintext + keyStream (mod field)
    const ct = (plaintext[i] + keyStream) % SNARK_SCALAR_FIELD;
    ciphertext.push(ct);
  }
  return ciphertext;
}

/**
 * Generate witness input for SingleMessageProcessor circuit
 */
export async function generateWitnessInput(data: WitnessInputData): Promise<CircuitInput> {
  const {
    encryptedMessage,
    decryptedMessage,
    prevState,
    merkleProof,
    coordinatorKey,
    messageIndex,
    prevStateRoot,
    newStateRoot,
  } = data;

  // Get coordinator public key coordinates
  const coordPubKey = getPointCoords(coordinatorKey.publicKey);

  // Get voter public key coordinates (from decrypted message)
  const voterPubKey = getPointCoords(decryptedMessage.voterPubKey);

  // Get ephemeral public key coordinates
  const ephemeralPubKey = getPointCoords(encryptedMessage.ephemeralPubKey);

  // Get encrypted voter public key coordinates
  const encVoterPubKey = getPointCoords(encryptedMessage.voterPubKey);

  // Previous voter state (or defaults for new voter with zero-state)
  const prevVote = prevState?.vote ?? 0;
  const prevNonce = prevState?.nonce ?? 0;

  // Pad merkle proof to tree depth
  const paddedSiblings = padArray(merkleProof.siblings, TREE_DEPTH);
  const paddedPathIndices = [...merkleProof.pathIndices];
  while (paddedPathIndices.length < TREE_DEPTH) {
    paddedPathIndices.push(0);
  }

  // Compute shared secret as the circuit does
  const coordPrivKeyField = toFieldElement(coordinatorKey.privateKey);
  const sharedSecret = await computeCircuitSharedSecret(
    coordPrivKeyField,
    ephemeralPubKey.x,
    ephemeralPubKey.y
  );

  // Build encrypted data array (4 elements matching circuit)
  // Compute ciphertext that circuit will decrypt correctly:
  // Circuit: plaintext[i] = ciphertext[i] - hash(sharedSecret, i)
  // So: ciphertext[i] = plaintext[i] + hash(sharedSecret, i)
  const plaintext: bigint[] = [
    BigInt(decryptedMessage.vote),
    BigInt(decryptedMessage.nonce),
    0n, // new key X (0 if no key change)
    0n, // new key Y (0 if no key change)
  ];
  const ciphertext = await computeCircuitEncryptedData(sharedSecret, plaintext);
  const encryptedData: string[] = ciphertext.map(toCircuitString);

  return {
    // Public inputs
    prevStateRoot: toCircuitString(prevStateRoot),
    newStateRoot: toCircuitString(newStateRoot),
    encryptedVoterPubKeyX: toCircuitString(encVoterPubKey.x),
    encryptedVoterPubKeyY: toCircuitString(encVoterPubKey.y),
    encryptedData,
    ephemeralPubKeyX: toCircuitString(ephemeralPubKey.x),
    ephemeralPubKeyY: toCircuitString(ephemeralPubKey.y),
    messageIndex: toCircuitString(BigInt(messageIndex)),
    coordinatorPubKeyX: toCircuitString(coordPubKey.x),
    coordinatorPubKeyY: toCircuitString(coordPubKey.y),

    // Private inputs
    coordinatorPrivKey: toCircuitString(toFieldElement(coordinatorKey.privateKey)),
    decryptedVote: toCircuitString(BigInt(decryptedMessage.vote)),
    decryptedNonce: toCircuitString(BigInt(decryptedMessage.nonce)),
    voterPubKeyX: toCircuitString(voterPubKey.x),
    voterPubKeyY: toCircuitString(voterPubKey.y),
    previousVoterNonce: toCircuitString(BigInt(prevNonce)),
    previousVoterVote: toCircuitString(BigInt(prevVote)),
    pathIndices: paddedPathIndices.slice(0, TREE_DEPTH),
    siblings: paddedSiblings.map(toCircuitString),
  };
}

/**
 * Validate witness input before circuit execution
 */
export function validateWitnessInput(input: CircuitInput): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check all required fields exist
  const requiredFields = [
    'prevStateRoot',
    'newStateRoot',
    'encryptedVoterPubKeyX',
    'encryptedVoterPubKeyY',
    'encryptedData',
    'ephemeralPubKeyX',
    'ephemeralPubKeyY',
    'messageIndex',
    'coordinatorPubKeyX',
    'coordinatorPubKeyY',
    'coordinatorPrivKey',
    'decryptedVote',
    'decryptedNonce',
    'voterPubKeyX',
    'voterPubKeyY',
    'previousVoterNonce',
    'previousVoterVote',
    'pathIndices',
    'siblings',
  ];

  for (const field of requiredFields) {
    if (!(field in input)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check encrypted data length
  if (input.encryptedData?.length !== 4) {
    errors.push(`encryptedData must have 4 elements, got ${input.encryptedData?.length}`);
  }

  // Check path indices length
  if (input.pathIndices?.length !== TREE_DEPTH) {
    errors.push(`pathIndices must have ${TREE_DEPTH} elements, got ${input.pathIndices?.length}`);
  }

  // Check siblings length
  if (input.siblings?.length !== TREE_DEPTH) {
    errors.push(`siblings must have ${TREE_DEPTH} elements, got ${input.siblings?.length}`);
  }

  // Validate vote value (0, 1, or 2)
  const vote = parseInt(input.decryptedVote);
  if (![0, 1, 2].includes(vote)) {
    errors.push(`Invalid vote value: ${vote}. Must be 0, 1, or 2`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Convert circuit input to JSON for snarkjs
 */
export function circuitInputToJson(input: CircuitInput): string {
  return JSON.stringify(input, null, 2);
}

/**
 * Format public signals from circuit input
 * Order must match circuit's public input declaration
 */
export function extractPublicSignals(input: CircuitInput): string[] {
  return [
    input.prevStateRoot,
    input.newStateRoot,
    input.encryptedVoterPubKeyX,
    input.encryptedVoterPubKeyY,
    ...input.encryptedData,
    input.ephemeralPubKeyX,
    input.ephemeralPubKeyY,
    input.messageIndex,
    input.coordinatorPubKeyX,
    input.coordinatorPubKeyY,
  ];
}
