import type { NextApiRequest, NextApiResponse } from 'next';
import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { getCommitteeAccount, getDummyVoterAccounts, FOUNDRY_ACCOUNTS } from '../../lib/anvil-helpers';
import { VOTING_ABI, anvilChain, getContractAddress } from '../../lib/contracts';
import {
  generateMemberKeyPair,
  aggregatePublicKeys,
  encrypt,
  serializeCiphertext,
  pointFromCoordinates,
} from '../../lib/crypto-wrapper';
import fs from 'fs';
import path from 'path';

// Store key shares in file (persists across requests)
const KEY_STORE_PATH = path.join(process.cwd(), 'key-shares.json');

// Random DAO-style proposal templates
const PROPOSAL_TEMPLATES = [
  // Treasury
  'Allocate {amount} ETH to the Developer Fund',
  'Transfer {amount} ETH to Marketing Multisig',
  'Fund {project} with {amount} ETH grant',
  // Governance
  'Reduce quorum threshold from 10% to 5%',
  'Extend voting period to 7 days',
  'Add {name} to the Governance Council',
  // Protocol
  'Upgrade staking contract to v{version}',
  'Enable cross-chain bridging to {chain}',
  'Increase max supply cap by {percent}%',
  // Partnerships
  'Partner with {protocol} for liquidity mining',
  'Integrate {oracle} as primary price feed',
  'List token on {exchange} DEX',
  // Community
  'Launch Ambassador Program with {amount} ETH budget',
  'Sponsor {event} hackathon',
  'Create bug bounty program',
];

const PLACEHOLDERS: Record<string, string[]> = {
  amount: ['50', '100', '250', '500', '1000'],
  project: ['DeFi Analytics Dashboard', 'Mobile Wallet', 'SDK Development', 'Security Audit'],
  name: ['Alice.eth', 'Bob.eth', 'Carol.eth', 'Dave.eth'],
  version: ['2.0', '2.1', '3.0'],
  chain: ['Arbitrum', 'Optimism', 'Base', 'Polygon'],
  percent: ['5', '10', '15', '20'],
  protocol: ['Uniswap', 'Aave', 'Compound', 'Curve'],
  oracle: ['Chainlink', 'Pyth', 'RedStone'],
  exchange: ['Uniswap V3', 'SushiSwap', 'Balancer'],
  event: ['ETHGlobal', 'Devcon', 'ETHDenver'],
};

function generateRandomProposal(): string {
  const template = PROPOSAL_TEMPLATES[Math.floor(Math.random() * PROPOSAL_TEMPLATES.length)];
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const options = PLACEHOLDERS[key];
    return options ? options[Math.floor(Math.random() * options.length)] : key;
  });
}

