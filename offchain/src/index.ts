/**
 * Secure Vote - Off-chain Cryptography Library
 *
 * Threshold cryptography tools for secure voting system
 */

// ElGamal encryption
export {
  encrypt,
  decrypt,
  decryptMessage,
  generateKeyPair,
  discreteLog,
  serializePoint,
  deserializePoint,
  serializeCiphertext,
  deserializeCiphertext,
  pointFromCoordinates,
  type Ciphertext,
  type KeyPair,
  type G1Point,
  type Scalar,
} from './crypto/elgamal';

// Shamir Secret Sharing
export {
  splitSecret,
  reconstructSecret,
  verifyShare,
  generateCommitments,
  type Share,
} from './crypto/shamir';

// Distributed Key Generation
export {
  generateThresholdKey,
  createDecryptionShare,
  combineDecryptionShares,
  thresholdDecrypt,
  serializeDecryptionShare,
  deserializeDecryptionShare,
  type ThresholdKeyPair,
  type DecryptionShare,
} from './crypto/dkg';

// Vote Aggregation
export {
  VoteAggregator,
  createAllDecryptionShares,
  type Vote,
  type DecryptedVote,
  type TallyResult,
} from './aggregator';

// Silent Setup (n-of-n threshold encryption)
export {
  generateMemberKeyPair,
  aggregatePublicKeys,
  createPartialDecryption,
  combinePartialDecryptions,
  silentDecrypt,
  type MemberKeyPair,
  type PartialDecryption,
} from './crypto/silent-setup';

// MACI Cryptography
export {
  // Key management
  generateVoterKeyPair,
  changeVoterKey,
  generateCoordinatorKeyPair,
  serializeVoterKey,
  deserializeVoterKey,
  getPublicKeyHash,
  verifyKeyPair,
  // Message encryption
  encryptMessage,
  decryptMessage as decryptMACIMessage,
  serializeMessage,
  deserializeMessage,
  createKeyChangeMessage,
  // Types
  type VoterKeyPair,
  type SerializedVoterKey,
  type CoordinatorKeyPair,
  type Vote as MACIVote,
  type EncryptedMessage,
  type SerializedMessage,
  type DecryptedMessage,
} from './crypto/maci';

// Coordinator
export {
  StateManager,
  MessageProcessor,
  createProcessor,
  createProcessorWithKey,
  computeMerkleRoot,
  type VoterState,
  type CoordinatorState,
  type ProcessedMessage,
  type BatchResult,
} from './coordinator';
