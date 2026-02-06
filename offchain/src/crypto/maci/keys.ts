import { bn254, bn254_Fr } from '@noble/curves/bn254';
import { randomBytes } from '@noble/hashes/utils';
import { G1Point, Scalar, serializePoint, deserializePoint } from '../elgamal';

/**
 * MACI Voter Key Management
 *
 * Key features:
 * - Each voter generates their own keypair
 * - Voters can change keys to invalidate previous votes (bribery defense)
 * - Nonce tracks key changes for ordering
 *
 * Key change flow:
 * 1. Voter creates initial key (nonce=0)
 * 2. Voter submits vote signed with this key
 * 3. If bribed, voter generates new key (nonce=1) and revotes
 * 4. Coordinator only counts the latest valid vote per voter
 */

/**
 * Voter's keypair with nonce for key change tracking
 */
export interface VoterKeyPair {
  privateKey: Scalar;
  publicKey: G1Point;
  nonce: number;
}

/**
 * Serialized voter key for storage (localStorage, etc.)
 */
export interface SerializedVoterKey {
  privateKey: string; // hex
  publicKey: {
    x: string; // hex
    y: string; // hex
  };
  nonce: number;
}

/**
 * Coordinator's keypair (for message encryption)
 */
export interface CoordinatorKeyPair {
  privateKey: Scalar;
  publicKey: G1Point;
}

/**
 * Generate a new voter keypair
 * @param nonce Key change counter (default 0 for initial key)
 * @returns New voter keypair
 */
export function generateVoterKeyPair(nonce: number = 0): VoterKeyPair {
  const privateKey = bn254_Fr.create(
    BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex'))
  );
  const publicKey = bn254.G1.Point.BASE.multiply(privateKey);

  return {
    privateKey,
    publicKey,
    nonce,
  };
}

/**
 * Generate a new key, incrementing nonce (for key change)
 * This invalidates the previous key's votes
 * @param oldKey Previous voter key
 * @returns New voter keypair with incremented nonce
 */
export function changeVoterKey(oldKey: VoterKeyPair): VoterKeyPair {
  return generateVoterKeyPair(oldKey.nonce + 1);
}

/**
 * Generate coordinator keypair
 * Coordinator's public key is used by voters to encrypt messages
 * @returns Coordinator keypair
 */
export function generateCoordinatorKeyPair(): CoordinatorKeyPair {
  const privateKey = bn254_Fr.create(
    BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex'))
  );
  const publicKey = bn254.G1.Point.BASE.multiply(privateKey);

  return {
    privateKey,
    publicKey,
  };
}

/**
 * Compute shared secret using ECDH
 * Used for encrypting messages to coordinator
 * @param privateKey Sender's private key
 * @param publicKey Recipient's public key
 * @returns Shared secret point
 */
export function computeSharedSecret(
  privateKey: Scalar,
  publicKey: G1Point
): G1Point {
  return publicKey.multiply(privateKey);
}

/**
 * Derive encryption key from shared secret
 * Uses the x-coordinate of the shared secret point
 * @param sharedSecret ECDH shared secret point
 * @returns Scalar for use as encryption key
 */
export function deriveEncryptionKey(sharedSecret: G1Point): Scalar {
  const affine = sharedSecret.toAffine();
  // Use x-coordinate mod curve order as symmetric key
  return bn254_Fr.create(affine.x);
}

/**
 * Serialize voter keypair for storage
 * @param keyPair Voter keypair to serialize
 * @returns JSON-serializable object
 */
export function serializeVoterKey(keyPair: VoterKeyPair): SerializedVoterKey {
  const affine = keyPair.publicKey.toAffine();

  return {
    privateKey: keyPair.privateKey.toString(16).padStart(64, '0'),
    publicKey: {
      x: affine.x.toString(16).padStart(64, '0'),
      y: affine.y.toString(16).padStart(64, '0'),
    },
    nonce: keyPair.nonce,
  };
}

/**
 * Deserialize voter keypair from storage
 * @param serialized Serialized voter key
 * @returns Voter keypair
 */
export function deserializeVoterKey(serialized: SerializedVoterKey): VoterKeyPair {
  const privateKey = BigInt('0x' + serialized.privateKey);
  const publicKey = bn254.G1.Point.fromAffine({
    x: BigInt('0x' + serialized.publicKey.x),
    y: BigInt('0x' + serialized.publicKey.y),
  });

  return {
    privateKey,
    publicKey,
    nonce: serialized.nonce,
  };
}

/**
 * Serialize public key to bytes (for on-chain storage)
 * @param publicKey Public key point
 * @returns 64 bytes (x || y)
 */
export function serializePublicKey(publicKey: G1Point): Uint8Array {
  return serializePoint(publicKey);
}

/**
 * Deserialize public key from bytes
 * @param bytes 64 bytes (x || y)
 * @returns Public key point
 */
export function deserializePublicKey(bytes: Uint8Array): G1Point {
  return deserializePoint(bytes);
}

/**
 * Get public key hash (for voter identification)
 * @param publicKey Voter's public key
 * @returns Hex string hash of the public key
 */
export function getPublicKeyHash(publicKey: G1Point): string {
  const bytes = serializePublicKey(publicKey);
  // Simple hash: just use first 20 bytes of serialized key as identifier
  // In production, use keccak256
  return Buffer.from(bytes.slice(0, 20)).toString('hex');
}

/**
 * Verify that a public key matches a private key
 * @param privateKey Private key to verify
 * @param publicKey Expected public key
 * @returns True if keys match
 */
export function verifyKeyPair(privateKey: Scalar, publicKey: G1Point): boolean {
  const derivedPublicKey = bn254.G1.Point.BASE.multiply(privateKey);
  return derivedPublicKey.equals(publicKey);
}
