import { parseAbi } from 'viem';

// Contract ABI - matches SecureVoting.sol
export const VOTING_ABI = parseAbi([
  'function createProposal(string description, uint256 commitDuration, uint256 revealDuration) returns (uint256)',
  'function commitVote(uint256 proposalId, bytes ciphertext)',
  'function submitTally(uint256 proposalId, uint256 yesVotes, uint256 noVotes, bytes32 votesRoot)',
  'function finalizeTally(uint256 proposalId)',
  'function verifyVoteProof(uint256 proposalId, uint256 voteIndex, address voter, uint256 vote, uint256 timestamp, bytes32[] proof) view returns (bool)',
  'function tallies(uint256) view returns (uint256 yesVotes, uint256 noVotes, bytes32 votesRoot, uint256 submittedAt, address submitter, bool challenged, bool finalized)',
  'function proposals(uint256) view returns (string description, uint256 committeeId, uint256 createdAt, uint256 commitEndTime, uint256 revealEndTime, bool finalized)',
  'function encryptedVotes(uint256 proposalId, address voter) view returns (bytes ciphertext, uint256 timestamp)',
  'function depositBond() payable',
  'function nextProposalId() view returns (uint256)',
  'event VoteCommitted(uint256 indexed proposalId, address indexed voter, uint256 timestamp)',
]);

// MACIVoting Contract ABI
export const MACI_VOTING_ABI = parseAbi([
  // Coordinator management
  'function registerCoordinator(bytes publicKey) payable returns (uint256)',
  'function addBond(uint256 coordinatorId) payable',
  'function deactivateCoordinator(uint256 coordinatorId)',
  'function withdrawBond(uint256 coordinatorId, uint256 amount)',
  'function coordinators(uint256) view returns (address addr, bytes publicKey, uint256 bond, bool active, uint256 registeredAt)',
  'function getCoordinatorPublicKey(uint256 coordinatorId) view returns (bytes)',
  // Proposal management
  'function createProposal(uint256 coordinatorId, string description, uint256 signupDuration, uint256 votingDuration) returns (uint256)',
  'function proposals(uint256) view returns (string description, uint256 createdAt, uint256 signupEndTime, uint256 votingEndTime, uint256 coordinatorId, bool finalized)',
  'function nextProposalId() view returns (uint256)',
  'function getProposalCoordinatorPublicKey(uint256 proposalId) view returns (bytes)',
  // Message submission
  'function submitMessage(uint256 proposalId, bytes voterPubKey, bytes encryptedData, bytes ephemeralPubKey)',
  'function getMessage(uint256 proposalId, uint256 messageIndex) view returns (bytes voterPubKey, bytes encryptedData, bytes ephemeralPubKey, uint256 timestamp)',
  'function getMessageCount(uint256 proposalId) view returns (uint256)',
  // State root
  'function submitStateRoot(uint256 proposalId, bytes32 stateRoot, uint256 processedMessageCount)',
  'function getLatestStateRoot(uint256 proposalId) view returns (bytes32)',
  'function stateSubmissions(uint256 proposalId, uint256 batchIndex) view returns (bytes32 stateRoot, uint256 submittedAt, uint256 messageCount, bool challenged, address challenger, uint256 challengeBond, bool resolved)',
  'function currentBatchIndex(uint256) view returns (uint256)',
  // Challenge
  'function challengeStateRoot(uint256 proposalId, uint256 batchIndex) payable',
  'function respondToChallenge(uint256 proposalId, uint256 batchIndex, bytes proof)',
  'function resolveFailedChallenge(uint256 proposalId, uint256 batchIndex)',
  // Tally
  'function submitTally(uint256 proposalId, uint256 yesVotes, uint256 noVotes, bytes32 tallyCommitment)',
  'function challengeTally(uint256 proposalId) payable',
  'function respondToTallyChallenge(uint256 proposalId, bytes proof)',
  'function finalizeTally(uint256 proposalId)',
  'function getTallyResult(uint256 proposalId) view returns (uint256 yesVotes, uint256 noVotes, bool finalized)',
  'function tallies(uint256) view returns (uint256 yesVotes, uint256 noVotes, bytes32 tallyCommitment, uint256 submittedAt, bool challenged, address challenger, uint256 challengeBond, bool finalized)',
  // Events
  'event CoordinatorRegistered(uint256 indexed coordinatorId, address indexed addr, bytes publicKey, uint256 bond)',
  'event ProposalCreated(uint256 indexed proposalId, uint256 coordinatorId, string description, uint256 signupEndTime, uint256 votingEndTime)',
  'event MessageSubmitted(uint256 indexed proposalId, uint256 indexed messageIndex, bytes voterPubKey)',
  'event StateRootSubmitted(uint256 indexed proposalId, uint256 indexed batchIndex, bytes32 stateRoot, uint256 messageCount)',
  'event TallySubmitted(uint256 indexed proposalId, uint256 yesVotes, uint256 noVotes, bytes32 tallyCommitment)',
  'event TallyFinalized(uint256 indexed proposalId, uint256 yesVotes, uint256 noVotes)',
]);

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

// Get contract address from environment
export function getContractAddress(): `0x${string}` {
  const address = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  if (!address) {
    throw new Error('NEXT_PUBLIC_CONTRACT_ADDRESS not set');
  }
  return address as `0x${string}`;
}

// Get MACI contract address from environment
export function getMACIContractAddress(): `0x${string}` {
  const address = process.env.NEXT_PUBLIC_MACI_CONTRACT_ADDRESS;
  if (!address) {
    throw new Error('NEXT_PUBLIC_MACI_CONTRACT_ADDRESS not set');
  }
  return address as `0x${string}`;
}
