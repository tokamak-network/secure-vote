import {
  generateKeyPair,
  encrypt,
  decryptMessage,
  serializeCiphertext,
  deserializeCiphertext,
} from '../src/crypto/elgamal';

import {
  splitSecret,
  reconstructSecret,
} from '../src/crypto/shamir';

import {
  generateThresholdKey,
  createDecryptionShare,
  thresholdDecrypt,
} from '../src/crypto/dkg';

import { VoteAggregator, createAllDecryptionShares } from '../src/aggregator';

describe('ElGamal Encryption', () => {
  test('encrypt and decrypt message', () => {
    const { publicKey, secretKey } = generateKeyPair();

    const message = 1n; // vote = yes
    const ciphertext = encrypt(message, publicKey);

    const decrypted = decryptMessage(ciphertext, secretKey);

    expect(decrypted).toBe(message);
  });

  test('serialize and deserialize ciphertext', () => {
    const { publicKey } = generateKeyPair();
    const ciphertext = encrypt(5n, publicKey);

    const serialized = serializeCiphertext(ciphertext);
    const deserialized = deserializeCiphertext(serialized);

    expect(deserialized.c1.equals(ciphertext.c1)).toBe(true);
    expect(deserialized.c2.equals(ciphertext.c2)).toBe(true);
  });
});

describe('Shamir Secret Sharing', () => {
  test('split and reconstruct secret (3/5)', () => {
    const secret = 12345n;
    const n = 5;
    const k = 3;

    const shares = splitSecret(secret, n, k);
    expect(shares.length).toBe(n);

    // Use any 3 shares
    const selectedShares = [shares[0], shares[2], shares[4]];
    const reconstructed = reconstructSecret(selectedShares);

    expect(reconstructed).toBe(secret);
  });

  test('reconstruct with different combinations', () => {
    const secret = 99999n;
    const shares = splitSecret(secret, 5, 3);

    // Try different combinations
    const combo1 = reconstructSecret([shares[0], shares[1], shares[2]]);
    const combo2 = reconstructSecret([shares[1], shares[3], shares[4]]);
    const combo3 = reconstructSecret([shares[0], shares[2], shares[4]]);

    expect(combo1).toBe(secret);
    expect(combo2).toBe(secret);
    expect(combo3).toBe(secret);
  });

  test('fail with insufficient shares', () => {
    const secret = 42n;
    const shares = splitSecret(secret, 5, 3);

    // Only 2 shares (less than threshold)
    const reconstructed = reconstructSecret([shares[0], shares[1]]);

    // Should not match secret
    expect(reconstructed).not.toBe(secret);
  });
});

describe('Threshold Encryption (DKG)', () => {
  test('generate threshold key and decrypt', () => {
    const n = 5;
    const k = 3;

    // Generate threshold key
    const { publicKey, shares } = generateThresholdKey(n, k);

    // Encrypt message
    const message = 1n;
    const ciphertext = encrypt(message, publicKey);

    // Create decryption shares (simulate k committee members)
    const decryptionShares = [
      createDecryptionShare(ciphertext, shares[0], 1),
      createDecryptionShare(ciphertext, shares[2], 3),
      createDecryptionShare(ciphertext, shares[4], 5),
    ];

    // Threshold decrypt
    const decrypted = thresholdDecrypt(ciphertext, decryptionShares);

    expect(decrypted).toBe(message);
  });

  test('decrypt with different share combinations', () => {
    const { publicKey, shares } = generateThresholdKey(7, 4);

    const message = 42n;
    const ciphertext = encrypt(message, publicKey);

    // Combination 1: members 1,2,3,4
    const shares1 = [
      createDecryptionShare(ciphertext, shares[0], 1),
      createDecryptionShare(ciphertext, shares[1], 2),
      createDecryptionShare(ciphertext, shares[2], 3),
      createDecryptionShare(ciphertext, shares[3], 4),
    ];

    // Combination 2: members 2,4,5,7
    const shares2 = [
      createDecryptionShare(ciphertext, shares[1], 2),
      createDecryptionShare(ciphertext, shares[3], 4),
      createDecryptionShare(ciphertext, shares[4], 5),
      createDecryptionShare(ciphertext, shares[6], 7),
    ];

    const decrypted1 = thresholdDecrypt(ciphertext, shares1);
    const decrypted2 = thresholdDecrypt(ciphertext, shares2);

    expect(decrypted1).toBe(message);
    expect(decrypted2).toBe(message);
  });
});

