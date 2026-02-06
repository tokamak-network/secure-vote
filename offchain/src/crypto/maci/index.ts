/**
 * MACI Cryptography Module
 *
 * Provides voter key management and message encryption for
 * MACI-style anti-bribery voting.
 */

// Key management
export type {
  VoterKeyPair,
  SerializedVoterKey,
  CoordinatorKeyPair,
} from './keys';
export {
  generateVoterKeyPair,
  changeVoterKey,
  generateCoordinatorKeyPair,
  computeSharedSecret,
  deriveEncryptionKey,
  serializeVoterKey,
  deserializeVoterKey,
  serializePublicKey,
  deserializePublicKey,
  getPublicKeyHash,
  verifyKeyPair,
} from './keys';

// Message encryption
export type {
  Vote,
  MessageData,
  EncryptedMessage,
  SerializedMessage,
  DecryptedMessage,
} from './encryption';
export {
  encryptMessage,
  decryptMessage,
  serializeMessage,
  deserializeMessage,
  createKeyChangeMessage,
} from './encryption';
