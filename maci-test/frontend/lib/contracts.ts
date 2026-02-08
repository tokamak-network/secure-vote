import { parseAbi } from 'viem';

// Anvil local chain config
export const anvilChain = {
  id: 31337,
  name: 'Anvil',
  network: 'anvil',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
    public: { http: ['http://127.0.0.1:8545'] },
  },
} as const;

// Get addresses from env
export function getMaciAddress(): `0x${string}` {
  const addr = process.env.NEXT_PUBLIC_MACI_ADDRESS;
  if (!addr) throw new Error('NEXT_PUBLIC_MACI_ADDRESS not set');
  return addr as `0x${string}`;
}

export function getMaciRlaAddress(): `0x${string}` {
  const addr = process.env.NEXT_PUBLIC_MACI_RLA_ADDRESS;
  if (!addr) throw new Error('NEXT_PUBLIC_MACI_RLA_ADDRESS not set');
  return addr as `0x${string}`;
}

// MaciRLA ABI — subset needed by the frontend
export const MACI_RLA_ABI = parseAbi([
  // Read
  'function pollAudits(uint256) view returns (address coordinator, address poll, uint256 stakeAmount, uint256 yesVotes, uint256 noVotes, uint256 pmBatchCount, uint256 tvBatchCount, uint256 pmBatchSize, uint256 tvBatchSize, bytes32 commitHash, uint256 commitBlock, uint256 pmSampleCount, uint256 tvSampleCount, uint256 pmProofsVerified, uint256 tvProofsVerified, uint256 proofDeadline, uint256 tentativeTimestamp, uint256 challengeDeadline, address challenger, uint256 challengeBond, uint256 fullPmProofsVerified, uint256 fullTvProofsVerified, uint8 phase)',
  'function nextPollId() view returns (uint256)',
  'function getSampleCounts(uint256 pollId) view returns (uint256 pmSamples, uint256 tvSamples)',
  'function getSelectedBatches(uint256 pollId) view returns (uint256[] pmIndices, uint256[] tvIndices)',
  'function getChallengeBondAmount(uint256 pollId) view returns (uint256 bond)',
  'function coordinatorStake() view returns (uint256)',
  'function CHALLENGE_PERIOD() view returns (uint256)',
  // Write
  'function commitResult(address poll, uint256[] pmCommitments, uint256[] tvCommitments, uint256 yesVotes, uint256 noVotes) payable',
  'function revealSample(uint256 pollId)',
  'function finalizeSampling(uint256 pollId)',
  'function finalize(uint256 pollId)',
  'function challenge(uint256 pollId) payable',
  'function claimChallengeTimeout(uint256 pollId)',
  // Events
  'event ResultCommitted(uint256 indexed pollId, address coordinator, uint256 yesVotes, uint256 noVotes, uint256 pmSamples, uint256 tvSamples)',
  'event SampleRevealed(uint256 indexed pollId, uint256[] pmIndices, uint256[] tvIndices)',
  'event BatchProofVerified(uint256 indexed pollId, uint8 batchType, uint256 batchIndex)',
  'event AuditPassed(uint256 indexed pollId, uint256 challengeDeadline)',
  'event PollFinalized(uint256 indexed pollId, uint256 yesVotes, uint256 noVotes)',
]);

// MACI contract ABI — subset for signup + poll interaction
// Uses struct types matching actual Solidity contract (PubKey is a tuple, not uint256[2])
export const MACI_ABI = parseAbi([
  'function signUp((uint256 x, uint256 y) pubKey, bytes signUpGatekeeperData, bytes initialVoiceCreditProxyData) returns (uint256)',
  'function numSignUps() view returns (uint256)',
  'function nextPollId() view returns (uint256)',
  'function getPoll(uint256 pollId) view returns (address poll, address messageProcessor, address tally)',
  'function stateTreeDepth() view returns (uint8)',
  'event SignUp(uint256 _stateIndex, uint256 indexed _userPubKeyX, uint256 indexed _userPubKeyY, uint256 _voiceCreditBalance, uint256 _timestamp)',
]);

// Poll contract ABI — subset for vote publishing
// Message is struct { uint256[10] data }, PubKey is struct { uint256 x, uint256 y }
export const POLL_ABI = parseAbi([
  'function publishMessage((uint256[10] data) message, (uint256 x, uint256 y) encPubKey)',
  'function numSignUpsAndMessages() view returns (uint256 numSignUps, uint256 numMessages)',
  'function getDeployTimeAndDuration() view returns (uint256 deployTime, uint256 duration)',
  'function treeDepths() view returns (uint8 intStateTreeDepth, uint8 msgTreeSubDepth, uint8 msgTreeDepth, uint8 voteOptionTreeDepth)',
  'function coordinatorPubKeyHash() view returns (uint256)',
]);

// Phase enum matching MaciRLA.sol
export enum AuditPhase {
  None = 0,
  Committed = 1,
  SampleRevealed = 2,
  Audited = 3,
  Tentative = 4,
  Challenged = 5,
  Finalized = 6,
  Rejected = 7,
}

export const PHASE_LABELS: Record<number, string> = {
  [AuditPhase.None]: 'Not Started',
  [AuditPhase.Committed]: 'Committed',
  [AuditPhase.SampleRevealed]: 'Sample Revealed',
  [AuditPhase.Audited]: 'Audited',
  [AuditPhase.Tentative]: 'Challenge Period',
  [AuditPhase.Challenged]: 'Challenged',
  [AuditPhase.Finalized]: 'Finalized',
  [AuditPhase.Rejected]: 'Rejected',
};
