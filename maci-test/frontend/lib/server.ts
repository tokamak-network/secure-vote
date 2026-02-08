/**
 * Server-side blockchain utilities for API routes.
 * Uses Anvil's default account for local testing.
 */
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

// Anvil account #0 private key (well-known, test only)
const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

const transport = http('http://127.0.0.1:8545');

export const publicClient = createPublicClient({
  chain: foundry,
  transport,
});

export const walletClient = createWalletClient({
  account: privateKeyToAccount(ANVIL_PRIVATE_KEY),
  chain: foundry,
  transport,
});

export const deployerAccount = privateKeyToAccount(ANVIL_PRIVATE_KEY);

// MACI ABI
export const MACI_SIGNUP_ABI = parseAbi([
  'function signUp((uint256 x, uint256 y) pubKey, bytes signUpGatekeeperData, bytes initialVoiceCreditProxyData) returns (uint256 stateIndex, uint256 voiceCreditBalance)',
  'function deployPoll(uint256 duration, (uint8 intStateTreeDepth, uint8 messageTreeSubDepth, uint8 messageTreeDepth, uint8 voteOptionTreeDepth) treeDepths, (uint256 x, uint256 y) coordinatorPubKey, address verifier, address vkRegistry, uint8 mode)',
  'function numSignUps() view returns (uint256)',
  'function nextPollId() view returns (uint256)',
  'function getPoll(uint256) view returns (address poll, address messageProcessor, address tally)',
  'event SignUp(uint256 indexed _stateIndex, uint256 indexed _voiceCreditBalance, uint256 _timestamp)',
]);

// Poll publishMessage ABI
export const POLL_ABI = parseAbi([
  'function publishMessage((uint256[10] data) _message, (uint256 x, uint256 y) _encPubKey)',
  'function getDeployTimeAndDuration() view returns (uint256 deployTime, uint256 duration)',
  'function numSignUpsAndMessages() view returns (uint256 numSignUps, uint256 numMessages)',
  'function coordinatorPubKeyHash() view returns (uint256)',
]);

// MaciRLA coordinator ABI — for RLA workflow
export const MACI_RLA_ABI = parseAbi([
  'function commitResult(address _poll, uint256[] _pmCommitments, uint256[] _tvCommitments, uint256 _yesVotes, uint256 _noVotes) payable',
  'function revealSample(uint256 _pollId)',
  'function submitPmProof(uint256 _pollId, uint256 _sampleIndex, uint256[8] _proof)',
  'function submitTvProof(uint256 _pollId, uint256 _sampleIndex, uint256[8] _proof)',
  'function finalizeSampling(uint256 _pollId)',
  'function finalize(uint256 _pollId)',
  'function challenge(uint256 _pollId) payable',
  'function submitPmProofForChallenge(uint256 _pollId, uint256 _batchIndex, uint256[8] _proof)',
  'function submitTvProofForChallenge(uint256 _pollId, uint256 _batchIndex, uint256[8] _proof)',
  'function finalizeChallengeResponse(uint256 _pollId)',
  'function claimChallengeTimeout(uint256 _pollId)',
  'function getSampleCounts(uint256 _pollId) view returns (uint256 pmSamples, uint256 tvSamples)',
  'function getSelectedBatches(uint256 _pollId) view returns (uint256[] pmIndices, uint256[] tvIndices)',
  'function getChallengeBondAmount(uint256 _pollId) view returns (uint256)',
  'function pollAudits(uint256) view returns (address coordinator, address poll, uint256 stakeAmount, uint256 yesVotes, uint256 noVotes, uint256 pmBatchCount, uint256 tvBatchCount, uint256 pmBatchSize, uint256 tvBatchSize, bytes32 commitHash, uint256 commitBlock, uint256 pmSampleCount, uint256 tvSampleCount, uint256 pmProofsVerified, uint256 tvProofsVerified, uint256 proofDeadline, uint256 tentativeTimestamp, uint256 challengeDeadline, address challenger, uint256 challengeBond, uint256 fullPmProofsVerified, uint256 fullTvProofsVerified, uint8 phase)',
  'function coordinatorStake() view returns (uint256)',
  'function nextPollId() view returns (uint256)',
  'function pmBatchVerified(uint256, uint256) view returns (bool)',
  'function tvBatchVerified(uint256, uint256) view returns (bool)',
]);

export function getAddresses() {
  return {
    maci: process.env.NEXT_PUBLIC_MACI_ADDRESS as `0x${string}`,
    maciRla: process.env.NEXT_PUBLIC_MACI_RLA_ADDRESS as `0x${string}`,
    poll: process.env.NEXT_PUBLIC_POLL_ADDRESS as `0x${string}`,
    verifier: process.env.NEXT_PUBLIC_VERIFIER_ADDRESS as `0x${string}`,
    vkRegistry: process.env.NEXT_PUBLIC_VK_REGISTRY_ADDRESS as `0x${string}`,
    coordinatorPubKey: process.env.NEXT_PUBLIC_COORDINATOR_PUB_KEY || '',
  };
}

/** Anvil-specific: advance time by N seconds */
export async function anvilTimeTravel(seconds: number) {
  const rpc = async (method: string, params: any[] = []) => {
    const r = await fetch('http://127.0.0.1:8545', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
    });
    const data = await r.json();
    if (data.error) throw new Error(`RPC ${method}: ${data.error.message}`);
    return data.result;
  };
  await rpc('evm_increaseTime', [seconds]);
  await rpc('evm_mine');
  // Mine an extra block to ensure timestamp propagates
  await rpc('evm_mine');
}

/** Anvil-specific: mine N blocks */
export async function anvilMineBlocks(count: number) {
  for (let i = 0; i < count; i++) {
    await fetch('http://127.0.0.1:8545', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'evm_mine', params: [], id: i }),
    });
  }
}
