// Test proof generation with Node.js
import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';
import fs from 'fs';
import path from 'path';

const projectRoot = path.dirname(path.dirname(import.meta.url.replace('file://', '')));
const wasmPath = path.join(projectRoot, 'circuits/build/SingleMessageProcessor_js/SingleMessageProcessor.wasm');
const zkeyPath = path.join(projectRoot, 'circuits/build/circuit_final.zkey');
const vkeyPath = path.join(projectRoot, 'circuits/build/verification_key.json');

console.log('Checking artifacts...');
console.log('WASM exists:', fs.existsSync(wasmPath));
console.log('zkey exists:', fs.existsSync(zkeyPath));
console.log('vkey exists:', fs.existsSync(vkeyPath));

// Build Poseidon
console.log('\nInitializing Poseidon...');
const poseidon = await buildPoseidon();
const F = poseidon.F;

function poseidonHash(inputs) {
  return F.toObject(poseidon(inputs.map(x => F.e(x))));
}

function poseidonHash2(a, b) {
  return poseidonHash([a, b]);
}

function poseidonHash4(a, b, c, d) {
  return poseidonHash([a, b, c, d]);
}

const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const TREE_DEPTH = 20;

console.log('\nConstructing witness...');

// Coordinator key
const coordPrivKey = 12345n;
const coordPubKeyX = poseidonHash([coordPrivKey]);
const coordPubKeyY = coordPubKeyX;

// Voter public key
const voterPubKeyX = 11111n;
const voterPubKeyY = 22222n;

// Ephemeral key
const ephemeralPubKeyX = 33333n;
const ephemeralPubKeyY = 44444n;

// Shared secret
const sharedSecret = poseidonHash([coordPrivKey, ephemeralPubKeyX, ephemeralPubKeyY]);

// Vote and nonce
const vote = 1n;
const nonce = 1n;
const previousVote = 0n;
const previousNonce = 0n;

// Encrypted data
const encData = [];
for (let i = 0; i < 4; i++) {
  const keyStream = poseidonHash2(sharedSecret, BigInt(i));
  const plaintext = i === 0 ? vote : i === 1 ? nonce : 0n;
  const ct = (plaintext + keyStream) % SNARK_SCALAR_FIELD;
  encData.push(ct.toString());
}

// Leaf hashes
const oldLeaf = poseidonHash4(voterPubKeyX, voterPubKeyY, previousVote, previousNonce);
const newLeaf = poseidonHash4(voterPubKeyX, voterPubKeyY, vote, nonce);

// Merkle tree
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

const input = {
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

console.log('Witness ready.');
console.log('\nGenerating proof (this may take several minutes)...');
const start = Date.now();

try {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  const elapsed = Date.now() - start;
  console.log(`\n✓ Proof generated in ${elapsed}ms (${(elapsed/1000).toFixed(1)}s)`);

  console.log('\nVerifying proof...');
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
  const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  console.log('Proof valid:', isValid);

  // Save proof
  const fixtureDir = path.join(projectRoot, 'test/fixtures');
  if (!fs.existsSync(fixtureDir)) {
    fs.mkdirSync(fixtureDir, { recursive: true });
  }

  // Format calldata for Solidity
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
  fs.writeFileSync(path.join(fixtureDir, 'real-proof.json'), JSON.stringify(fixture, null, 2));
  console.log('\n✓ Proof saved to test/fixtures/real-proof.json');

} catch (e) {
  const elapsed = Date.now() - start;
  console.log(`\n✗ Error after ${elapsed}ms:`, e.message);
  process.exit(1);
}
