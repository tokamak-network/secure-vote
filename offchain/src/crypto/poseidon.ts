/**
 * Poseidon Hash Functions
 *
 * Provides ZK-friendly Poseidon hash functions compatible with circomlib.
 * Used for computing state roots and leaf hashes for circuit verification.
 *
 * IMPORTANT: This implementation must match the Poseidon parameters in
 * circomlib/circuits/poseidon.circom for circuit compatibility.
 */

import { buildPoseidon, Poseidon } from 'circomlibjs';

// Global Poseidon instance (lazy initialized)
let poseidonInstance: Poseidon | null = null;

// BN254 scalar field modulus
export const SNARK_SCALAR_FIELD = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

/**
 * Initialize Poseidon (call once at startup)
 */
export async function initPoseidon(): Promise<Poseidon> {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

/**
 * Get Poseidon instance (must call initPoseidon first)
 */
export function getPoseidon(): Poseidon {
  if (!poseidonInstance) {
    throw new Error('Poseidon not initialized. Call initPoseidon() first.');
  }
  return poseidonInstance;
}

/**
 * Check if Poseidon is initialized
 */
export function isPoseidonInitialized(): boolean {
  return poseidonInstance !== null;
}

/**
 * Poseidon hash for arbitrary number of inputs (up to 16)
 * @param inputs Array of bigint inputs
 * @returns Hash as bigint (field element)
 */
export async function poseidonHash(inputs: bigint[]): Promise<bigint> {
  const poseidon = await initPoseidon();
  const hash = poseidon(inputs);
  return poseidon.F.toObject(hash) as bigint;
}

/**
 * Poseidon hash for 2 inputs (optimized for Merkle tree)
 */
export async function poseidonHash2(a: bigint, b: bigint): Promise<bigint> {
  return poseidonHash([a, b]);
}

/**
 * Poseidon hash for 4 inputs (optimized for voter state)
 */
export async function poseidonHash4(
  a: bigint,
  b: bigint,
  c: bigint,
  d: bigint
): Promise<bigint> {
  return poseidonHash([a, b, c, d]);
}

/**
 * Synchronous Poseidon hash (must init first)
 * Use when performance is critical and init is guaranteed
 */
export function poseidonHashSync(inputs: bigint[]): bigint {
  const poseidon = getPoseidon();
  const hash = poseidon(inputs);
  return poseidon.F.toObject(hash) as bigint;
}

/**
 * Synchronous Poseidon hash for 2 inputs
 */
export function poseidonHash2Sync(a: bigint, b: bigint): bigint {
  return poseidonHashSync([a, b]);
}

/**
 * Synchronous Poseidon hash for 4 inputs
 */
export function poseidonHash4Sync(
  a: bigint,
  b: bigint,
  c: bigint,
  d: bigint
): bigint {
  return poseidonHashSync([a, b, c, d]);
}

/**
 * Convert bigint to hex string (for storage/display)
 */
export function bigintToHex(value: bigint): string {
  return '0x' + value.toString(16).padStart(64, '0');
}

/**
 * Convert hex string to bigint
 */
export function hexToBigint(hex: string): bigint {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  return BigInt('0x' + cleanHex);
}

/**
 * Ensure value is within field range
 */
export function toFieldElement(value: bigint): bigint {
  const result = value % SNARK_SCALAR_FIELD;
  return result >= 0n ? result : result + SNARK_SCALAR_FIELD;
}

/**
 * Convert bytes to field element (for point coordinates)
 */
export function bytesToFieldElement(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return toFieldElement(result);
}
