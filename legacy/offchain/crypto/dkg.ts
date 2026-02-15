import { bn254, bn254_Fr } from '@noble/curves/bn254';
import { randomBytes } from '@noble/hashes/utils';
import { splitSecret, reconstructSecret, Share } from './shamir';
import { G1Point, Scalar, Ciphertext, decrypt, discreteLog } from './elgamal';

/**
 * Simple Distributed Key Generation (DKG) using Shamir Secret Sharing
 *
 * Note: This is a simplified version. In production, use proper DKG protocols
 * like Pedersen DKG or Feldman VSS for better security.
 */

export interface ThresholdKeyPair {
  publicKey: G1Point;
  shares: Share[];
  threshold: number;
  totalParties: number;
}

/**
 * Decryption share from one committee member
 */
export interface DecryptionShare {
  memberIndex: number;
  share: G1Point; // C1^sk_i
}

/**
 * Generate threshold keypair using Shamir Secret Sharing
 *
 * @param n Total number of parties
 * @param k Threshold (minimum parties needed)
 * @returns Threshold keypair with shares
 */
export function generateThresholdKey(n: number, k: number): ThresholdKeyPair {
  if (k > n) {
    throw new Error('Threshold cannot exceed total parties');
  }

  // Generate master secret key
  const masterSecretKey = bn254_Fr.create(
    BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex'))
  );

  // Public key = sk * G
  const publicKey = bn254.G1.Point.BASE.multiply(masterSecretKey);

  // Split secret into n shares with threshold k
  const shares = splitSecret(masterSecretKey, n, k);

  return {
    publicKey,
    shares,
    threshold: k,
    totalParties: n,
  };
}

/**
 * Create decryption share for a ciphertext
 *
 * Each committee member computes: D_i = C1^sk_i
 *
 * @param ciphertext Ciphertext to create share for
 * @param secretShare Committee member's secret share
 * @param memberIndex Member's index (1-based)
 * @returns Decryption share
 */
export function createDecryptionShare(
  ciphertext: Ciphertext,
  secretShare: Share,
  memberIndex: number
): DecryptionShare {
  // D_i = C1^sk_i
  const share = ciphertext.c1.multiply(secretShare.value);

  return {
    memberIndex,
    share,
  };
}

/**
 * Combine decryption shares to decrypt ciphertext
 *
 * Uses Lagrange interpolation to combine shares
 *
 * @param ciphertext Ciphertext to decrypt
 * @param decryptionShares Array of decryption shares (at least k)
 * @returns Decrypted message point
 */
export function combineDecryptionShares(
  ciphertext: Ciphertext,
  decryptionShares: DecryptionShare[]
): G1Point {
  if (decryptionShares.length === 0) {
    throw new Error('Need at least one decryption share');
  }

  const field = bn254_Fr;

  // Compute Lagrange coefficients at 0
  const indices = decryptionShares.map(s => BigInt(s.memberIndex));
  let combinedShare = bn254.G1.Point.ZERO;

  for (let i = 0; i < decryptionShares.length; i++) {
    const xi = indices[i];
    let numerator = field.create(1n);
    let denominator = field.create(1n);

    for (let j = 0; j < decryptionShares.length; j++) {
      if (i !== j) {
        const xj = indices[j];
        numerator = field.mul(numerator, field.neg(xj));
        denominator = field.mul(denominator, field.sub(xi, xj));
      }
    }

    const lambda = field.div(numerator, denominator);
    const contribution = decryptionShares[i].share.multiply(lambda);
    combinedShare = combinedShare.add(contribution);
  }

  // m*G = C2 - combined_share
  const messagePoint = ciphertext.c2.subtract(combinedShare);

  return messagePoint;
}

/**
 * Threshold decrypt and solve discrete log
 *
 * @param ciphertext Ciphertext to decrypt
 * @param decryptionShares Array of decryption shares (at least k)
 * @param maxTries Maximum value for discrete log
 * @returns Decrypted message as bigint, or null if not found
 */
export function thresholdDecrypt(
  ciphertext: Ciphertext,
  decryptionShares: DecryptionShare[],
  maxTries: number = 10000
): bigint | null {
  const messagePoint = combineDecryptionShares(ciphertext, decryptionShares);
  return discreteLog(messagePoint, maxTries);
}

/**
 * Serialize decryption share to bytes
 */
export function serializeDecryptionShare(share: DecryptionShare): string {
  const shareBytes = share.share.toRawBytes(false);
  return JSON.stringify({
    memberIndex: share.memberIndex,
    share: Buffer.from(shareBytes).toString('hex'),
  });
}

/**
 * Deserialize decryption share from bytes
 */
export function deserializeDecryptionShare(json: string): DecryptionShare {
  const data = JSON.parse(json);
  const shareBytes = Buffer.from(data.share, 'hex');
  const share = bn254.G1.Point.fromHex(shareBytes);

  return {
    memberIndex: data.memberIndex,
    share,
  };
}
