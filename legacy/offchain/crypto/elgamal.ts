import { bn254, bn254_Fr } from '@noble/curves/bn254';
import { randomBytes } from '@noble/hashes/utils';

/**
 * ElGamal encryption on BN254 (alt_bn128) curve
 * Used for threshold encryption in secure voting
 */

export type G1Point = typeof bn254.G1.Point.BASE;
export type Scalar = bigint;

/**
 * ElGamal ciphertext (C1, C2)
 */
export interface Ciphertext {
  c1: G1Point; // r*G
  c2: G1Point; // m*G + r*PK
}

/**
 * ElGamal keypair
 */
export interface KeyPair {
  publicKey: G1Point;
  secretKey: Scalar;
}

/**
 * Generate random ElGamal keypair
 */
export function generateKeyPair(): KeyPair {
  const secretKey = bn254_Fr.create(BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex')));
  const publicKey = bn254.G1.Point.BASE.multiply(secretKey);

  return { publicKey, secretKey };
}

/**
 * Encrypt a message (represented as scalar) with ElGamal
 * @param message Message as bigint (e.g., 0 = no, 1 = yes)
 * @param publicKey Recipient's public key
 * @returns Ciphertext (C1, C2)
 */
export function encrypt(message: bigint, publicKey: G1Point): Ciphertext {
  // Random ephemeral key r
  const r = bn254_Fr.create(BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex')));

  // C1 = r * G
  const c1 = bn254.G1.Point.BASE.multiply(r);

  // C2 = m * G + r * PK
  // Handle message = 0 specially (identity point)
  const messagePoint = message === 0n
    ? bn254.G1.Point.ZERO
    : bn254.G1.Point.BASE.multiply(message);

  const sharedSecret = publicKey.multiply(r);
  const c2 = messagePoint.add(sharedSecret);

  return { c1, c2 };
}

/**
 * Decrypt ElGamal ciphertext with secret key
 * @param ciphertext Ciphertext to decrypt
 * @param secretKey Secret key
 * @returns Decrypted message point (needs discrete log to get scalar)
 */
export function decrypt(ciphertext: Ciphertext, secretKey: Scalar): G1Point {
  // m*G = C2 - sk*C1
  const sharedSecret = ciphertext.c1.multiply(secretKey);
  const messagePoint = ciphertext.c2.subtract(sharedSecret);

  return messagePoint;
}

/**
 * Brute-force discrete log for small messages (0, 1, 2, ...)
 * Only works for small message space (e.g., vote counts)
 * @param messagePoint Point to solve discrete log for
 * @param maxTries Maximum value to try (default 10000)
 * @returns Message as bigint, or null if not found
 */
export function discreteLog(messagePoint: G1Point, maxTries: number = 10000): bigint | null {
  const base = bn254.G1.Point.BASE;

  // Check if message is zero (identity point)
  if (messagePoint.equals(bn254.G1.Point.ZERO)) {
    return 0n;
  }

  // Start from 1 to avoid multiply(0n) which fails on BASE
  for (let i = 1; i < maxTries; i++) {
    const candidate = base.multiply(BigInt(i));
    if (candidate.equals(messagePoint)) {
      return BigInt(i);
    }
  }

  return null;
}

/**
 * Decrypt and solve discrete log in one step
 * @param ciphertext Ciphertext to decrypt
 * @param secretKey Secret key
 * @param maxTries Maximum value to try
 * @returns Decrypted message as bigint, or null if not found
 */
export function decryptMessage(
  ciphertext: Ciphertext,
  secretKey: Scalar,
  maxTries: number = 10000
): bigint | null {
  const messagePoint = decrypt(ciphertext, secretKey);
  return discreteLog(messagePoint, maxTries);
}

/**
 * Serialize point to bytes (for on-chain storage)
 * Format: x (32 bytes) || y (32 bytes) uncompressed
 */
export function serializePoint(point: G1Point): Uint8Array {
  const affine = point.toAffine();
  const xHex = affine.x.toString(16).padStart(64, '0');
  const yHex = affine.y.toString(16).padStart(64, '0');

  return Buffer.concat([
    Buffer.from(xHex, 'hex'),
    Buffer.from(yHex, 'hex')
  ]);
}

/**
 * Deserialize point from bytes
 */
export function deserializePoint(bytes: Uint8Array): G1Point {
  if (bytes.length !== 64) {
    throw new Error('Invalid point bytes length');
  }

  const x = BigInt('0x' + Buffer.from(bytes.slice(0, 32)).toString('hex'));
  const y = BigInt('0x' + Buffer.from(bytes.slice(32, 64)).toString('hex'));

  return bn254.G1.Point.fromAffine({ x, y });
}

/**
 * Serialize ciphertext to hex string
 */
export function serializeCiphertext(ciphertext: Ciphertext): string {
  const c1Bytes = serializePoint(ciphertext.c1);
  const c2Bytes = serializePoint(ciphertext.c2);

  return Buffer.concat([
    Buffer.from(c1Bytes),
    Buffer.from(c2Bytes)
  ]).toString('hex');
}

/**
 * Deserialize ciphertext from hex string
 */
export function deserializeCiphertext(hex: string): Ciphertext {
  const bytes = Buffer.from(hex, 'hex');
  const pointSize = 64; // uncompressed point size for BN254

  const c1 = deserializePoint(bytes.slice(0, pointSize));
  const c2 = deserializePoint(bytes.slice(pointSize, pointSize * 2));

  return { c1, c2 };
}

/**
 * Create a G1 point from x,y coordinates
 * Useful for reconstructing public keys from stored coordinates
 */
export function pointFromCoordinates(x: bigint | string, y: bigint | string): G1Point {
  const xBigInt = typeof x === 'string' ? BigInt(x) : x;
  const yBigInt = typeof y === 'string' ? BigInt(y) : y;
  return bn254.G1.Point.fromAffine({ x: xBigInt, y: yBigInt });
}