describe('Vote Aggregation', () => {
  test('aggregate votes and generate Merkle root', () => {
    const aggregator = new VoteAggregator();
    const { publicKey, shares } = generateThresholdKey(5, 3);

    // Simulate 3 voters
    const voters = [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333',
    ];

    const votes = [1n, 0n, 1n]; // yes, no, yes

    // Add votes
    for (let i = 0; i < voters.length; i++) {
      const ciphertext = encrypt(votes[i], publicKey);
      aggregator.addVote(voters[i], ciphertext, Date.now() + i);
    }

    // Create decryption shares
    const allVotes = aggregator.getVotes();
    const secretShares = [
      { memberIndex: 1, share: shares[0] },
      { memberIndex: 3, share: shares[2] },
      { memberIndex: 5, share: shares[4] },
    ];

    const sharesMap = createAllDecryptionShares(allVotes, secretShares);

    // Decrypt and tally
    const decryptedVotes = aggregator.decryptVotes(sharesMap);
    const result = aggregator.tallyVotes(decryptedVotes);

    expect(result.yesVotes).toBe(2);
    expect(result.noVotes).toBe(1);
    expect(result.totalVotes).toBe(3);
    expect(result.votesRoot).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test('vote overwrite with newer timestamp', () => {
    const aggregator = new VoteAggregator();
    const { publicKey } = generateKeyPair();

    const voter = '0x1111111111111111111111111111111111111111';

    // First vote: yes (timestamp 100)
    aggregator.addVote(voter, encrypt(1n, publicKey), 100);

    // Second vote: no (timestamp 200, newer)
    aggregator.addVote(voter, encrypt(0n, publicKey), 200);

    // Should only have 1 vote (overwritten)
    const votes = aggregator.getVotes();
    expect(votes.length).toBe(1);
    expect(votes[0].timestamp).toBe(200);
  });

  test('ignore vote with older timestamp', () => {
    const aggregator = new VoteAggregator();
    const { publicKey } = generateKeyPair();

    const voter = '0x1111111111111111111111111111111111111111';

    // First vote: timestamp 200
    aggregator.addVote(voter, encrypt(1n, publicKey), 200);

    // Second vote: timestamp 100 (older, should be ignored)
    aggregator.addVote(voter, encrypt(0n, publicKey), 100);

    const votes = aggregator.getVotes();
    expect(votes.length).toBe(1);
    expect(votes[0].timestamp).toBe(200);
  });

  test('generate and verify Merkle proof', () => {
    const aggregator = new VoteAggregator();
    const { publicKey, secretKey } = generateKeyPair();

    const voters = [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333',
    ];

    // Add votes
    for (let i = 0; i < voters.length; i++) {
      aggregator.addVote(voters[i], encrypt(BigInt(i % 2), publicKey), i);
    }

    // Decrypt (simplified for test)
    const decryptedVotes = aggregator.getVotes().map((vote, i) => ({
      voter: vote.voter,
      vote: BigInt(i % 2),
      timestamp: vote.timestamp,
    }));

    // Generate Merkle proof for vote index 1
    const proof = aggregator.generateMerkleProof(decryptedVotes, 1);
    expect(proof.length).toBeGreaterThan(0);

    // Tally to get root
    const result = aggregator.tallyVotes(decryptedVotes);

    // Verify proof
    const isValid = VoteAggregator.verifyMerkleProof(
      decryptedVotes[1],
      1,
      proof,
      result.votesRoot
    );

    expect(isValid).toBe(true);
  });
});
