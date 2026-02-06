import { encrypt } from '../src/crypto/elgamal';
import {
  generateMemberKeyPair,
  aggregatePublicKeys,
  createPartialDecryption,
  combinePartialDecryptions,
  silentDecrypt,
} from '../src/crypto/silent-setup';
import { bn254 } from '@noble/curves/bn254';

describe('Silent Setup Threshold Encryption', () => {
  test('generate member key pair', () => {
    const member = generateMemberKeyPair(1);

    expect(member.index).toBe(1);
    expect(typeof member.secretKey).toBe('bigint');
    expect(member.publicKey).toBeDefined();

    // Verify pk = sk * G
    const expectedPk = bn254.G1.Point.BASE.multiply(member.secretKey);
    expect(member.publicKey.equals(expectedPk)).toBe(true);
  });

  test('reject invalid member index', () => {
    expect(() => generateMemberKeyPair(0)).toThrow('Member index must be >= 1');
    expect(() => generateMemberKeyPair(-1)).toThrow('Member index must be >= 1');
  });

  test('aggregate public keys', () => {
    const members = [1, 2, 3].map(i => generateMemberKeyPair(i));
    const publicKeys = members.map(m => m.publicKey);

    const aggregated = aggregatePublicKeys(publicKeys);

    // Verify: aggregated = pk_1 + pk_2 + pk_3
    const expected = publicKeys[0].add(publicKeys[1]).add(publicKeys[2]);
    expect(aggregated.equals(expected)).toBe(true);
  });

  test('reject empty public key array', () => {
    expect(() => aggregatePublicKeys([])).toThrow('Need at least one public key');
  });

  test('encrypt and decrypt with 5-of-5 members', () => {
    // Each member generates their own key pair independently
    const members = [1, 2, 3, 4, 5].map(i => generateMemberKeyPair(i));

    // Aggregate public keys (no one knows the combined secret key!)
    const aggregatedPK = aggregatePublicKeys(members.map(m => m.publicKey));

    // Encrypt message with aggregated public key
    const message = 1n;
    const ciphertext = encrypt(message, aggregatedPK);

    // Each member creates a partial decryption
    const partials = members.map(m =>
      createPartialDecryption(ciphertext, m.secretKey, m.index)
    );

    // Combine all partials to decrypt
    const decrypted = silentDecrypt(ciphertext, partials);

    expect(decrypted).toBe(message);
  });

  test('encrypt and decrypt zero value', () => {
    const members = [1, 2, 3].map(i => generateMemberKeyPair(i));
    const aggregatedPK = aggregatePublicKeys(members.map(m => m.publicKey));

    const message = 0n;
    const ciphertext = encrypt(message, aggregatedPK);

    const partials = members.map(m =>
      createPartialDecryption(ciphertext, m.secretKey, m.index)
    );

    const decrypted = silentDecrypt(ciphertext, partials);

    expect(decrypted).toBe(message);
  });

  test('encrypt and decrypt larger values', () => {
    const members = [1, 2].map(i => generateMemberKeyPair(i));
    const aggregatedPK = aggregatePublicKeys(members.map(m => m.publicKey));

    // Test values 0-100
    for (const message of [0n, 1n, 10n, 42n, 100n]) {
      const ciphertext = encrypt(message, aggregatedPK);
      const partials = members.map(m =>
        createPartialDecryption(ciphertext, m.secretKey, m.index)
      );
      const decrypted = silentDecrypt(ciphertext, partials);

      expect(decrypted).toBe(message);
    }
  });

  test('single member setup works', () => {
    const member = generateMemberKeyPair(1);
    const aggregatedPK = aggregatePublicKeys([member.publicKey]);

    const message = 7n;
    const ciphertext = encrypt(message, aggregatedPK);

    const partials = [createPartialDecryption(ciphertext, member.secretKey, 1)];
    const decrypted = silentDecrypt(ciphertext, partials);

    expect(decrypted).toBe(message);
  });

  test('partial decryptions can be combined in any order', () => {
    const members = [1, 2, 3, 4].map(i => generateMemberKeyPair(i));
    const aggregatedPK = aggregatePublicKeys(members.map(m => m.publicKey));

    const message = 5n;
    const ciphertext = encrypt(message, aggregatedPK);

    const partials = members.map(m =>
      createPartialDecryption(ciphertext, m.secretKey, m.index)
    );

    // Order 1: original
    const decrypted1 = silentDecrypt(ciphertext, partials);

    // Order 2: reversed
    const decrypted2 = silentDecrypt(ciphertext, [...partials].reverse());

    // Order 3: shuffled
    const decrypted3 = silentDecrypt(ciphertext, [
      partials[2],
      partials[0],
      partials[3],
      partials[1],
    ]);

    expect(decrypted1).toBe(message);
    expect(decrypted2).toBe(message);
    expect(decrypted3).toBe(message);
  });

  test('decryption fails with missing members (n-of-n)', () => {
    const members = [1, 2, 3].map(i => generateMemberKeyPair(i));
    const aggregatedPK = aggregatePublicKeys(members.map(m => m.publicKey));

    const message = 1n;
    const ciphertext = encrypt(message, aggregatedPK);

    // Only 2 out of 3 members provide partials
    const partials = [
      createPartialDecryption(ciphertext, members[0].secretKey, 1),
      createPartialDecryption(ciphertext, members[1].secretKey, 2),
    ];

    // This should NOT decrypt correctly (wrong result or null)
    const decrypted = silentDecrypt(ciphertext, partials, 100);

    // Either null or incorrect value
    expect(decrypted === null || decrypted !== message).toBe(true);
  });

  test('combinePartialDecryptions produces correct message point', () => {
    const members = [1, 2].map(i => generateMemberKeyPair(i));
    const aggregatedPK = aggregatePublicKeys(members.map(m => m.publicKey));

    const message = 3n;
    const ciphertext = encrypt(message, aggregatedPK);

    const partials = members.map(m =>
      createPartialDecryption(ciphertext, m.secretKey, m.index)
    );

    const messagePoint = combinePartialDecryptions(ciphertext, partials);

    // Verify: messagePoint should equal message * G
    const expectedPoint = bn254.G1.Point.BASE.multiply(message);
    expect(messagePoint.equals(expectedPoint)).toBe(true);
  });

  test('combinePartialDecryptions rejects empty array', () => {
    const member = generateMemberKeyPair(1);
    const ciphertext = encrypt(1n, member.publicKey);

    expect(() => combinePartialDecryptions(ciphertext, [])).toThrow(
      'Need at least one partial decryption'
    );
  });

  test('multiple encryptions with same key', () => {
    const members = [1, 2, 3].map(i => generateMemberKeyPair(i));
    const aggregatedPK = aggregatePublicKeys(members.map(m => m.publicKey));

    // Encrypt multiple messages
    const messages = [0n, 1n, 0n, 1n, 1n];
    const ciphertexts = messages.map(m => encrypt(m, aggregatedPK));

    // Decrypt each
    for (let i = 0; i < messages.length; i++) {
      const partials = members.map(m =>
        createPartialDecryption(ciphertexts[i], m.secretKey, m.index)
      );
      const decrypted = silentDecrypt(ciphertexts[i], partials);

      expect(decrypted).toBe(messages[i]);
    }
  });
});
