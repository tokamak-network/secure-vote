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

// ============ Run ============

for (const t of tests) {
  await t();
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