type ResponseData = {
  success: boolean;
  proposalId?: number;
  error?: string;
  publicKey?: { x: string; y: string };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    console.log('=== Setup Demo Starting ===');

    const contractAddress = getContractAddress();
    console.log('Contract address:', contractAddress);

    // Setup clients
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(),
    });

    // Verify contract is deployed
    const bytecode = await publicClient.getBytecode({ address: contractAddress });
    if (!bytecode || bytecode === '0x') {
      throw new Error(`No contract deployed at ${contractAddress}. Please deploy with: forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`);
    }
    console.log('Contract verified at address');

    const committeeAccount = getCommitteeAccount();
    const committeeClient = createWalletClient({
      account: committeeAccount,
      chain: anvilChain,
      transport: http(),
    });

    // Step 1: Load or generate Silent Setup keys (5-of-5)
    let publicKey: any;
    let keyData: any;

    if (fs.existsSync(KEY_STORE_PATH)) {
      // Reuse existing keys
      console.log('Loading existing Silent Setup keys...');
      keyData = JSON.parse(fs.readFileSync(KEY_STORE_PATH, 'utf-8'));
      publicKey = pointFromCoordinates(
        keyData.aggregatedPublicKey.x,
        keyData.aggregatedPublicKey.y
      );
      console.log('✓ Loaded existing Silent Setup keys');
    } else {
      // Generate new keys - each member generates independently (Silent Setup)
      console.log('Generating Silent Setup keys (5-of-5)...');
      const n = 5;

      // Each member generates their own key pair independently
      // In real deployment, this would happen on each member's machine
      const members = [];
      for (let i = 1; i <= n; i++) {
        members.push(generateMemberKeyPair(i));
      }

      // Aggregate public keys (no one knows the combined secret!)
      const aggregatedPK = aggregatePublicKeys(members.map(m => m.publicKey));
      publicKey = aggregatedPK;

      keyData = {
        aggregatedPublicKey: {
          x: aggregatedPK.toAffine().x.toString(),
          y: aggregatedPK.toAffine().y.toString(),
        },
        members: members.map(m => ({
          index: m.index,
          secretKey: m.secretKey.toString(),
          publicKey: {
            x: m.publicKey.toAffine().x.toString(),
            y: m.publicKey.toAffine().y.toString(),
          },
        })),
        n, // Total members (n-of-n required for decryption)
        timestamp: Date.now(),
      };

      fs.writeFileSync(KEY_STORE_PATH, JSON.stringify(keyData, null, 2));
      console.log('✓ Silent Setup keys generated and stored');
    }

    // Step 2: Deposit bond (10 ETH)
    console.log('Depositing bond...');
    const bondHash = await committeeClient.writeContract({
      address: contractAddress,
      abi: VOTING_ABI,
      functionName: 'depositBond',
      value: parseEther('10'),
    });
    await publicClient.waitForTransactionReceipt({ hash: bondHash });
    console.log('✓ Bond deposited');

    // Step 3: Get current proposal count and create proposal
    console.log('Creating proposal...');
    const currentCount = await publicClient.readContract({
      address: contractAddress,
      abi: VOTING_ABI,
      functionName: 'nextProposalId',
    }) as bigint;
    console.log('Current proposal count:', currentCount);

    const proposalDescription = generateRandomProposal();
    console.log('Proposal:', proposalDescription);

    const proposalHash = await committeeClient.writeContract({
      address: contractAddress,
      abi: VOTING_ABI,
      functionName: 'createProposal',
      args: [proposalDescription, 300n, 300n], // 5 minutes each
    });
    await publicClient.waitForTransactionReceipt({ hash: proposalHash });
    const proposalId = currentCount; // Use the actual ID that was assigned
    console.log('✓ Proposal created with ID:', proposalId);

    // Verify proposal was created correctly
    const proposalData = await publicClient.readContract({
      address: contractAddress,
      abi: VOTING_ABI,
      functionName: 'proposals',
      args: [proposalId],
    }) as [string, bigint, bigint, bigint, bigint, boolean];

    // Get actual blockchain time to avoid clock skew issues
    const block = await publicClient.getBlock();
    const blockTimestamp = block.timestamp;
    const commitEndTime = proposalData[3];
    console.log('Proposal details:', {
      description: proposalData[0],
      commitEndTime: commitEndTime.toString(),
      blockTimestamp: blockTimestamp.toString(),
      timeRemaining: (commitEndTime - blockTimestamp).toString() + 's',
    });

    if (blockTimestamp >= commitEndTime) {
      throw new Error(`Voting period already ended! Block timestamp: ${blockTimestamp}, commitEndTime: ${commitEndTime}`);
    }

    // Step 4: Submit dummy votes (2 votes)
    console.log('Submitting dummy votes...');
    const dummyVoters = getDummyVoterAccounts();
    const dummyVotes = [1n, 0n]; // Account 1: Yes, Account 2: No

    for (let i = 0; i < dummyVoters.length; i++) {
      const account = dummyVoters[i];
      const vote = dummyVotes[i];

      const voterClient = createWalletClient({
        account,
        chain: anvilChain,
        transport: http(),
      });

      const ciphertext = encrypt(vote, publicKey);
      const serialized = serializeCiphertext(ciphertext);

      const voteHash = await voterClient.writeContract({
        address: contractAddress,
        abi: VOTING_ABI,
        functionName: 'commitVote',
        args: [proposalId, `0x${serialized}`],
      });

      await publicClient.waitForTransactionReceipt({ hash: voteHash });
      console.log(`✓ Dummy vote ${i + 1} submitted (${vote === 1n ? 'Yes' : 'No'})`);
    }

    console.log('=== Setup Demo Complete ===');

    return res.status(200).json({
      success: true,
      proposalId: Number(proposalId),
      publicKey: {
        x: publicKey.x.toString(),
        y: publicKey.y.toString(),
      },
    });
  } catch (error) {
    console.error('Setup demo error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
