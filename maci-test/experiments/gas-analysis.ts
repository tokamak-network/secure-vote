/**
 * Gas cost analysis for MACI-RLA vs Full MACI verification.
 *
 * Reads benchmark results from 10-voter tests to extract per-proof gas costs,
 * then extrapolates to larger voter counts using the simulation data.
 *
 * Usage: npx ts-node experiments/gas-analysis.ts
 */
import * as fs from 'fs';
import * as path from 'path';

// ── Constants (matching simulate.ts) ─────────────────────────────────
const CONFIDENCE_X1000 = 2996;
const PM_BATCH_SIZE = 5;
const TV_BATCH_SIZE = 2;

// ── Load benchmark data ──────────────────────────────────────────────

interface BenchmarkData {
  name: string;
  gasUsed: Record<string, string>;
  proofCounts: {
    processMessages: number;
    tallyVotes: number;
    total: number;
  };
}

function loadBenchmarkData(): BenchmarkData | null {
  const benchPath = path.resolve(__dirname, '..', 'benchmark-results-10-vote.json');
  if (!fs.existsSync(benchPath)) {
    console.log(`Benchmark file not found: ${benchPath}`);
    console.log('Run: pnpm test:bench:10 first to generate benchmark data.');
    return null;
  }
  return JSON.parse(fs.readFileSync(benchPath, 'utf8'));
}

// ── Gas cost model ───────────────────────────────────────────────────

interface GasModel {
  // Per-proof gas
  pmProofGas: bigint;
  tvProofGas: bigint;
  // Fixed costs (per-election)
  deployPollGas: bigint;
  signUpPerVoterGas: bigint;
  publishPerVoteGas: bigint;
  mergeGas: bigint;
  submitResultsGas: bigint;
  // MaciRLA-specific fixed costs (estimated)
  commitGas: bigint;
  revealGas: bigint;
  finalizeSamplingGas: bigint;
  finalizeGas: bigint;
}

function buildGasModel(bench: BenchmarkData): GasModel {
  const gas = bench.gasUsed;
  const pmCount = bench.proofCounts.processMessages;
  const tvCount = bench.proofCounts.tallyVotes;

  return {
    pmProofGas: BigInt(gas.mpVerify_avg || '500000'),
    tvProofGas: BigInt(gas.tvVerify_avg || '500000'),
    deployPollGas: BigInt(gas.deployPoll || '3000000'),
    signUpPerVoterGas: BigInt(gas.signUp_avg || '200000'),
    publishPerVoteGas: BigInt(gas.publish_avg || '300000'),
    mergeGas: BigInt(gas.merge_total || '2000000'),
    submitResultsGas: BigInt(gas.submitResults || '200000'),
    // MaciRLA operations (estimates — actual values from rla-e2e would be better)
    commitGas: 500_000n,
    revealGas: 200_000n,
    finalizeSamplingGas: 100_000n,
    finalizeGas: 100_000n,
  };
}

// ── Sample count calculation (same as simulate.ts) ───────────────────

function calcSampleCounts(
  margin: number,
  totalVotes: number,
  pmBatchCount: number,
  tvBatchCount: number,
): { pmSamples: number; tvSamples: number } {
  if (totalVotes === 0) return { pmSamples: 0, tvSamples: 0 };
  if (margin === 0) return { pmSamples: pmBatchCount, tvSamples: tvBatchCount };

  const votesToFlip = Math.floor(margin / 2) + 1;

  // PM: Sequential dependency requires full verification.
  const pmSamples = pmBatchCount;

  // TV: Independent batches — RLA sampling is safe.
  const tvMaxSamples = tvBatchCount > 1 ? tvBatchCount - 1 : tvBatchCount;
  let tvCorrupt = Math.ceil(votesToFlip / TV_BATCH_SIZE);
  if (tvCorrupt > tvBatchCount) tvCorrupt = tvBatchCount;
  let tvSamples = Math.ceil((CONFIDENCE_X1000 * tvBatchCount) / (tvCorrupt * 1000));
  if (tvSamples > tvMaxSamples) tvSamples = tvMaxSamples;

  return { pmSamples, tvSamples };
}

// ── Gas comparison ───────────────────────────────────────────────────

interface GasComparison {
  voters: number;
  marginPct: number;
  pmBatches: number;
  tvBatches: number;
  pmSamples: number;
  tvSamples: number;
  fullMaciGas: bigint;
  maciRlaGas: bigint;
  savingsGas: bigint;
  savingsPct: number;
}

function computeGasComparison(
  model: GasModel,
  voters: number,
  marginPct: number,
): GasComparison {
  const yesVotes = Math.round(voters * (0.5 + marginPct / 200));
  const noVotes = voters - yesVotes;
  const margin = Math.abs(yesVotes - noVotes);

  const numMessages = voters;
  const pmBatches = Math.ceil(numMessages / PM_BATCH_SIZE);
  const numSignUps = voters + 1;
  const tvBatches = Math.ceil(numSignUps / TV_BATCH_SIZE);

  const { pmSamples, tvSamples } = calcSampleCounts(margin, voters, pmBatches, tvBatches);

  // Full MACI: verify ALL batches
  const fullVerifyGas =
    model.pmProofGas * BigInt(pmBatches) +
    model.tvProofGas * BigInt(tvBatches) +
    model.submitResultsGas;

  // MaciRLA: verify only sampled batches + RLA overhead
  const rlaVerifyGas =
    model.pmProofGas * BigInt(pmSamples) +
    model.tvProofGas * BigInt(tvSamples) +
    model.commitGas +
    model.revealGas +
    model.finalizeSamplingGas +
    model.finalizeGas;

  const savingsGas = fullVerifyGas > rlaVerifyGas ? fullVerifyGas - rlaVerifyGas : 0n;
  const savingsPct = fullVerifyGas > 0n
    ? Number((savingsGas * 100n) / fullVerifyGas)
    : 0;

  return {
    voters,
    marginPct,
    pmBatches,
    tvBatches,
    pmSamples,
    tvSamples,
    fullMaciGas: fullVerifyGas,
    maciRlaGas: rlaVerifyGas,
    savingsGas,
    savingsPct,
  };
}

