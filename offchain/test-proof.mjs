/**
 * ZKP Proof Generation & Verification Tests (Node.js)
 *
 * snarkjs requires Node.js worker threads (incompatible with Bun).
 * This script runs real Groth16 proof tests:
 *   1. Witness construction with Poseidon hashes
 *   2. Proof generation via snarkjs
 *   3. Off-chain verification (valid proof accepted)
 *   4. Tampered proof rejected
 *   5. Fixture saved for Solidity tests
 *
 * Usage: node test-proof.mjs
 */

import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const wasmPath = path.join(projectRoot, 'circuits/build/SingleMessageProcessor_js/SingleMessageProcessor.wasm');
const zkeyPath = path.join(projectRoot, 'circuits/build/circuit_final.zkey');
const vkeyPath = path.join(projectRoot, 'circuits/build/verification_key.json');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return async () => {
    try {
      await fn();
      passed++;
      console.log(`  PASS  ${name}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${e.message}`);
    }
  };
}

// ============ Check prerequisites ============

console.log('\n=== ZKP Proof Tests (Node.js) ===\n');

if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath) || !fs.existsSync(vkeyPath)) {
  console.log('SKIP: Circuit not compiled. Run scripts/compile-circuit.sh first.');
  console.log('  Missing:', [
    !fs.existsSync(wasmPath) && 'WASM',
    !fs.existsSync(zkeyPath) && 'zkey',
    !fs.existsSync(vkeyPath) && 'vkey',
  ].filter(Boolean).join(', '));
  process.exit(0);
}

// ============ Setup ============

const poseidon = await buildPoseidon();
const F = poseidon.F;

function poseidonHash(inputs) {
  return F.toObject(poseidon(inputs.map(x => F.e(x))));
}
function poseidonHash2(a, b) { return poseidonHash([a, b]); }
function poseidonHash4(a, b, c, d) { return poseidonHash([a, b, c, d]); }

const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const TREE_DEPTH = 20;

// ============ Construct witness ============

const coordPrivKey = 12345n;
const coordPubKeyX = poseidonHash([coordPrivKey]);
const coordPubKeyY = coordPubKeyX;

const voterPubKeyX = 11111n;
const voterPubKeyY = 22222n;
const ephemeralPubKeyX = 33333n;
const ephemeralPubKeyY = 44444n;

const sharedSecret = poseidonHash([coordPrivKey, ephemeralPubKeyX, ephemeralPubKeyY]);

const vote = 1n;
const nonce = 1n;
const previousVote = 0n;
const previousNonce = 0n;

const encData = [];
for (let i = 0; i < 4; i++) {
  const keyStream = poseidonHash2(sharedSecret, BigInt(i));
  const plaintext = i === 0 ? vote : i === 1 ? nonce : 0n;
  encData.push(((plaintext + keyStream) % SNARK_SCALAR_FIELD).toString());
}

const oldLeaf = poseidonHash4(voterPubKeyX, voterPubKeyY, previousVote, previousNonce);
const newLeaf = poseidonHash4(voterPubKeyX, voterPubKeyY, vote, nonce);

const siblings = [];
const pathIndices = [];
let currentOld = oldLeaf;
let currentNew = newLeaf;

for (let i = 0; i < TREE_DEPTH; i++) {
  siblings.push('0');
  pathIndices.push(0);
  currentOld = poseidonHash2(currentOld, 0n);
  currentNew = poseidonHash2(currentNew, 0n);
}

const witnessInput = {
  prevStateRoot: currentOld.toString(),
  newStateRoot: currentNew.toString(),
  encryptedVoterPubKeyX: voterPubKeyX.toString(),
  encryptedVoterPubKeyY: voterPubKeyY.toString(),
  encryptedData: encData,
  ephemeralPubKeyX: ephemeralPubKeyX.toString(),
  ephemeralPubKeyY: ephemeralPubKeyY.toString(),
  messageIndex: '0',
  coordinatorPubKeyX: coordPubKeyX.toString(),
  coordinatorPubKeyY: coordPubKeyY.toString(),
  coordinatorPrivKey: coordPrivKey.toString(),
  decryptedVote: vote.toString(),
  decryptedNonce: nonce.toString(),
  voterPubKeyX: voterPubKeyX.toString(),
  voterPubKeyY: voterPubKeyY.toString(),
  previousVoterNonce: previousNonce.toString(),
  previousVoterVote: previousVote.toString(),
  pathIndices,
  siblings,
};

