/**
 * Mathematical simulation for large-scale RLA evaluation.
 *
 * Since 30+ voter E2E tests are infeasible (memory), this script
 * reproduces the _calcSampleCounts() logic off-chain to compute
 * sampling savings at scale (100–1000 voters).
 *
 * No proof generation or contract interaction required.
 *
 * Usage: npx ts-node experiments/simulate.ts
 */

// ── Constants (matching MaciRLA.sol) ──────────────────────────────────
const CONFIDENCE_X1000 = 2996; // -ln(0.05) × 1000
const MSG_TREE_ARITY = 5;
const TALLY_TREE_ARITY = 2;

// Circuit parameters
const STATE_TREE_DEPTH = 10;
const MSG_TREE_SUB_DEPTH = 1;
const INT_STATE_TREE_DEPTH = 1;

const PM_BATCH_SIZE = MSG_TREE_ARITY ** MSG_TREE_SUB_DEPTH; // 5
const TV_BATCH_SIZE = TALLY_TREE_ARITY ** INT_STATE_TREE_DEPTH; // 2

// ── _calcSampleCounts logic (mirrored from Solidity) ─────────────────

function calcSampleCounts(
  margin: number,
  totalVotes: number,
  pmBatchCount: number,
  tvBatchCount: number,
  pmBatchSize: number,
  tvBatchSize: number,
): { pmSamples: number; tvSamples: number } {
  if (totalVotes === 0) return { pmSamples: 0, tvSamples: 0 };
  if (margin === 0) return { pmSamples: pmBatchCount, tvSamples: tvBatchCount };

  const votesToFlip = Math.floor(margin / 2) + 1;

  // PM
  let pmCorrupt = Math.ceil(votesToFlip / pmBatchSize);
  if (pmCorrupt > pmBatchCount) pmCorrupt = pmBatchCount;
  let pmSamples = Math.ceil((CONFIDENCE_X1000 * pmBatchCount) / (pmCorrupt * 1000));
  if (pmSamples > pmBatchCount) pmSamples = pmBatchCount;

  // TV
  let tvCorrupt = Math.ceil(votesToFlip / tvBatchSize);
  if (tvCorrupt > tvBatchCount) tvCorrupt = tvBatchCount;
  let tvSamples = Math.ceil((CONFIDENCE_X1000 * tvBatchCount) / (tvCorrupt * 1000));
  if (tvSamples > tvBatchCount) tvSamples = tvBatchCount;

  return { pmSamples, tvSamples };
}

// ── Batch count calculation ──────────────────────────────────────────

function calcBatchCounts(
  numVoters: number,
  pmBatchSize: number,
  tvBatchSize: number,
): { pmBatchCount: number; tvBatchCount: number } {
  // numMessages = numVoters (1 message per voter)
  const numMessages = numVoters;
  const pmBatchCount = Math.ceil(numMessages / pmBatchSize);
  // TV batch count: ceil(numSignups / tvBatchSize), numSignups ≈ numVoters + 1 (coordinator)
  const numSignUps = numVoters + 1;
  const tvBatchCount = Math.ceil(numSignUps / tvBatchSize);
  return { pmBatchCount, tvBatchCount };
}

// ── Simulation ──────────────────────────────────────────────────────

interface SimResult {
  voters: number;
  yesVotes: number;
  noVotes: number;
  margin: number;
  marginPct: number;
  pmBatchCount: number;
  tvBatchCount: number;
  pmSamples: number;
  tvSamples: number;
  totalBatches: number;
  totalSamples: number;
  savingsPct: number;
}

const VOTER_COUNTS = [10, 50, 100, 200, 500, 1000];
const MARGIN_RATIOS = [
  { name: '90:10', yesRatio: 0.9 },
  { name: '80:20', yesRatio: 0.8 },
  { name: '70:30', yesRatio: 0.7 },
  { name: '60:40', yesRatio: 0.6 },
  { name: '55:45', yesRatio: 0.55 },
  { name: '51:49', yesRatio: 0.51 },
  { name: '50:50', yesRatio: 0.5 },
];