function formatGas(gas: bigint): string {
  if (gas > 1_000_000n) return `${(Number(gas) / 1_000_000).toFixed(2)}M`;
  if (gas > 1_000n) return `${(Number(gas) / 1_000).toFixed(1)}K`;
  return gas.toString();
}

// ── Main ─────────────────────────────────────────────────────────────

const bench = loadBenchmarkData();

if (bench) {
  const model = buildGasModel(bench);

  console.log('\n=== GAS MODEL (from 10-voter benchmark) ===');
  console.log(`  PM proof gas (avg): ${formatGas(model.pmProofGas)}`);
  console.log(`  TV proof gas (avg): ${formatGas(model.tvProofGas)}`);
  console.log(`  Deploy Poll gas:    ${formatGas(model.deployPollGas)}`);
  console.log(`  SignUp per voter:   ${formatGas(model.signUpPerVoterGas)}`);
  console.log(`  Publish per vote:   ${formatGas(model.publishPerVoteGas)}`);

  const VOTER_COUNTS = [10, 50, 100, 200, 500, 1000];
  const MARGIN_PCTS = [80, 60, 20, 10, 2, 0];

  const results: GasComparison[] = [];
  for (const voters of VOTER_COUNTS) {
    for (const marginPct of MARGIN_PCTS) {
      results.push(computeGasComparison(model, voters, marginPct));
    }
  }

  // Print comparison table
  const divider = '─'.repeat(100);
  console.log(`\n${'═'.repeat(100)}`);
  console.log('  FULL MACI vs MaciRLA — GAS COMPARISON');
  console.log(`${'═'.repeat(100)}`);
  console.log(
    `  ${'Voters'.padEnd(8)} ${'Margin'.padEnd(8)} ${'PM S/B'.padEnd(10)} ${'TV S/B'.padEnd(10)} ${'Full MACI'.padEnd(12)} ${'MaciRLA'.padEnd(12)} ${'Savings'.padEnd(12)} ${'%'.padEnd(6)}`
  );
  console.log(`  ${divider}`);

  let prevVoters = 0;
  for (const r of results) {
    if (r.voters !== prevVoters && prevVoters !== 0) {
      console.log(`  ${divider}`);
    }
    prevVoters = r.voters;

    console.log(
      `  ${String(r.voters).padEnd(8)} ${`${r.marginPct}%`.padEnd(8)} ${`${r.pmSamples}/${r.pmBatches}`.padEnd(10)} ${`${r.tvSamples}/${r.tvBatches}`.padEnd(10)} ${formatGas(r.fullMaciGas).padEnd(12)} ${formatGas(r.maciRlaGas).padEnd(12)} ${formatGas(r.savingsGas).padEnd(12)} ${`${r.savingsPct}%`.padEnd(6)}`
    );
  }
  console.log(`${'═'.repeat(100)}`);

  // Save results
  const outputPath = path.join(__dirname, 'results', 'gas-analysis-results.json');
  const serializable = results.map(r => ({
    ...r,
    fullMaciGas: r.fullMaciGas.toString(),
    maciRlaGas: r.maciRlaGas.toString(),
    savingsGas: r.savingsGas.toString(),
  }));
  fs.writeFileSync(outputPath, JSON.stringify(serializable, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);
} else {
  // Fallback: run with estimated gas values
  console.log('\nRunning with estimated gas values...');
  const defaultModel: GasModel = {
    pmProofGas: 500_000n,
    tvProofGas: 450_000n,
    deployPollGas: 3_000_000n,
    signUpPerVoterGas: 200_000n,
    publishPerVoteGas: 300_000n,
    mergeGas: 2_000_000n,
    submitResultsGas: 200_000n,
    commitGas: 500_000n,
    revealGas: 200_000n,
    finalizeSamplingGas: 100_000n,
    finalizeGas: 100_000n,
  };

  const VOTER_COUNTS = [100, 500, 1000];
  const MARGIN_PCTS = [80, 60, 10, 2];

  console.log('\nVoters | Margin | Full MACI Gas | MaciRLA Gas | Savings');
  console.log('-------|--------|---------------|-------------|--------');

  for (const voters of VOTER_COUNTS) {
    for (const marginPct of MARGIN_PCTS) {
      const r = computeGasComparison(defaultModel, voters, marginPct);
      console.log(
        `${r.voters} | ${r.marginPct}% | ${formatGas(r.fullMaciGas)} | ${formatGas(r.maciRlaGas)} | ${r.savingsPct}%`
      );
    }
  }
}
