/**
 * ZKP Proof Generator
 *
 * Generates Groth16 proofs using snarkjs for the SingleMessageProcessor circuit.
 * Proofs can be verified both off-chain and on-chain (via Solidity verifier).
 */

import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';
import { CircuitInput, validateWitnessInput, extractPublicSignals } from './witness';

/**
 * Groth16 proof structure
 */
export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: string;
  curve: string;
}

/**
 * Proof with public signals
 */
export interface ProofWithSignals {
  proof: Groth16Proof;
  publicSignals: string[];
}

/**
 * Solidity-formatted proof for on-chain verification
 */
export interface SolidityProof {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
}

/**
 * Solidity calldata for verifier contract
 */
export interface SolidityCalldata {
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
  pubSignals: string[];
}

/**
 * Default paths for circuit artifacts
 */
const DEFAULT_WASM_PATH = 'circuits/build/SingleMessageProcessor_js/SingleMessageProcessor.wasm';
const DEFAULT_ZKEY_PATH = 'circuits/build/circuit_final.zkey';
const DEFAULT_VKEY_PATH = 'circuits/build/verification_key.json';

/**
 * Prover configuration
 */
export interface ProverConfig {
  wasmPath?: string;
  zkeyPath?: string;
  vkeyPath?: string;
  projectRoot?: string;
}

/**
 * ZKP Prover class
 */
export class Prover {
  private wasmPath: string;
  private zkeyPath: string;
  private vkeyPath: string;
  private vkey: any | null = null;

  constructor(config: ProverConfig = {}) {
    const projectRoot = config.projectRoot || process.cwd();
    this.wasmPath = config.wasmPath || path.join(projectRoot, DEFAULT_WASM_PATH);
    this.zkeyPath = config.zkeyPath || path.join(projectRoot, DEFAULT_ZKEY_PATH);
    this.vkeyPath = config.vkeyPath || path.join(projectRoot, DEFAULT_VKEY_PATH);
  }

  /**
   * Check if circuit artifacts exist
   */
  async checkArtifacts(): Promise<{ ready: boolean; missing: string[] }> {
    const missing: string[] = [];

    if (!fs.existsSync(this.wasmPath)) {
      missing.push(`WASM: ${this.wasmPath}`);
    }
    if (!fs.existsSync(this.zkeyPath)) {
      missing.push(`zkey: ${this.zkeyPath}`);
    }
    if (!fs.existsSync(this.vkeyPath)) {
      missing.push(`vkey: ${this.vkeyPath}`);
    }

    return {
      ready: missing.length === 0,
      missing,
    };
  }

  /**
   * Load verification key
   */
  async loadVerificationKey(): Promise<any> {
    if (!this.vkey) {
      const vkeyJson = fs.readFileSync(this.vkeyPath, 'utf8');
      this.vkey = JSON.parse(vkeyJson);
    }
    return this.vkey;
  }

  /**
   * Generate a Groth16 proof
   */
  async generateProof(input: CircuitInput): Promise<ProofWithSignals> {
    // Validate input
    const validation = validateWitnessInput(input);
    if (!validation.valid) {
      throw new Error(`Invalid witness input: ${validation.errors.join(', ')}`);
    }

    // Check artifacts
    const artifacts = await this.checkArtifacts();
    if (!artifacts.ready) {
      throw new Error(
        `Missing circuit artifacts: ${artifacts.missing.join(', ')}. ` +
        'Run scripts/compile-circuit.sh first.'
      );
    }

    // Generate proof using snarkjs
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      this.wasmPath,
      this.zkeyPath
    );

    return {
      proof: proof as Groth16Proof,
      publicSignals,
    };
  }

  /**
   * Verify a proof off-chain
   */
  async verifyProof(proofWithSignals: ProofWithSignals): Promise<boolean> {
    const vkey = await this.loadVerificationKey();
    return snarkjs.groth16.verify(
      vkey,
      proofWithSignals.publicSignals,
      proofWithSignals.proof
    );
  }

  /**
   * Format proof for Solidity verifier
   */
  formatProofForSolidity(proof: Groth16Proof): SolidityProof {
    return {
      a: [proof.pi_a[0], proof.pi_a[1]],
      b: [
        [proof.pi_b[0][1], proof.pi_b[0][0]], // Note: reversed for Solidity
        [proof.pi_b[1][1], proof.pi_b[1][0]],
      ],
      c: [proof.pi_c[0], proof.pi_c[1]],
    };
  }

  /**
   * Generate Solidity calldata for verifier contract
   */
  async generateSolidityCalldata(proofWithSignals: ProofWithSignals): Promise<SolidityCalldata> {
    const { proof, publicSignals } = proofWithSignals;
    const solidityProof = this.formatProofForSolidity(proof);

    return {
      pA: solidityProof.a,
      pB: solidityProof.b,
      pC: solidityProof.c,
      pubSignals: publicSignals,
    };
  }

  /**
   * Export proof as JSON string
   */
  proofToJson(proofWithSignals: ProofWithSignals): string {
    return JSON.stringify(proofWithSignals, null, 2);
  }

  /**
   * Import proof from JSON string
   */
  proofFromJson(json: string): ProofWithSignals {
    return JSON.parse(json) as ProofWithSignals;
  }

  /**
   * Generate calldata string for direct contract interaction
   */
  async generateCalldataString(proofWithSignals: ProofWithSignals): Promise<string> {
    const calldata = await this.generateSolidityCalldata(proofWithSignals);

    // Format as Solidity function arguments
    const pA = `[${calldata.pA.join(', ')}]`;
    const pB = `[[${calldata.pB[0].join(', ')}], [${calldata.pB[1].join(', ')}]]`;
    const pC = `[${calldata.pC.join(', ')}]`;
    const pubSignals = `[${calldata.pubSignals.join(', ')}]`;

    return `${pA}, ${pB}, ${pC}, ${pubSignals}`;
  }
}

/**
 * Generate proof for a single message (convenience function)
 */
export async function generateProof(
  input: CircuitInput,
  config?: ProverConfig
): Promise<ProofWithSignals> {
  const prover = new Prover(config);
  return prover.generateProof(input);
}

/**
 * Verify proof off-chain (convenience function)
 */
export async function verifyProof(
  proofWithSignals: ProofWithSignals,
  config?: ProverConfig
): Promise<boolean> {
  const prover = new Prover(config);
  return prover.verifyProof(proofWithSignals);
}

/**
 * Format proof for Solidity (convenience function)
 */
export function formatProofForSolidity(proof: Groth16Proof): SolidityProof {
  const prover = new Prover();
  return prover.formatProofForSolidity(proof);
}

/**
 * Create a mock proof for testing (when circuit is not compiled)
 */
export function createMockProof(publicSignals: string[]): ProofWithSignals {
  return {
    proof: {
      pi_a: ['1', '2', '1'],
      pi_b: [
        ['3', '4'],
        ['5', '6'],
        ['1', '1'],
      ],
      pi_c: ['7', '8', '1'],
      protocol: 'groth16',
      curve: 'bn128',
    },
    publicSignals,
  };
}

/**
 * Create mock Solidity calldata for testing
 */
export function createMockSolidityCalldata(
  publicSignals: string[]
): SolidityCalldata {
  return {
    pA: ['1', '2'],
    pB: [
      ['4', '3'], // reversed
      ['6', '5'],
    ],
    pC: ['7', '8'],
    pubSignals: publicSignals,
  };
}