function runSimulations(): SimResult[] {
  const results: SimResult[] = [];

  for (const voterCount of VOTER_COUNTS) {
    for (const ratio of MARGIN_RATIOS) {
      const yesVotes = Math.round(voterCount * ratio.yesRatio);
      const noVotes = voterCount - yesVotes;
      const margin = Math.abs(yesVotes - noVotes);
      const marginPct = Math.round((margin / voterCount) * 100);

      const { pmBatchCount, tvBatchCount } = calcBatchCounts(
        voterCount, PM_BATCH_SIZE, TV_BATCH_SIZE
      );

      const { pmSamples, tvSamples } = calcSampleCounts(
        margin, voterCount, pmBatchCount, tvBatchCount, PM_BATCH_SIZE, TV_BATCH_SIZE
      );

      const totalBatches = pmBatchCount + tvBatchCount;
      const totalSamples = pmSamples + tvSamples;
      const savingsPct = totalBatches > 0
        ? Math.round(((totalBatches - totalSamples) / totalBatches) * 100)
        : 0;

      results.push({
        voters: voterCount,
        yesVotes,
        noVotes,
        margin,
        marginPct,
        pmBatchCount,
        tvBatchCount,
        pmSamples,
        tvSamples,
        totalBatches,
        totalSamples,
        savingsPct,
      });
    }
  }

  return results;
}

// ── Output ──────────────────────────────────────────────────────────

function printTable(results: SimResult[]) {
  const divider = '─'.repeat(110);
  console.log(`\n${'═'.repeat(110)}`);
  console.log('  MACI-RLA MATHEMATICAL SIMULATION — Sampling Savings at Scale');
  console.log(`${'═'.repeat(110)}`);
  console.log(
    `  ${'Voters'.padEnd(8)} ${'Ratio'.padEnd(8)} ${'Margin'.padEnd(8)} ${'PM Batch'.padEnd(10)} ${'PM Samp'.padEnd(10)} ${'TV Batch'.padEnd(10)} ${'TV Samp'.padEnd(10)} ${'Total'.padEnd(10)} ${'Sampled'.padEnd(10)} ${'Savings'.padEnd(8)}`
  );
  console.log(`  ${divider}`);

  let prevVoters = 0;
  for (const r of results) {
    if (r.voters !== prevVoters && prevVoters !== 0) {
      console.log(`  ${divider}`);
    }
    prevVoters = r.voters;

    console.log(
      `  ${String(r.voters).padEnd(8)} ${`${r.yesVotes}:${r.noVotes}`.padEnd(8)} ${`${r.margin} (${r.marginPct}%)`.padEnd(8)} ${String(r.pmBatchCount).padEnd(10)} ${String(r.pmSamples).padEnd(10)} ${String(r.tvBatchCount).padEnd(10)} ${String(r.tvSamples).padEnd(10)} ${String(r.totalBatches).padEnd(10)} ${String(r.totalSamples).padEnd(10)} ${`${r.savingsPct}%`.padEnd(8)}`
    );
  }
  console.log(`${'═'.repeat(110)}`);
}

function printPaperTable(results: SimResult[]) {
  console.log('\n\n=== TABLE FOR PAPER (LaTeX-friendly) ===\n');
  console.log('Voters | Margin | PM Batches | PM Samples | TV Batches | TV Samples | Savings');
  console.log('-------|--------|------------|------------|------------|------------|--------');

  // Select key rows for the paper
  const paperRows = results.filter(r =>
    (r.voters === 100 && (r.marginPct === 80 || r.marginPct === 60 || r.marginPct === 10)) ||
    (r.voters === 500 && (r.marginPct === 80 || r.marginPct === 60 || r.marginPct === 10)) ||
    (r.voters === 1000 && (r.marginPct === 80 || r.marginPct === 60 || r.marginPct === 2 || r.marginPct === 0))
  );

  for (const r of paperRows) {
    console.log(
      `${r.voters} | ${r.marginPct}% | ${r.pmBatchCount} | ${r.pmSamples} | ${r.tvBatchCount} | ${r.tvSamples} | ${r.savingsPct}%`
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────

const results = runSimulations();
printTable(results);
printPaperTable(results);

// Save results
const fs = require('fs');
const path = require('path');
const outputPath = path.join(__dirname, 'results', 'simulation-results.json');
fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`\nResults saved to: ${outputPath}`);
