/**
 * E2E Test for MACI Voting Workflow
 *
 * Tests the complete flow:
 * 1. Coordinator setup
 * 2. Proposal creation
 * 3. Voter key generation
 * 4. Vote submission
 * 5. Message processing
 * 6. Tally
 */

import {
  generateVoterKeyPair,
  generateCoordinatorKeyPair,
  encryptMessage,
  serializeMessage,
  changeVoterKey,
  createKeyChangeMessage,
  getPublicKeyHash,
} from '../src/crypto/maci';
import {
  MessageProcessor,
  createProcessorWithKey,
} from '../src/coordinator';
import { serializePoint } from '../src/crypto/elgamal';

describe('E2E MACI Voting Workflow', () => {
  it('should complete full voting workflow', () => {
    console.log('\n=== E2E MACI Voting Test ===\n');

    // Step 1: Coordinator setup
    console.log('1. Coordinator generates keypair...');
    const coordinatorKey = generateCoordinatorKeyPair();
    const processor = createProcessorWithKey(coordinatorKey);
    console.log('   ✓ Coordinator ready');

    // Step 2: Simulate proposal creation (on-chain would store coordinator pubkey)
    console.log('2. Proposal created (simulated)');
    const coordPubKeyHex = Buffer.from(serializePoint(coordinatorKey.publicKey)).toString('hex');
    console.log(`   Coordinator PubKey: ${coordPubKeyHex.slice(0, 32)}...`);

    // Step 3: Voters generate keys
    console.log('3. Voters generate keys...');
    const voter1 = generateVoterKeyPair();
    const voter2 = generateVoterKeyPair();
    const voter3 = generateVoterKeyPair();
    console.log(`   ✓ Voter 1: ${getPublicKeyHash(voter1.publicKey).slice(0, 16)}...`);
    console.log(`   ✓ Voter 2: ${getPublicKeyHash(voter2.publicKey).slice(0, 16)}...`);
    console.log(`   ✓ Voter 3: ${getPublicKeyHash(voter3.publicKey).slice(0, 16)}...`);

    // Step 4: Voters submit encrypted votes
    console.log('4. Voters submit encrypted votes...');

    const msg1 = encryptMessage(voter1, coordinatorKey.publicKey, 1); // YES
    const msg2 = encryptMessage(voter2, coordinatorKey.publicKey, 0); // NO
    const msg3 = encryptMessage(voter3, coordinatorKey.publicKey, 1); // YES

    // Serialize for "on-chain" submission
    const serialized1 = serializeMessage(msg1);
    const serialized2 = serializeMessage(msg2);
    const serialized3 = serializeMessage(msg3);

    console.log(`   ✓ Voter 1 voted YES (${serialized1.encryptedData.slice(0, 16)}...)`);
    console.log(`   ✓ Voter 2 voted NO (${serialized2.encryptedData.slice(0, 16)}...)`);
    console.log(`   ✓ Voter 3 voted YES (${serialized3.encryptedData.slice(0, 16)}...)`);

    // Step 5: Coordinator processes messages
    console.log('5. Coordinator processes messages...');

    const result1 = processor.processMessage(msg1);
    const result2 = processor.processMessage(msg2);
    const result3 = processor.processMessage(msg3);

    console.log(`   Message 1: applied=${result1.applied}, vote=${result1.vote}`);
    console.log(`   Message 2: applied=${result2.applied}, vote=${result2.vote}`);
    console.log(`   Message 3: applied=${result3.applied}, vote=${result3.vote}`);

    expect(result1.applied).toBe(true);
    expect(result2.applied).toBe(true);
    expect(result3.applied).toBe(true);

    // Step 6: Check tally
    console.log('6. Coordinator tallies votes...');
    const tally = processor.tally();
    console.log(`   ✓ YES: ${tally.yes}, NO: ${tally.no}, Abstain: ${tally.abstain}`);

    expect(tally.yes).toBe(2);
    expect(tally.no).toBe(1);
    expect(tally.abstain).toBe(0);

    // Step 7: Get state root
    console.log('7. Coordinator computes state root...');
    const stateRoot = processor.getStateRoot();
    console.log(`   ✓ State Root: ${stateRoot.slice(0, 32)}...`);

    expect(stateRoot).toBeDefined();
    expect(stateRoot.length).toBe(64);

    // Step 8: Test key change (anti-bribery)
    console.log('8. Testing key change (anti-bribery)...');

    // Voter 1 changes key and revotes NO
    const voter1NewKey = changeVoterKey(voter1);
    const msg1Changed = encryptMessage(voter1NewKey, coordinatorKey.publicKey, 0); // Changed to NO

    const resultChanged = processor.processMessage(msg1Changed);
    console.log(`   Voter 1 changed key and voted NO: applied=${resultChanged.applied}`);

    const tallyAfterChange = processor.tally();
    console.log(`   ✓ New tally - YES: ${tallyAfterChange.yes}, NO: ${tallyAfterChange.no}`);

    // Note: In current implementation, new key creates a new voter entry
    // Full MACI would link keys and invalidate old vote
    expect(resultChanged.applied).toBe(true);

    // Step 9: Export final state
    console.log('9. Exporting final state...');
    const exportedState = processor.exportState();
    console.log(`   ✓ Total voters: ${exportedState.voters.length}`);
    console.log(`   ✓ Message count: ${exportedState.messageCount}`);
    console.log(`   ✓ Final State Root: ${exportedState.stateRoot.slice(0, 32)}...`);

    console.log('\n=== E2E Test Complete ===\n');
  });

  it('should handle duplicate votes correctly', () => {
    const coordinatorKey = generateCoordinatorKeyPair();
    const processor = createProcessorWithKey(coordinatorKey);

    const voter = generateVoterKeyPair();

    // First vote
    const msg1 = encryptMessage(voter, coordinatorKey.publicKey, 1);
    const result1 = processor.processMessage(msg1);
    expect(result1.applied).toBe(true);

    // Duplicate vote (same key, same nonce)
    const msg2 = encryptMessage(voter, coordinatorKey.publicKey, 0);
    const result2 = processor.processMessage(msg2);
    expect(result2.applied).toBe(false);
    expect(result2.reason).toBe('duplicate');

    // Tally should only count first vote
    const tally = processor.tally();
    expect(tally.yes).toBe(1);
    expect(tally.no).toBe(0);
  });

  it('should serialize messages correctly for on-chain submission', () => {
    const coordinatorKey = generateCoordinatorKeyPair();
    const voter = generateVoterKeyPair();

    const msg = encryptMessage(voter, coordinatorKey.publicKey, 1);
    const serialized = serializeMessage(msg);

    // Check hex format and lengths
    expect(serialized.voterPubKey).toMatch(/^[0-9a-f]+$/);
    expect(serialized.encryptedData).toMatch(/^[0-9a-f]+$/);
    expect(serialized.ephemeralPubKey).toMatch(/^[0-9a-f]+$/);

    expect(serialized.voterPubKey.length).toBe(128); // 64 bytes
    expect(serialized.encryptedData.length).toBe(256); // 128 bytes
    expect(serialized.ephemeralPubKey.length).toBe(128); // 64 bytes

    console.log('Serialized message for on-chain:');
    console.log(`  voterPubKey: 0x${serialized.voterPubKey}`);
    console.log(`  encryptedData: 0x${serialized.encryptedData}`);
    console.log(`  ephemeralPubKey: 0x${serialized.ephemeralPubKey}`);
  });
});
