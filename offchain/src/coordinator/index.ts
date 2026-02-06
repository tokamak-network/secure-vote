/**
 * Coordinator Module
 *
 * Provides message processing and state management for MACI-style voting.
 */

// State management
export type {
  VoterState,
  SerializedVoterState,
  CoordinatorState,
  IntermediateStateData,
} from './state';
export {
  StateManager,
  serializeVoterState,
  hashVoterState,
  computeMerkleRoot,
} from './state';

// Message processing
export type {
  ProcessedMessage,
  BatchResult,
  IntermediateState,
} from './processor';
export {
  MessageProcessor,
  createProcessor,
  createProcessorWithKey,
} from './processor';