// ============ Generate proof once, use in all tests ============

console.log('Generating Groth16 proof...');
const startTime = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(witnessInput, wasmPath, zkeyPath);
const proofTime = Date.now() - startTime;
console.log(`Proof generated in ${proofTime}ms\n`);

const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));

// ============ Tests ============

const tests = [];

tests.push(test('generates valid Groth16 proof', async () => {
  assert.ok(proof, 'proof should exist');
  assert.ok(proof.pi_a, 'proof should have pi_a');
  assert.ok(proof.pi_b, 'proof should have pi_b');
  assert.ok(proof.pi_c, 'proof should have pi_c');
  assert.equal(proof.protocol, 'groth16');
  assert.equal(proof.curve, 'bn128');
}));

tests.push(test('has 13 public signals', async () => {
  assert.equal(publicSignals.length, 13);
}));

tests.push(test('verifies valid proof off-chain', async () => {
  const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  assert.equal(isValid, true, 'valid proof should verify');
}));

tests.push(test('rejects tampered public signals', async () => {
  const tampered = [...publicSignals];
  tampered[1] = '999'; // change newStateRoot
  const isValid = await snarkjs.groth16.verify(vkey, tampered, proof);
  assert.equal(isValid, false, 'tampered signals should fail verification');
}));

tests.push(test('rejects tampered proof point', async () => {
  const tamperedProof = JSON.parse(JSON.stringify(proof));
  tamperedProof.pi_a[0] = '123456789'; // change pi_a
  const isValid = await snarkjs.groth16.verify(vkey, publicSignals, tamperedProof);
  assert.equal(isValid, false, 'tampered proof should fail verification');
}));

tests.push(test('saves proof fixture for Solidity tests', async () => {
  const fixtureDir = path.join(projectRoot, 'test/fixtures');
  if (!fs.existsSync(fixtureDir)) {
    fs.mkdirSync(fixtureDir, { recursive: true });
  }

  const calldata = {
    pA: [proof.pi_a[0], proof.pi_a[1]],
    pB: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    pC: [proof.pi_c[0], proof.pi_c[1]],
    pubSignals: publicSignals,
  };

  const fixture = { proof, publicSignals, calldata };
  const fixturePath = path.join(fixtureDir, 'real-proof.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));

  assert.ok(fs.existsSync(fixturePath), 'fixture file should be written');
  const loaded = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(loaded.publicSignals.length, 13);
  assert.deepEqual(loaded.calldata.pB[0][0], proof.pi_b[0][1], 'pB should be reversed for Solidity');
}));

// ============ Coordinator-based N-vote proof tests ============

// Import coordinator modules from CJS dist build
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  createProcessorWithKey,
  generateCoordinatorKeyPair,
  generateVoterKeyPair,
  encryptMessage,
} = require('./dist/index.js');

console.log('--- Coordinator Pipeline Tests ---\n');

// Scenario 1: 3 voters sequential voting
console.log('Generating coordinator key and processing 3 votes...');
const coordKey = generateCoordinatorKeyPair();
const processor = await createProcessorWithKey(coordKey);

const voters = [
  generateVoterKeyPair(1),  // nonce=1 (vote=Yes)
  generateVoterKeyPair(1),  // nonce=1 (vote=No)
  generateVoterKeyPair(1),  // nonce=1 (vote=Yes)
];
const voteValues = [1, 0, 1];

// Pre-register all voters (creates zero-state leaves in the Merkle tree)
await processor.preRegisterVoters(voters.map(v => v.publicKey));

// Process each message and immediately capture witness
const witnessInputs = [];
for (let i = 0; i < voters.length; i++) {
  const encrypted = encryptMessage(voters[i], coordKey.publicKey, voteValues[i]);
  const result = await processor.processMessage(encrypted);
  assert.ok(result.applied, `vote ${i} should be applied`);

  // Capture witness IMMEDIATELY after processMessage (before next message changes the tree)
  const wit = await processor.generateWitnessInput(i);
  witnessInputs.push(wit);
}

