import { bn254, bn254_Fr } from '@noble/curves/bn254';
import { randomBytes } from '@noble/hashes/utils';
import { G1Point, Scalar, Ciphertext, discreteLog } from './elgamal';

/**
 * Silent Setup Threshold Encryption
 *
 * Unlike Trusted Dealer (Shamir) approach where a dealer knows the full secret,
 * Silent Setup has each member generate their own key independently.
 * The aggregate public key is the sum of all individual public keys.
 *
 * Math:
 *   Each member i: sk_i (random), pk_i = sk_i * G
 *   Aggregate PK = pk_1 + pk_2 + ... + pk_n = (sk_1 + ... + sk_n) * G
 *
 *   Encryption (same as before):
 *     C1 = r * G
 *     C2 = m * G + r * PK
 *
 *   Partial Decryption by member i:
 *     D_i = sk_i * C1
 *
 *   Full Decryption (n-of-n, all members):
 *     D = D_1 + D_2 + ... + D_n = (sk_1 + ... + sk_n) * C1
 *     m * G = C2 - D
 *
 * Key insight: No Lagrange interpolation needed! Just sum the partial decryptions.
 */

/**
 * Individual member's key pair
 */
export interface MemberKeyPair {
  index: number;
  secretKey: Scalar;
  publicKey: G1Point;
}

/**
 * Partial decryption from one member
 */
export interface PartialDecryption {
  memberIndex: number;
  share: G1Point; // sk_i * C1
}

/**
 * Generate key pair for an individual committee member
 *
 * Each member generates their own secret key independently.
 * No one else knows this secret key.
 *
 * @param index Member index (1-based)
 * @returns Member's key pair
 */
export function generateMemberKeyPair(index: number): MemberKeyPair {
  if (index < 1) {
    throw new Error('Member index must be >= 1');
  }

  // Generate random secret key
  const secretKey = bn254_Fr.create(
    BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex'))
  );

  // Public key = sk * G
  const publicKey = bn254.G1.Point.BASE.multiply(secretKey);

  return {
    index,
    secretKey,
    publicKey,
  };
}

/**
 * Aggregate multiple public keys into one
 *
 * The aggregated public key corresponds to the sum of all secret keys:
 *   PK = pk_1 + pk_2 + ... + pk_n = (sk_1 + sk_2 + ... + sk_n) * G
 *
 * @param publicKeys Array of individual public keys
 * @returns Aggregated public key
 */
export function aggregatePublicKeys(publicKeys: G1Point[]): G1Point {
  if (publicKeys.length === 0) {
    throw new Error('Need at least one public key');
  }

  let aggregated = bn254.G1.Point.ZERO;
  for (const pk of publicKeys) {
    aggregated = aggregated.add(pk);
  }

  return aggregated;
}

/**
 * Create partial decryption for a ciphertext
 *
 * Each member computes: D_i = sk_i * C1
 *
 * @param ciphertext Ciphertext to decrypt
 * @param secretKey Member's secret key
 * @param memberIndex Member's index
 * @returns Partial decryption
 */
export function createPartialDecryption(
  ciphertext: Ciphertext,
  secretKey: Scalar,
  memberIndex: number
): PartialDecryption {
  // D_i = sk_i * C1
  const share = ciphertext.c1.multiply(secretKey);

  return {
    memberIndex,
    share,
  };
}

/**
 * Combine partial decryptions (n-of-n scheme)
 *
 * Simply sums all partial decryptions:
 *   D = D_1 + D_2 + ... + D_n
 *
 * Unlike Shamir-based threshold schemes, no Lagrange interpolation needed!
 *
 * @param ciphertext Original ciphertext
 * @param partials All partial decryptions (must be from all n members)
 * @returns Message point m * G
 */
export function combinePartialDecryptions(
  ciphertext: Ciphertext,
  partials: PartialDecryption[]
): G1Point {
  if (partials.length === 0) {
    throw new Error('Need at least one partial decryption');
  }

  // Sum all partial decryptions
  let combinedShare = bn254.G1.Point.ZERO;
  for (const partial of partials) {
    combinedShare = combinedShare.add(partial.share);
  }

  // m * G = C2 - D
  const messagePoint = ciphertext.c2.subtract(combinedShare);

  return messagePoint;
}

/**
 * Full decryption with discrete log (n-of-n scheme)
 *
 * @param ciphertext Ciphertext to decrypt
 * @param partials All partial decryptions
 * @param maxTries Maximum value for discrete log search
 * @returns Decrypted message as bigint, or null if not found
 */
export function silentDecrypt(
  ciphertext: Ciphertext,
  partials: PartialDecryption[],
  maxTries: number = 10000
): bigint | null {
  const messagePoint = combinePartialDecryptions(ciphertext, partials);
  return discreteLog(messagePoint, maxTries);
}
