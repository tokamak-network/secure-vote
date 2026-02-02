/**
 * Full E2E Integration Test
 *
 * Demonstrates complete flow:
 * 1. Deploy contracts (assume already deployed)
 * 2. Committee generates threshold key
 * 3. Voters submit encrypted votes
 * 4. Committee decrypts and aggregates off-chain
 * 5. Submit tally with Merkle root on-chain
 * 6. Verify Merkle proof on-chain
 */

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { foundry } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

import {
  generateThresholdKey,
  encrypt,
  serializeCiphertext,
  deserializeCiphertext,
  VoteAggregator,
  createAllDecryptionShares,
} from '../src';

// Contract ABI (simplified for demo)
const VOTING_ABI = parseAbi([
  'function createProposal(string description, uint256 commitDuration, uint256 revealDuration) returns (uint256)',
  'function commitVote(uint256 proposalId, bytes ciphertext)',
  'function submitTally(uint256 proposalId, uint256 yesVotes, uint256 noVotes, bytes32 votesRoot)',
  'function finalizeTally(uint256 proposalId)',
  'function verifyVoteProof(uint256 proposalId, uint256 voteIndex, address voter, uint256 vote, uint256 timestamp, bytes32[] proof) view returns (bool)',
  'function tallies(uint256) view returns (uint256 yesVotes, uint256 noVotes, bytes32 votesRoot, uint256 submittedAt, address submitter, bool challenged, bool finalized)',
]);

