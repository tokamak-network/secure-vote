/**
 * Benchmark configuration for MACI E2E scaling tests
 *
 * Defines circuit paths and parameters for 10/30 vote benchmarks.
 * - 10 votes: uses existing 10-2-1-2 zkeys (max 25 messages)
 * - 30 votes: uses compiled 10-3-1-2 zkeys (max 125 messages)
 * - TallyVotes: all share 10-1-2 zkeys (independent of message tree)
 *
 * Each benchmark runs in a separate process (BENCH_NAME env var) to avoid
 * RSS accumulation from V8 not releasing memory to the OS.
 */
import * as path from "path";

const ZKEYS_DIR = path.resolve(__dirname, "../zkeys");

export interface BenchmarkConfig {
  name: string;
  numVoters: number;
  /** Ratio of Yes votes (e.g. 0.6 = 60% Yes) */
  yesRatio: number;
  /** Circuit tree parameters */
  stateTreeDepth: number;
  intStateTreeDepth: number;
  msgTreeDepth: number;
  msgTreeSubDepth: number;
  voteOptionTreeDepth: number;
  msgBatchSize: number;
  /** Zkey/wasm paths for ProcessMessages */
  processZkey: string;
  processWasm: string;
  processVkJson: string;
  /** Zkey/wasm paths for TallyVotes */
  tallyZkey: string;
  tallyWasm: string;
  tallyVkJson: string;
}

// ── Shared TallyVotes paths (10-1-2, used by all benchmarks) ──────────
const TALLY_ZKEY = path.join(
  ZKEYS_DIR,
  "TallyVotes_10-1-2_test",
  "TallyVotes_10-1-2_test.0.zkey"
);
const TALLY_WASM = path.join(
  ZKEYS_DIR,
  "TallyVotes_10-1-2_test",
  "TallyVotes_10-1-2_test_js",
  "TallyVotes_10-1-2_test.wasm"
);
const TALLY_VK_JSON = path.join(
  ZKEYS_DIR,
  "TallyVotes_10-1-2_test",
  "groth16_vkey.json"
);

// ── ProcessMessages paths for 10-2-1-2 (small, max 25 messages) ──────
const PM_SMALL_DIR = "ProcessMessages_10-2-1-2_test";
const PM_SMALL_ZKEY = path.join(ZKEYS_DIR, PM_SMALL_DIR, `${PM_SMALL_DIR}.0.zkey`);
const PM_SMALL_WASM = path.join(ZKEYS_DIR, PM_SMALL_DIR, `${PM_SMALL_DIR}_js`, `${PM_SMALL_DIR}.wasm`);
const PM_SMALL_VK = path.join(ZKEYS_DIR, PM_SMALL_DIR, "groth16_vkey.json");

// ── ProcessMessages paths for 10-3-1-2 (large, max 125 messages) ─────
const PM_LARGE_DIR = "ProcessMessages_10-3-1-2_test";
const PM_LARGE_ZKEY = path.join(ZKEYS_DIR, PM_LARGE_DIR, `${PM_LARGE_DIR}.0.zkey`);
const PM_LARGE_WASM = path.join(ZKEYS_DIR, PM_LARGE_DIR, `ProcessMessages_10-3-1-2_js`, `ProcessMessages_10-3-1-2.wasm`);
const PM_LARGE_VK = path.join(ZKEYS_DIR, PM_LARGE_DIR, "groth16_vkey.json");

export const BENCHMARKS: BenchmarkConfig[] = [
  {
    name: "10-vote",
    numVoters: 10,
    yesRatio: 0.6, // 6 Yes, 4 No
    stateTreeDepth: 10,
    intStateTreeDepth: 1,
    msgTreeDepth: 2,
    msgTreeSubDepth: 1,
    voteOptionTreeDepth: 2,
    msgBatchSize: 5, // 5^1
    processZkey: PM_SMALL_ZKEY,
    processWasm: PM_SMALL_WASM,
    processVkJson: PM_SMALL_VK,
    tallyZkey: TALLY_ZKEY,
    tallyWasm: TALLY_WASM,
    tallyVkJson: TALLY_VK_JSON,
  },
  {
    name: "30-vote",
    numVoters: 30,
    yesRatio: 0.6, // 18 Yes, 12 No
    stateTreeDepth: 10,
    intStateTreeDepth: 1,
    msgTreeDepth: 3,
    msgTreeSubDepth: 1,
    voteOptionTreeDepth: 2,
    msgBatchSize: 5, // 5^1
    processZkey: PM_LARGE_ZKEY,
    processWasm: PM_LARGE_WASM,
    processVkJson: PM_LARGE_VK,
    tallyZkey: TALLY_ZKEY,
    tallyWasm: TALLY_WASM,
    tallyVkJson: TALLY_VK_JSON,
  },
];
