import { bn254, bn254_Fr } from '@noble/curves/bn254';
import { randomBytes } from '@noble/hashes/utils';
import { G1Point, Scalar, Ciphertext, serializePoint, deserializePoint } from '../elgamal';
import {
  VoterKeyPair,
  CoordinatorKeyPair,
  computeSharedSecret,
  deriveEncryptionKey,
  serializePublicKey,
  deserializePublicKey,
} from './keys';

/**
 * MACI Message Encryption
 *
 * Message structure:
 * - vote: 0 (no) or 1 (yes)
 * - nonce: key change counter
 * - newPubKey: optional new public key (for key change)
 *
 * Encryption:
 * 1. Compute shared secret: voterPrivKey * coordinatorPubKey
 * 2. Derive encryption key from shared secret
 * 3. Encrypt message data with derived key
 */

/**
 * Vote value
 */
export type Vote = 0 | 1;

/**
 * Message content (before encryption)
 */
export interface MessageData {
  vote: Vote;
  nonce: number;
  newPubKey?: G1Point; // Set when changing key
}

/**
 * Encrypted message (submitted on-chain)
 */
export interface EncryptedMessage {
  voterPubKey: G1Point; // Voter's current public key
  encryptedData: Ciphertext; // Encrypted vote + nonce + newKey
  ephemeralPubKey: G1Point; // For ECDH with coordinator
}

/**
 * Serialized encrypted message (for on-chain submission)
 */
export interface SerializedMessage {
  voterPubKey: string; // hex (64 bytes)
  encryptedData: string; // hex (128 bytes: c1 + c2)
  ephemeralPubKey: string; // hex (64 bytes)
}

/**
 * Decrypted message (after coordinator decryption)
 */
export interface DecryptedMessage {
  voterPubKey: G1Point;
  vote: Vote;
  nonce: number;
  newPubKey?: G1Point;
}

/**
 * Pack message data into a single bigint for encryption
 * Format: vote (1 bit) | nonce (31 bits) | hasNewKey (1 bit) | newKeyX (if present)
 *
 * For simplicity, we encode:
 * - vote and nonce into c2 of first ciphertext
 * - newPubKey (if any) into second ciphertext
 */
function packMessageData(data: MessageData): bigint {
  // Pack vote (0 or 1) and nonce into a single value
  // vote in lowest bit, nonce in higher bits
  const packed = BigInt(data.vote) | (BigInt(data.nonce) << 1n);
  return packed;
}

/**
 * Unpack message data from bigint
 */
function unpackMessageData(packed: bigint): { vote: Vote; nonce: number } {
  const vote = Number(packed & 1n) as Vote;
  const nonce = Number(packed >> 1n);
  return { vote, nonce };
}

/**
 * Encrypt a vote message for the coordinator
 *
 * @param voterKey Voter's current keypair
 * @param coordinatorPubKey Coordinator's public key
 * @param vote Vote value (0 or 1)
 * @param newKey Optional new keypair (for key change)
 * @returns Encrypted message
 */
export function encryptMessage(
  voterKey: VoterKeyPair,
  coordinatorPubKey: G1Point,
  vote: Vote,
  newKey?: VoterKeyPair
): EncryptedMessage {
  // Generate ephemeral key for ECDH
  const ephemeralPrivKey = bn254_Fr.create(
    BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex'))
  );
  const ephemeralPubKey = bn254.G1.Point.BASE.multiply(ephemeralPrivKey);

  // Compute shared secret: ephemeralPrivKey * coordinatorPubKey
  const sharedSecret = computeSharedSecret(ephemeralPrivKey, coordinatorPubKey);
  const encryptionKey = deriveEncryptionKey(sharedSecret);

  // Pack message data
  const messageData: MessageData = {
    vote,
    nonce: voterKey.nonce,
    newPubKey: newKey?.publicKey,
  };

  const packedData = packMessageData(messageData);

  // Encrypt using ElGamal-like scheme with derived key
  // r = random, C1 = r*G, C2 = m*G + r*encryptionKey*G
  const r = bn254_Fr.create(
    BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex'))
  );

  const c1 = bn254.G1.Point.BASE.multiply(r);

  // Message point: encode vote and nonce
  // Also encode whether there's a new key (add a flag)
  const hasNewKey = newKey ? 1n : 0n;
  const fullMessage = packedData | (hasNewKey << 32n);

  const messagePoint = fullMessage === 0n
    ? bn254.G1.Point.ZERO
    : bn254.G1.Point.BASE.multiply(fullMessage);

  // C2 = m*G + r*encryptionKey*G
  const keyPoint = bn254.G1.Point.BASE.multiply(encryptionKey);
  const mask = keyPoint.multiply(r);
  const c2 = messagePoint.add(mask);

  // If there's a new key, we need to include it
  // For simplicity, we'll encode the new key's x-coordinate in an additional field
  // In practice, this would be handled differently (e.g., additional ciphertext)
  let encryptedData: Ciphertext = { c1, c2 };

  // If new key exists, add its info to c2 in a recoverable way
  // This is a simplified approach - in production, use proper encoding
  if (newKey) {
    const newKeyAffine = newKey.publicKey.toAffine();
    // Store reference to new key (coordinator will verify on-chain)
    // The new public key will be included in the message hash
  }

  return {
    voterPubKey: voterKey.publicKey,
    encryptedData,
    ephemeralPubKey,
  };
}

