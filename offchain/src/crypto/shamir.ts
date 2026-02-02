import { bn254, bn254_Fr } from '@noble/curves/bn254';
import { randomBytes } from '@noble/hashes/utils';

/**
 * Shamir Secret Sharing implementation for threshold cryptography
 * Used for simple DKG (Distributed Key Generation)
 */

export type Scalar = bigint;
export type Share = {
  index: number;
  value: Scalar;
};

/**
 * Evaluate polynomial at x
 * P(x) = coefficients[0] + coefficients[1]*x + coefficients[2]*x^2 + ...
 */
function evaluatePolynomial(coefficients: Scalar[], x: Scalar): Scalar {
  const field = bn254_Fr;
  let result = field.create(0n);
  let xPower = field.create(1n);

  for (const coeff of coefficients) {
    result = field.add(result, field.mul(coeff, xPower));
    xPower = field.mul(xPower, x);
  }

  return result;
}

/**
 * Generate random polynomial of degree (threshold - 1)
 * The constant term is the secret
 */
function generateRandomPolynomial(secret: Scalar, threshold: number): Scalar[] {
  const field = bn254_Fr;
  const coefficients: Scalar[] = [secret];

  for (let i = 1; i < threshold; i++) {
    const randomCoeff = field.create(
      BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex'))
    );
    coefficients.push(randomCoeff);
  }

  return coefficients;
}

/**
 * Split secret into n shares with threshold k
 * @param secret Secret to split
 * @param n Total number of shares
 * @param k Threshold (minimum shares needed to reconstruct)
 * @returns Array of shares
 */
export function splitSecret(secret: Scalar, n: number, k: number): Share[] {
  if (k > n) {
    throw new Error('Threshold cannot be greater than total shares');
  }
  if (k < 1) {
    throw new Error('Threshold must be at least 1');
  }

  const polynomial = generateRandomPolynomial(secret, k);
  const shares: Share[] = [];

  // Generate shares for indices 1, 2, ..., n
  for (let i = 1; i <= n; i++) {
    const value = evaluatePolynomial(polynomial, BigInt(i));
    shares.push({ index: i, value });
  }

  return shares;
}

/**
 * Lagrange interpolation to reconstruct secret from shares
 * @param shares Array of shares (at least k shares)
 * @returns Reconstructed secret
 */
export function reconstructSecret(shares: Share[]): Scalar {
  if (shares.length === 0) {
    throw new Error('Need at least one share');
  }

  const field = bn254_Fr;
  let secret = field.create(0n);

  // Lagrange interpolation at x=0
  for (let i = 0; i < shares.length; i++) {
    const xi = BigInt(shares[i].index);
    let numerator = field.create(1n);
    let denominator = field.create(1n);

    for (let j = 0; j < shares.length; j++) {
      if (i !== j) {
        const xj = BigInt(shares[j].index);

        // numerator *= (0 - xj) = -xj
        numerator = field.mul(numerator, field.neg(xj));

        // denominator *= (xi - xj)
        denominator = field.mul(denominator, field.sub(xi, xj));
      }
    }

    // Lagrange basis polynomial Li(0)
    const Li = field.div(numerator, denominator);

    // secret += yi * Li(0)
    secret = field.add(secret, field.mul(shares[i].value, Li));
  }

  return secret;
}

/**
 * Verify that a share is valid for given public polynomial commitments
 * (For verifiable secret sharing - VSS)
 */
export function verifyShare(
  share: Share,
  commitments: typeof bn254.G1.Point.BASE[]
): boolean {
  const field = bn254_Fr;
  const G = bn254.G1.Point.BASE;

  // Compute expected commitment: C = c0 * c1^i * c2^(i^2) * ...
  let expected = commitments[0];
  let iPower = field.create(BigInt(share.index));

  for (let j = 1; j < commitments.length; j++) {
    expected = expected.add(commitments[j].multiply(iPower));
    iPower = field.mul(iPower, BigInt(share.index));
  }

  // Actual commitment: s_i * G
  const actual = G.multiply(share.value);

  return expected.equals(actual);
}

/**
 * Generate commitments for polynomial (for VSS)
 * Commitments: [c0*G, c1*G, c2*G, ...] where ci are polynomial coefficients
 */
export function generateCommitments(
  coefficients: Scalar[]
): typeof bn254.G1.Point.BASE[] {
  const G = bn254.G1.Point.BASE;
  return coefficients.map(coeff => G.multiply(coeff));
}
