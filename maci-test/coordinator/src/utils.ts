/**
 * Coordinator utility functions for proof format conversion and commitment extraction.
 */
import * as fs from "fs";
import * as path from "path";

/**
 * Convert snarkjs proof to uint256[8] for on-chain verification.
 * snarkjs: { pi_a: [x,y,"1"], pi_b: [[x1,x2],[y1,y2],["1","0"]], pi_c: [x,y,"1"] }
 * uint256[8]: [a.x, a.y, b[0][1], b[0][0], b[1][1], b[1][0], c.x, c.y]
 * Note: pi_b coordinates are swapped (x1,x2 → x2,x1) for BN254 pairing.
 */
export function proofToUint256Array(proof: any): string[] {
  return [
    proof.pi_a[0],
    proof.pi_a[1],
    proof.pi_b[0][1],
    proof.pi_b[0][0],
    proof.pi_b[1][1],
    proof.pi_b[1][0],
    proof.pi_c[0],
    proof.pi_c[1],
  ];
}

/**
 * Extract PM commitment chain from proof files.
 * MACI processes messages in reverse order, so process_0 is the FIRST batch executed.
 * Returns: [initial_sbCommitment, after_batch_1, after_batch_2, ..., final]
 */
export function extractPmCommitments(outputDir: string): bigint[] {
  const proofFiles: any[] = [];
  let idx = 0;
  while (fs.existsSync(path.join(outputDir, `process_${idx}.json`))) {
    proofFiles.push(
      JSON.parse(fs.readFileSync(path.join(outputDir, `process_${idx}.json`), "utf8"))
    );
    idx++;
  }

  const commitments: bigint[] = [];
  commitments.push(BigInt(proofFiles[0].circuitInputs.currentSbCommitment));
  for (const pf of proofFiles) {
    commitments.push(BigInt(pf.circuitInputs.newSbCommitment));
  }
  return commitments;
}

/**
 * Extract TV commitment chain from proof files.
 * Tally proofs are in forward order: tally_0, tally_1, ..., tally_N.
 * Returns: [0 (initial), after_tally_1, after_tally_2, ..., final]
 */
export function extractTvCommitments(outputDir: string): bigint[] {
  const proofFiles: any[] = [];
  let idx = 0;
  while (fs.existsSync(path.join(outputDir, `tally_${idx}.json`))) {
    proofFiles.push(
      JSON.parse(fs.readFileSync(path.join(outputDir, `tally_${idx}.json`), "utf8"))
    );
    idx++;
  }

  const commitments: bigint[] = [];
  commitments.push(BigInt(proofFiles[0].circuitInputs.currentTallyCommitment));
  for (const pf of proofFiles) {
    commitments.push(BigInt(pf.circuitInputs.newTallyCommitment));
  }
  return commitments;
}

/**
 * Load proof files and return them indexed by batch number (0-based file index).
 */
export function loadProofFiles(outputDir: string, prefix: string): any[] {
  const proofs: any[] = [];
  let idx = 0;
  while (fs.existsSync(path.join(outputDir, `${prefix}_${idx}.json`))) {
    proofs.push(
      JSON.parse(fs.readFileSync(path.join(outputDir, `${prefix}_${idx}.json`), "utf8"))
    );
    idx++;
  }
  return proofs;
}

/**
 * Load a verifying key from a JSON file.
 */
export function loadVkFromFile(vkPath: string): any {
  return JSON.parse(fs.readFileSync(vkPath, "utf8"));
}