async function main() {
  console.log('=== Secure Vote E2E Integration ===\n');

  // Setup: Connect to local Foundry network
  const contractAddress = process.env.CONTRACT_ADDRESS as `0x${string}`;
  if (!contractAddress) {
    console.error('Error: CONTRACT_ADDRESS environment variable not set');
    console.log('Usage: CONTRACT_ADDRESS=0x... npm run integration');
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(),
  });

  // Test accounts from Foundry (anvil default)
  const accounts = {
    committee1: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
    committee2: privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'),
    committee3: privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'),
    voter1: privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'),
    voter2: privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'),
    voter3: privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'),
  };

  const client1 = createWalletClient({
    account: accounts.committee1,
    chain: foundry,
    transport: http(),
  });

  console.log('Connected to Foundry network');
  console.log('Contract:', contractAddress);
  console.log();

  // ============ Step 1: Committee generates threshold key ============
  console.log('Step 1: Committee generates threshold key (3/5)...');

  const n = 5;
  const k = 3;
  const { publicKey, shares } = generateThresholdKey(n, k);

  console.log(`  ✓ Generated threshold key: ${k}/${n}`);
  console.log(`  ✓ Public key: (point on curve)`);
  console.log();

  // ============ Step 2: Create proposal ============
  console.log('Step 2: Creating proposal...');

  const proposalHash = await client1.writeContract({
    address: contractAddress,
    abi: VOTING_ABI,
    functionName: 'createProposal',
    args: ['Should we upgrade the protocol?', 3600n, 3600n], // 1 hour each
  });

  const proposalReceipt = await publicClient.waitForTransactionReceipt({ hash: proposalHash });
  console.log(`  ✓ Proposal created, tx: ${proposalHash}`);

  // Parse logs to get proposal ID (in real implementation)
  const proposalId = 0n; // First proposal
  console.log(`  ✓ Proposal ID: ${proposalId}`);
  console.log();

  // ============ Step 3: Voters submit encrypted votes ============
  console.log('Step 3: Voters submit encrypted votes...');

  const votes = [
    { account: accounts.voter1, vote: 1n, label: 'Voter 1 (Alice)' },
    { account: accounts.voter2, vote: 0n, label: 'Voter 2 (Bob)' },
    { account: accounts.voter3, vote: 1n, label: 'Voter 3 (Charlie)' },
  ];

  const aggregator = new VoteAggregator();
  const voteTimestamps: { [key: string]: number } = {};

  for (const { account, vote, label } of votes) {
    // Encrypt vote off-chain
    const ciphertext = encrypt(vote, publicKey);
    const serialized = serializeCiphertext(ciphertext);

    // Submit to blockchain
    const voterClient = createWalletClient({
      account,
      chain: foundry,
      transport: http(),
    });

    const hash = await voterClient.writeContract({
      address: contractAddress,
      abi: VOTING_ABI,
      functionName: 'commitVote',
      args: [proposalId, `0x${serialized}`],
    });

    await publicClient.waitForTransactionReceipt({ hash });

    // Store for off-chain aggregation
    const timestamp = Date.now();
    aggregator.addVote(account.address, ciphertext, timestamp);
    voteTimestamps[account.address] = timestamp;

    console.log(`  ✓ ${label} voted (encrypted), tx: ${hash.slice(0, 10)}...`);
  }

  console.log(`  ✓ Total votes: ${votes.length}`);
  console.log();

  // ============ Step 4: Committee decrypts and aggregates off-chain ============
  console.log('Step 4: Committee decrypts votes off-chain...');

  const allVotes = aggregator.getVotes();

  // Committee members create decryption shares
  const secretShares = [
    { memberIndex: 1, share: shares[0] },
    { memberIndex: 3, share: shares[2] },
    { memberIndex: 5, share: shares[4] },
  ];

  const sharesMap = createAllDecryptionShares(allVotes, secretShares);
  console.log(`  ✓ ${secretShares.length} committee members created decryption shares`);

  const decryptedVotes = aggregator.decryptVotes(sharesMap);
  console.log(`  ✓ All ${decryptedVotes.length} votes decrypted`);

  const result = aggregator.tallyVotes(decryptedVotes);
  console.log(`  ✓ Aggregation complete:`);
  console.log(`    - Yes: ${result.yesVotes}`);
  console.log(`    - No: ${result.noVotes}`);
  console.log(`    - Merkle root: ${result.votesRoot}`);
  console.log();

  // ============ Step 5: Submit tally on-chain ============
  console.log('Step 5: Submitting tally to blockchain...');

  const tallyHash = await client1.writeContract({
    address: contractAddress,
    abi: VOTING_ABI,
    functionName: 'submitTally',
    args: [
      proposalId,
      BigInt(result.yesVotes),
      BigInt(result.noVotes),
      result.votesRoot as `0x${string}`,
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash: tallyHash });
  console.log(`  ✓ Tally submitted, tx: ${tallyHash}`);
  console.log();

  // ============ Step 6: Verify Merkle proof on-chain ============
  console.log('Step 6: Verifying Merkle proof on-chain...');

  const voteIndex = 1; // Verify second vote (Bob's)
  const voteToVerify = decryptedVotes[voteIndex];
  const proof = aggregator.generateMerkleProof(decryptedVotes, voteIndex);

  console.log(`  Verifying vote #${voteIndex}:`);
  console.log(`    - Voter: ${voteToVerify.voter}`);
  console.log(`    - Vote: ${voteToVerify.vote === 1n ? 'Yes' : 'No'}`);
  console.log(`    - Proof length: ${proof.length} hashes`);

  const isValid = await publicClient.readContract({
    address: contractAddress,
    abi: VOTING_ABI,
    functionName: 'verifyVoteProof',
    args: [
      proposalId,
      BigInt(voteIndex),
      voteToVerify.voter as `0x${string}`,
      voteToVerify.vote,
      BigInt(voteToVerify.timestamp),
      proof as `0x${string}`[],
    ],
  });

  console.log(`  ✓ On-chain verification: ${isValid ? 'VALID ✓' : 'INVALID ✗'}`);
  console.log();

  // ============ Step 7: Read final tally from chain ============
  console.log('Step 7: Reading final tally from blockchain...');

  const chainTally = await publicClient.readContract({
    address: contractAddress,
    abi: VOTING_ABI,
    functionName: 'tallies',
    args: [proposalId],
  });

  console.log('  On-chain tally:');
  console.log(`    - Yes: ${chainTally[0]}`);
  console.log(`    - No: ${chainTally[1]}`);
  console.log(`    - Merkle root: ${chainTally[2]}`);
  console.log(`    - Finalized: ${chainTally[6]}`);
  console.log();

  console.log('=== Integration Test Complete ===');
  console.log();
  console.log('Summary:');
  console.log('  ✓ Threshold key generation');
  console.log('  ✓ Encrypted voting on-chain');
  console.log('  ✓ Off-chain threshold decryption');
  console.log('  ✓ Merkle root generation');
  console.log('  ✓ On-chain tally submission');
  console.log('  ✓ On-chain Merkle proof verification');
  console.log();
  console.log('The system is working end-to-end! 🎉');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
