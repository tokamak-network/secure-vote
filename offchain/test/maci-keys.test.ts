import {
  generateVoterKeyPair,
  changeVoterKey,
  generateCoordinatorKeyPair,
  serializeVoterKey,
  deserializeVoterKey,
  getPublicKeyHash,
  verifyKeyPair,
  encryptMessage,
  decryptMessage,
  serializeMessage,
  deserializeMessage,
  createKeyChangeMessage,
  Vote,
} from '../src/crypto/maci';

describe('MACI Keys', () => {
  describe('generateVoterKeyPair', () => {
    it('should generate a valid voter keypair', () => {
      const keyPair = generateVoterKeyPair();

      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.nonce).toBe(0);
    });

    it('should generate different keys each time', () => {
      const keyPair1 = generateVoterKeyPair();
      const keyPair2 = generateVoterKeyPair();

      expect(keyPair1.privateKey).not.toEqual(keyPair2.privateKey);
      expect(keyPair1.publicKey.equals(keyPair2.publicKey)).toBe(false);
    });

    it('should use provided nonce', () => {
      const keyPair = generateVoterKeyPair(5);
      expect(keyPair.nonce).toBe(5);
    });
  });

  describe('changeVoterKey', () => {
    it('should generate new key with incremented nonce', () => {
      const oldKey = generateVoterKeyPair();
      expect(oldKey.nonce).toBe(0);

      const newKey = changeVoterKey(oldKey);
      expect(newKey.nonce).toBe(1);
      expect(newKey.publicKey.equals(oldKey.publicKey)).toBe(false);
    });

    it('should increment nonce multiple times', () => {
      let key = generateVoterKeyPair();
      expect(key.nonce).toBe(0);

      key = changeVoterKey(key);
      expect(key.nonce).toBe(1);

      key = changeVoterKey(key);
      expect(key.nonce).toBe(2);

      key = changeVoterKey(key);
      expect(key.nonce).toBe(3);
    });
  });

  describe('generateCoordinatorKeyPair', () => {
    it('should generate a valid coordinator keypair', () => {
      const keyPair = generateCoordinatorKeyPair();

      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
    });
  });

  describe('serializeVoterKey / deserializeVoterKey', () => {
    it('should serialize and deserialize correctly', () => {
      const original = generateVoterKeyPair(3);
      const serialized = serializeVoterKey(original);
      const deserialized = deserializeVoterKey(serialized);

      expect(deserialized.privateKey).toEqual(original.privateKey);
      expect(deserialized.publicKey.equals(original.publicKey)).toBe(true);
      expect(deserialized.nonce).toBe(original.nonce);
    });

    it('should produce JSON-serializable output', () => {
      const keyPair = generateVoterKeyPair();
      const serialized = serializeVoterKey(keyPair);

      const json = JSON.stringify(serialized);
      const parsed = JSON.parse(json);

      expect(parsed.privateKey).toBe(serialized.privateKey);
      expect(parsed.publicKey.x).toBe(serialized.publicKey.x);
      expect(parsed.publicKey.y).toBe(serialized.publicKey.y);
      expect(parsed.nonce).toBe(serialized.nonce);
    });
  });

  describe('getPublicKeyHash', () => {
    it('should return consistent hash for same key', () => {
      const keyPair = generateVoterKeyPair();
      const hash1 = getPublicKeyHash(keyPair.publicKey);
      const hash2 = getPublicKeyHash(keyPair.publicKey);

      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different keys', () => {
      const keyPair1 = generateVoterKeyPair();
      const keyPair2 = generateVoterKeyPair();

      const hash1 = getPublicKeyHash(keyPair1.publicKey);
      const hash2 = getPublicKeyHash(keyPair2.publicKey);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyKeyPair', () => {
    it('should return true for matching keys', () => {
      const keyPair = generateVoterKeyPair();
      expect(verifyKeyPair(keyPair.privateKey, keyPair.publicKey)).toBe(true);
    });

    it('should return false for mismatched keys', () => {
      const keyPair1 = generateVoterKeyPair();
      const keyPair2 = generateVoterKeyPair();

      expect(verifyKeyPair(keyPair1.privateKey, keyPair2.publicKey)).toBe(false);
    });
  });
});

describe('MACI Encryption', () => {
  let voterKey: ReturnType<typeof generateVoterKeyPair>;
  let coordinatorKey: ReturnType<typeof generateCoordinatorKeyPair>;

  beforeEach(() => {
    voterKey = generateVoterKeyPair();
    coordinatorKey = generateCoordinatorKeyPair();
  });

  describe('encryptMessage / decryptMessage', () => {
    it('should encrypt and decrypt vote=0', () => {
      const vote: Vote = 0;
      const encrypted = encryptMessage(
        voterKey,
        coordinatorKey.publicKey,
        vote
      );

      expect(encrypted.voterPubKey.equals(voterKey.publicKey)).toBe(true);
      expect(encrypted.encryptedData).toBeDefined();
      expect(encrypted.ephemeralPubKey).toBeDefined();

      const decrypted = decryptMessage(encrypted, coordinatorKey.privateKey);

      expect(decrypted.vote).toBe(0);
      expect(decrypted.nonce).toBe(voterKey.nonce);
    });

    it('should encrypt and decrypt vote=1', () => {
      const vote: Vote = 1;
      const encrypted = encryptMessage(
        voterKey,
        coordinatorKey.publicKey,
        vote
      );

      const decrypted = decryptMessage(encrypted, coordinatorKey.privateKey);

      expect(decrypted.vote).toBe(1);
      expect(decrypted.nonce).toBe(voterKey.nonce);
    });

    it('should preserve nonce in encryption', () => {
      // Change key to get nonce > 0
      const newKey = changeVoterKey(voterKey);
      expect(newKey.nonce).toBe(1);

      const encrypted = encryptMessage(
        newKey,
        coordinatorKey.publicKey,
        1
      );

      const decrypted = decryptMessage(encrypted, coordinatorKey.privateKey);

      expect(decrypted.nonce).toBe(1);
    });

    it('should produce different ciphertexts for same vote', () => {
      const encrypted1 = encryptMessage(
        voterKey,
        coordinatorKey.publicKey,
        1
      );
      const encrypted2 = encryptMessage(
        voterKey,
        coordinatorKey.publicKey,
        1
      );

      // Different ephemeral keys mean different ciphertexts
      expect(encrypted1.ephemeralPubKey.equals(encrypted2.ephemeralPubKey)).toBe(false);
    });
  });

  describe('serializeMessage / deserializeMessage', () => {
    it('should serialize and deserialize correctly', () => {
      const encrypted = encryptMessage(
        voterKey,
        coordinatorKey.publicKey,
        1
      );

      const serialized = serializeMessage(encrypted);
      const deserialized = deserializeMessage(serialized);

      expect(deserialized.voterPubKey.equals(encrypted.voterPubKey)).toBe(true);
      expect(deserialized.ephemeralPubKey.equals(encrypted.ephemeralPubKey)).toBe(true);
      expect(deserialized.encryptedData.c1.equals(encrypted.encryptedData.c1)).toBe(true);
      expect(deserialized.encryptedData.c2.equals(encrypted.encryptedData.c2)).toBe(true);
    });

    it('should produce hex strings', () => {
      const encrypted = encryptMessage(
        voterKey,
        coordinatorKey.publicKey,
        1
      );

      const serialized = serializeMessage(encrypted);

      expect(serialized.voterPubKey).toMatch(/^[0-9a-f]+$/);
      expect(serialized.encryptedData).toMatch(/^[0-9a-f]+$/);
      expect(serialized.ephemeralPubKey).toMatch(/^[0-9a-f]+$/);

      // Check expected lengths
      expect(serialized.voterPubKey.length).toBe(128); // 64 bytes
      expect(serialized.encryptedData.length).toBe(256); // 128 bytes
      expect(serialized.ephemeralPubKey.length).toBe(128); // 64 bytes
    });

    it('should be JSON serializable', () => {
      const encrypted = encryptMessage(
        voterKey,
        coordinatorKey.publicKey,
        1
      );

      const serialized = serializeMessage(encrypted);
      const json = JSON.stringify(serialized);
      const parsed = JSON.parse(json);

      const deserialized = deserializeMessage(parsed);
      const decrypted = decryptMessage(deserialized, coordinatorKey.privateKey);

      expect(decrypted.vote).toBe(1);
    });
  });

  describe('createKeyChangeMessage', () => {
    it('should create message with key change', () => {
      const oldKey = voterKey;
      const newKey = changeVoterKey(oldKey);

      const message = createKeyChangeMessage(
        oldKey,
        newKey,
        coordinatorKey.publicKey,
        1
      );

      expect(message.voterPubKey.equals(oldKey.publicKey)).toBe(true);

      const decrypted = decryptMessage(message, coordinatorKey.privateKey);
      expect(decrypted.vote).toBe(1);
      expect(decrypted.nonce).toBe(oldKey.nonce);
    });
  });
});

describe('MACI Bribery Resistance', () => {
  it('should demonstrate key change invalidating previous vote', () => {
    const coordinatorKey = generateCoordinatorKeyPair();

    // Initial vote
    const voterKey1 = generateVoterKeyPair();
    const vote1 = encryptMessage(voterKey1, coordinatorKey.publicKey, 0);

    // Briber sees vote1, expects NO vote
    const decrypted1 = decryptMessage(vote1, coordinatorKey.privateKey);
    expect(decrypted1.vote).toBe(0);
    expect(decrypted1.nonce).toBe(0);

    // Voter changes key and revotes YES
    const voterKey2 = changeVoterKey(voterKey1);
    const vote2 = createKeyChangeMessage(
      voterKey1,
      voterKey2,
      coordinatorKey.publicKey,
      1 // Changed to YES
    );

    const decrypted2 = decryptMessage(vote2, coordinatorKey.privateKey);
    expect(decrypted2.vote).toBe(1);
    expect(decrypted2.nonce).toBe(0); // Still nonce 0 (message from old key)

    // Coordinator will see both messages but use the one with higher nonce
    // This is handled by the Coordinator processor (not implemented in this test)
  });

  it('should allow multiple key changes', () => {
    const coordinatorKey = generateCoordinatorKeyPair();

    let voterKey = generateVoterKeyPair();

    // Vote 1: NO
    let msg = encryptMessage(voterKey, coordinatorKey.publicKey, 0);
    let decrypted = decryptMessage(msg, coordinatorKey.privateKey);
    expect(decrypted.vote).toBe(0);
    expect(decrypted.nonce).toBe(0);

    // Key change + Vote 2: YES
    const newKey1 = changeVoterKey(voterKey);
    msg = encryptMessage(newKey1, coordinatorKey.publicKey, 1);
    decrypted = decryptMessage(msg, coordinatorKey.privateKey);
    expect(decrypted.vote).toBe(1);
    expect(decrypted.nonce).toBe(1);

    // Key change + Vote 3: NO again
    const newKey2 = changeVoterKey(newKey1);
    msg = encryptMessage(newKey2, coordinatorKey.publicKey, 0);
    decrypted = decryptMessage(msg, coordinatorKey.privateKey);
    expect(decrypted.vote).toBe(0);
    expect(decrypted.nonce).toBe(2);
  });
});
