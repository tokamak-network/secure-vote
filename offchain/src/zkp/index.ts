/**
 * ZKP Module
 *
 * Exports all ZKP-related functionality for the secure voting system.
 */

// Witness generation
export {
  CircuitInput,
  WitnessInputData,
  generateWitnessInput,
  validateWitnessInput,
  circuitInputToJson,
  extractPublicSignals,
} from './witness';

// Proof generation and verification
export {
  Groth16Proof,
  ProofWithSignals,
  SolidityProof,
  SolidityCalldata,
  ProverConfig,
  Prover,
  generateProof,
  verifyProof,
  formatProofForSolidity,
  createMockProof,
  createMockSolidityCalldata,
} from './prover';
