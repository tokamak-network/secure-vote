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