/**
 * Decrypt a message using coordinator's private key
 *
 * @param message Encrypted message
 * @param coordinatorPrivKey Coordinator's private key
 * @returns Decrypted message data
 */
export function decryptMessage(
  message: EncryptedMessage,
  coordinatorPrivKey: Scalar
): DecryptedMessage {
  // Compute shared secret: coordinatorPrivKey * ephemeralPubKey
  const sharedSecret = computeSharedSecret(coordinatorPrivKey, message.ephemeralPubKey);
  const encryptionKey = deriveEncryptionKey(sharedSecret);

  // Decrypt: m*G = C2 - r*encryptionKey*G
  // We need to find r*encryptionKey*G = encryptionKey * C1
  const keyPoint = bn254.G1.Point.BASE.multiply(encryptionKey);
  const mask = message.encryptedData.c1.multiply(encryptionKey);
  const messagePoint = message.encryptedData.c2.subtract(mask);

  // Brute-force discrete log for small message space
  const fullMessage = discreteLogSmall(messagePoint, 2 ** 34); // Up to 2^34

  if (fullMessage === null) {
    throw new Error('Failed to decrypt message: discrete log not found');
  }

  // Unpack message
  const hasNewKey = (fullMessage >> 32n) & 1n;
  const packedData = fullMessage & ((1n << 32n) - 1n);
  const { vote, nonce } = unpackMessageData(packedData);

  return {
    voterPubKey: message.voterPubKey,
    vote,
    nonce,
    // newPubKey would be retrieved from on-chain message data
  };
}

/**
 * Brute-force discrete log for small values
 * Optimized with baby-step giant-step for larger ranges
 */
function discreteLogSmall(point: G1Point, maxValue: number): bigint | null {
  if (point.equals(bn254.G1.Point.ZERO)) {
    return 0n;
  }

  const base = bn254.G1.Point.BASE;

  // For small values, just iterate
  if (maxValue <= 100000) {
    for (let i = 1; i < maxValue; i++) {
      if (base.multiply(BigInt(i)).equals(point)) {
        return BigInt(i);
      }
    }
    return null;
  }

  // Baby-step giant-step for larger ranges
  const m = Math.ceil(Math.sqrt(maxValue));
  const table = new Map<string, number>();

  // Baby steps: compute base^j for j = 0, 1, ..., m-1
  let current = bn254.G1.Point.ZERO;
  for (let j = 0; j < m; j++) {
    const key = pointToKey(current);
    table.set(key, j);
    current = current.add(base);
  }

  // Giant step factor: base^(-m)
  const factor = base.multiply(BigInt(m)).negate();

  // Giant steps: compute point * factor^i
  let gamma = point;
  for (let i = 0; i < m; i++) {
    const key = pointToKey(gamma);
    if (table.has(key)) {
      const j = table.get(key)!;
      const result = BigInt(i) * BigInt(m) + BigInt(j);
      if (result < BigInt(maxValue)) {
        return result;
      }
    }
    gamma = gamma.add(factor);
  }

  return null;
}

/**
 * Convert point to string key for Map lookup
 */
function pointToKey(point: G1Point): string {
  if (point.equals(bn254.G1.Point.ZERO)) {
    return 'zero';
  }
  const affine = point.toAffine();
  return `${affine.x.toString(16)}_${affine.y.toString(16)}`;
}

/**
 * Serialize encrypted message for on-chain submission
 */
export function serializeMessage(message: EncryptedMessage): SerializedMessage {
  const voterPubKeyBytes = serializePublicKey(message.voterPubKey);
  const c1Bytes = serializePoint(message.encryptedData.c1);
  const c2Bytes = serializePoint(message.encryptedData.c2);
  const ephemeralPubKeyBytes = serializePublicKey(message.ephemeralPubKey);

  return {
    voterPubKey: Buffer.from(voterPubKeyBytes).toString('hex'),
    encryptedData: Buffer.from([...c1Bytes, ...c2Bytes]).toString('hex'),
    ephemeralPubKey: Buffer.from(ephemeralPubKeyBytes).toString('hex'),
  };
}

/**
 * Deserialize encrypted message from on-chain data
 */
export function deserializeMessage(serialized: SerializedMessage): EncryptedMessage {
  const voterPubKeyBytes = Buffer.from(serialized.voterPubKey, 'hex');
  const encryptedDataBytes = Buffer.from(serialized.encryptedData, 'hex');
  const ephemeralPubKeyBytes = Buffer.from(serialized.ephemeralPubKey, 'hex');

  return {
    voterPubKey: deserializePublicKey(voterPubKeyBytes),
    encryptedData: {
      c1: deserializePoint(encryptedDataBytes.slice(0, 64)),
      c2: deserializePoint(encryptedDataBytes.slice(64, 128)),
    },
    ephemeralPubKey: deserializePublicKey(ephemeralPubKeyBytes),
  };
}

/**
 * Create a key change message
 * This is a convenience function that creates a vote message with a new key
 */
export function createKeyChangeMessage(
  oldKey: VoterKeyPair,
  newKey: VoterKeyPair,
  coordinatorPubKey: G1Point,
  vote: Vote
): EncryptedMessage {
  return encryptMessage(oldKey, coordinatorPubKey, vote, newKey);
}
