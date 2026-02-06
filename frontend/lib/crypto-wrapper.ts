/**
 * Wrapper around offchain cryptography library
 * Re-exports functions for use in frontend
 */

// Import directly from parent offchain directory
import {
  // Legacy (Trusted Dealer)
  generateThresholdKey,
  createAllDecryptionShares,
  VoteAggregator,
  // Core ElGamal
  encrypt,
  serializeCiphertext,
  deserializeCiphertext,
  pointFromCoordinates,
  // Silent Setup (n-of-n threshold)
  generateMemberKeyPair,
  aggregatePublicKeys,
  createPartialDecryption,
  combinePartialDecryptions,
  silentDecrypt,
  // MACI
  generateVoterKeyPair,
  changeVoterKey,
  generateCoordinatorKeyPair,
  serializeVoterKey,
  deserializeVoterKey,
  getPublicKeyHash,
  encryptMessage,
  serializeMessage,
  deserializeMessage,
  createKeyChangeMessage,
  // Coordinator
  MessageProcessor,
  createProcessor,
  createProcessorWithKey,
} from '../../offchain/src';

// Re-export everything
export {
  // Legacy (Trusted Dealer)
  generateThresholdKey,
  createAllDecryptionShares,
  VoteAggregator,
  // Core ElGamal
  encrypt,
  serializeCiphertext,
  deserializeCiphertext,
  pointFromCoordinates,
  // Silent Setup (n-of-n threshold)
  generateMemberKeyPair,
  aggregatePublicKeys,
  createPartialDecryption,
  combinePartialDecryptions,
  silentDecrypt,
  // MACI
  generateVoterKeyPair,
  changeVoterKey,
  generateCoordinatorKeyPair,
  serializeVoterKey,
  deserializeVoterKey,
  getPublicKeyHash,
  encryptMessage,
  serializeMessage,
  deserializeMessage,
  createKeyChangeMessage,
  // Coordinator
  MessageProcessor,
  createProcessor,
  createProcessorWithKey,
};

export type {
  G1Point as PublicKey,
  Share,
  Ciphertext,
  MemberKeyPair,
  PartialDecryption,
  // MACI types
  VoterKeyPair,
  SerializedVoterKey,
  CoordinatorKeyPair,
  MACIVote,
  EncryptedMessage,
  SerializedMessage,
} from '../../offchain/src';