// Generate proofs for all 3 witnesses
const proofs3 = [];
const signals3 = [];
console.log('Generating 3 Groth16 proofs from coordinator pipeline...');
const start3 = Date.now();
for (let i = 0; i < witnessInputs.length; i++) {
  const { proof: p, publicSignals: ps } = await snarkjs.groth16.fullProve(witnessInputs[i], wasmPath, zkeyPath);
  proofs3.push(p);
  signals3.push(ps);
  if (global.gc) global.gc();
}
console.log(`3 proofs generated in ${Date.now() - start3}ms\n`);

tests.push(test('[3-voter] all proofs verify off-chain', async () => {
  for (let i = 0; i < proofs3.length; i++) {
    const valid = await snarkjs.groth16.verify(vkey, signals3[i], proofs3[i]);
    assert.equal(valid, true, `proof ${i} should verify`);
  }
}));

tests.push(test('[3-voter] state root chaining: proof[i].newStateRoot === proof[i+1].prevStateRoot', async () => {
  // publicSignals[0] = prevStateRoot, publicSignals[1] = newStateRoot
  for (let i = 0; i < signals3.length - 1; i++) {
    assert.equal(
      signals3[i][1],   // newStateRoot of proof i
      signals3[i + 1][0], // prevStateRoot of proof i+1
      `chain break at ${i}->${i + 1}`
    );
  }
}));

tests.push(test('[3-voter] non-zero siblings exist after first voter', async () => {
  // First voter gets zero siblings (empty tree), but 2nd and 3rd should have non-zero siblings
  const hasNonZeroSiblings = witnessInputs[2].siblings.some(s => s !== '0');
  assert.ok(hasNonZeroSiblings, 'voter 2 should have non-zero Merkle siblings');
}));

// Scenario 2: Vote update (re-vote)
console.log('Processing vote update (re-vote) scenario...');
const coordKey2 = generateCoordinatorKeyPair();
const processor2 = await createProcessorWithKey(coordKey2);

// First vote: nonce=1, Yes
const reVoter = generateVoterKeyPair(1);
await processor2.preRegisterVoters([reVoter.publicKey]);
const enc1 = encryptMessage(reVoter, coordKey2.publicKey, 1);
const res1 = await processor2.processMessage(enc1);
assert.ok(res1.applied, 'initial vote should be applied');
const wit1 = await processor2.generateWitnessInput(0);

// Re-vote: same voter, nonce=2, No
const reVoterUpdated = { ...reVoter, nonce: 2 };
const enc2 = encryptMessage(reVoterUpdated, coordKey2.publicKey, 0);
const res2 = await processor2.processMessage(enc2);
assert.ok(res2.applied, 're-vote should be applied');
const wit2 = await processor2.generateWitnessInput(1);

// Generate proofs
console.log('Generating 2 Groth16 proofs for re-vote scenario...');
const startRe = Date.now();
const { proof: rp1, publicSignals: rs1 } = await snarkjs.groth16.fullProve(wit1, wasmPath, zkeyPath);
if (global.gc) global.gc();
const { proof: rp2, publicSignals: rs2 } = await snarkjs.groth16.fullProve(wit2, wasmPath, zkeyPath);
if (global.gc) global.gc();
console.log(`2 re-vote proofs generated in ${Date.now() - startRe}ms\n`);

tests.push(test('[re-vote] initial vote proof verifies', async () => {
  const valid = await snarkjs.groth16.verify(vkey, rs1, rp1);
  assert.equal(valid, true, 'initial vote proof should verify');
}));

tests.push(test('[re-vote] updated vote proof verifies', async () => {
  const valid = await snarkjs.groth16.verify(vkey, rs2, rp2);
  assert.equal(valid, true, 're-vote proof should verify');
}));

tests.push(test('[re-vote] state root chaining holds', async () => {
  assert.equal(rs1[1], rs2[0], 'newStateRoot of vote1 should equal prevStateRoot of vote2');
}));

tests.push(test('[re-vote] state roots differ (vote changed)', async () => {
  assert.notEqual(rs1[1], rs2[1], 'newStateRoots should differ after vote update');
}));

// ============ Run ============

for (const t of tests) {
  await t();
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
