/**
 * MACI-RLA Coordinator Service
 *
 * Provides modular pipeline functions for:
 * - Proof generation (tree merge → ProcessMessages/TallyVotes proofs)
 * - RLA submission (commit → reveal → submit sampled proofs → finalize)
 */
export { runProofPipeline } from "./proof-pipeline";
export type { ProofResult, ZKeyPaths } from "./proof-pipeline";

export { runRlaPipeline } from "./rla-pipeline";
export type { RlaResult } from "./rla-pipeline";

export { deployFullStack } from "./maci-deploy";
export type { DeployConfig, DeployResult } from "./maci-deploy";

export {
  proofToUint256Array,
  extractPmCommitments,
  extractTvCommitments,
  loadProofFiles,
  loadVkFromFile,
} from "./utils";
