/**
 * Coordinator batch proof generation script.
 * Run via: npx hardhat run scripts/coordinator-prove-batch.ts --network localhost
 *
 * Generates Groth16 proofs for specific batches only.
 * Reads batch list from proofs-web/prove-batches.json (written by the API route).
 *
 * Input format (proofs-web/prove-batches.json):
 *   { "pm": [0, 2], "tv": [1, 3] }
 *   — file indices (0-based) of batches to prove
 *
 * For each batch:
 *   1. Load circuit inputs from proofs-web/process_X_inputs.json or tally_X_inputs.json
 *   2. Run groth16.fullProve() with the appropriate zkey + wasm
 *   3. Write proof file: proofs-web/process_X.json or proofs-web/tally_X.json
 */
import * as path from "path";
import * as fs from "fs";
// @ts-ignore
import * as snarkjs from "snarkjs";

const OUTPUT_DIR = path.resolve(__dirname, "../proofs-web");
const STATUS_FILE = path.join(OUTPUT_DIR, "status.json");
const PROVE_BATCHES_FILE = path.join(OUTPUT_DIR, "prove-batches.json");

const ZKEYS_DIR = path.resolve(__dirname, "../zkeys");
const PM_DIR = "ProcessMessages_10-2-1-2_test";
const PM_ZKEY = path.join(ZKEYS_DIR, PM_DIR, `${PM_DIR}.0.zkey`);
const PM_WASM = path.join(ZKEYS_DIR, PM_DIR, `${PM_DIR}_js`, `${PM_DIR}.wasm`);
const TV_DIR = "TallyVotes_10-1-2_test";
const TV_ZKEY = path.join(ZKEYS_DIR, TV_DIR, `${TV_DIR}.0.zkey`);
const TV_WASM = path.join(ZKEYS_DIR, TV_DIR, `${TV_DIR}_js`, `${TV_DIR}.wasm`);

function writeStatus(status: string, data: any = {}) {
  const existing = fs.existsSync(STATUS_FILE)
    ? JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"))
    : {};
  fs.writeFileSync(STATUS_FILE, JSON.stringify({
    ...existing,
    proveStatus: status,
    ...data,
    proveUpdatedAt: new Date().toISOString(),
  }, null, 2));
}

async function main() {
  if (!fs.existsSync(PROVE_BATCHES_FILE)) {
    throw new Error(`prove-batches.json not found at ${PROVE_BATCHES_FILE}. Write it before running this script.`);
  }

  const batches = JSON.parse(fs.readFileSync(PROVE_BATCHES_FILE, "utf8"));
  const pmBatches: number[] = batches.pm || [];
  const tvBatches: number[] = batches.tv || [];
  const totalBatches = pmBatches.length + tvBatches.length;

  if (totalBatches === 0) {
    console.log("  No batches to prove.");
    writeStatus("prove-complete", { provedCount: 0 });
    return;
  }

  // Verify zkeys exist
  if (pmBatches.length > 0 && !fs.existsSync(PM_ZKEY)) {
    throw new Error(`PM zkey not found: ${PM_ZKEY}`);
  }
  if (tvBatches.length > 0 && !fs.existsSync(TV_ZKEY)) {
    throw new Error(`TV zkey not found: ${TV_ZKEY}`);
  }

  writeStatus("proving", { totalToProve: totalBatches, proved: 0 });
  let proved = 0;

  // Generate PM proofs
  for (const idx of pmBatches) {
    const inputFile = path.join(OUTPUT_DIR, `process_${idx}_inputs.json`);
    if (!fs.existsSync(inputFile)) {
      throw new Error(`Circuit inputs not found: ${inputFile}`);
    }

    console.log(`  Generating PM proof for batch ${idx}...`);
    const circuitInputs = JSON.parse(fs.readFileSync(inputFile, "utf8"));
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      PM_WASM,
      PM_ZKEY
    );

    // Write proof file in same format as ProofGenerator
    const proofFile = path.join(OUTPUT_DIR, `process_${idx}.json`);
    fs.writeFileSync(proofFile, JSON.stringify({
      proof,
      publicSignals,
      circuitInputs,
    }, null, 2));

    proved++;
    writeStatus("proving", { totalToProve: totalBatches, proved });
    console.log(`    PM batch ${idx} proof generated (${proved}/${totalBatches})`);
  }

  // Generate TV proofs
  for (const idx of tvBatches) {
    const inputFile = path.join(OUTPUT_DIR, `tally_${idx}_inputs.json`);
    if (!fs.existsSync(inputFile)) {
      throw new Error(`Circuit inputs not found: ${inputFile}`);
    }

    console.log(`  Generating TV proof for batch ${idx}...`);
    const circuitInputs = JSON.parse(fs.readFileSync(inputFile, "utf8"));
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      TV_WASM,
      TV_ZKEY
    );

    // Write proof file in same format as ProofGenerator
    const proofFile = path.join(OUTPUT_DIR, `tally_${idx}.json`);
    fs.writeFileSync(proofFile, JSON.stringify({
      proof,
      publicSignals,
      circuitInputs,
    }, null, 2));

    proved++;
    writeStatus("proving", { totalToProve: totalBatches, proved });
    console.log(`    TV batch ${idx} proof generated (${proved}/${totalBatches})`);
  }

  writeStatus("prove-complete", { totalToProve: totalBatches, proved });
  console.log(`\n  Done! ${proved} proofs generated.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Batch proof generation failed:", err);
    try {
      writeStatus("prove-error", { error: err.message });
    } catch {}
    process.exit(1);
  });
