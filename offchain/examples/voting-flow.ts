/**
 * Complete voting flow example
 * Demonstrates threshold encryption for secure voting
 */

import {
  generateThresholdKey,
  encrypt,
  createDecryptionShare,
  VoteAggregator,
  createAllDecryptionShares,
} from '../src';

async function main() {
  console.log('=== Secure Voting Flow Example ===\n');

  // 1. Setup: Generate threshold key
  console.log('1. Committee generates threshold key (5 members, threshold 3)...');
  const n = 5; // total committee members
  const k = 3; // threshold (minimum needed)

  const { publicKey, shares, threshold } = generateThresholdKey(n, k);

  console.log(`   ✓ Generated ${n} shares with threshold ${threshold}`);
  console.log(`   ✓ Public key generated\n`);

  // 2. Voting: Create proposal and collect votes
  console.log('2. Voters submit encrypted votes...');

  const aggregator = new VoteAggregator();

  const voters = [
    { address: '0xAlice...', vote: 1n }, // yes
    { address: '0xBob...', vote: 0n }, // no
    { address: '0xCharlie...', vote: 1n }, // yes
    { address: '0xDave...', vote: 1n }, // yes
    { address: '0xEve...', vote: 0n }, // no
  ];

  for (const voter of voters) {
    const ciphertext = encrypt(voter.vote, publicKey);
    aggregator.addVote(voter.address, ciphertext, Date.now());

    console.log(`   ✓ ${voter.address} voted (encrypted)`);
  }

  console.log(`\n   Total votes: ${aggregator.getVotes().length}\n`);

  // 3. Vote overwrite example
  console.log('3. Alice changes her vote...');
  const newVote = encrypt(0n, publicKey); // change to "no"
  aggregator.addVote('0xAlice...', newVote, Date.now() + 1000);
  console.log('   ✓ Alice\'s vote updated (overwritten)\n');

  // 4. Off-chain decryption by committee
  console.log('4. Committee decrypts votes (off-chain)...');

  const allVotes = aggregator.getVotes();

  // Simulate committee members creating decryption shares
  // In practice, each member would do this independently
  const secretShares = [
    { memberIndex: 1, share: shares[0] },
    { memberIndex: 3, share: shares[2] },
    { memberIndex: 5, share: shares[4] },
  ];

  console.log(`   ✓ ${secretShares.length} committee members created shares`);

  const sharesMap = createAllDecryptionShares(allVotes, secretShares);

  console.log('   ✓ All votes decrypted off-chain\n');

  // 5. Aggregate and generate Merkle root
  console.log('5. Aggregating votes and generating Merkle root...');

  const decryptedVotes = aggregator.decryptVotes(sharesMap);
  const result = aggregator.tallyVotes(decryptedVotes);

  console.log(`\n   Results:`);
  console.log(`     Yes: ${result.yesVotes}`);
  console.log(`     No:  ${result.noVotes}`);
  console.log(`     Total: ${result.totalVotes}`);
  console.log(`     Merkle root: ${result.votesRoot}\n`);

  // 6. On-chain submission (simulated)
  console.log('6. Submitting to blockchain (simulated)...');
  console.log(`   submitTally(proposalId, ${result.yesVotes}, ${result.noVotes}, "${result.votesRoot}")`);
  console.log('   ✓ Tally submitted with Merkle commitment\n');

  // 7. Generate Merkle proof for one vote (for fraud proof)
  console.log('7. Generating Merkle proof for vote #2 (for disputes)...');

  const voteIndex = 2;
  const proof = aggregator.generateMerkleProof(result.votes, voteIndex);

  console.log(`   ✓ Proof generated: ${proof.length} hashes`);
  console.log(`   ✓ Anyone can verify this specific vote during challenge period\n`);

  // 8. Verify Merkle proof
  console.log('8. Verifying Merkle proof...');

  const isValid = VoteAggregator.verifyMerkleProof(
    result.votes[voteIndex],
    voteIndex,
    proof,
    result.votesRoot
  );

  console.log(`   ✓ Proof valid: ${isValid}\n`);

  console.log('=== Voting Flow Complete ===');
  console.log('\nKey benefits:');
  console.log('  • Pre-tally bribery defense: votes can be overwritten');
  console.log('  • Post-tally bribery defense: individual votes not on-chain');
  console.log('  • Trustless: fraud proof with Merkle commitment');
  console.log('  • Threshold security: requires k/n committee collusion\n');
}

main().catch(console.error);
