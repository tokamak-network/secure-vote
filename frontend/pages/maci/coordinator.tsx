import { useState, useEffect } from 'react';
import { usePublicClient, useWalletClient, useAccount } from 'wagmi';
import Layout from '@/components/Layout';
import { MACI_VOTING_ABI, getMACIContractAddress } from '@/lib/contracts';
import { parseEther } from 'viem';

type CoordinatorInfo = {
  id: number;
  addr: string;
  bond: bigint;
  active: boolean;
};

type ProposalInfo = {
  id: number;
  description: string;
  votingEndTime: bigint;
  messageCount: number;
  hasStateRoot: boolean;
  hasTally: boolean;
  finalized: boolean;
};

export default function CoordinatorDashboard() {
  const [coordinatorInfo, setCoordinatorInfo] = useState<CoordinatorInfo | null>(null);
  const [proposals, setProposals] = useState<ProposalInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [blockTime, setBlockTime] = useState<bigint>(0n);

  // Form states
  const [newProposalDesc, setNewProposalDesc] = useState('');
  const [signupDuration, setSignupDuration] = useState('3600'); // 1 hour
  const [votingDuration, setVotingDuration] = useState('3600'); // 1 hour

  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { address, isConnected } = useAccount();

  const loadData = async () => {
    if (!publicClient || !address) return;

    try {
      setLoading(true);
      setError(null);

      let contractAddress: `0x${string}`;
      try {
        contractAddress = getMACIContractAddress();
      } catch {
        setError('MACI contract not deployed');
        setLoading(false);
        return;
      }

      const block = await publicClient.getBlock();
      setBlockTime(block.timestamp);

      // Check if a coordinator exists (demo mode: show dashboard to everyone)
      try {
        const coord = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'coordinators',
          args: [0n],
        }) as [string, `0x${string}`, bigint, boolean, bigint];

        // Demo mode: if coordinator is active, show the dashboard to anyone
        if (coord[3]) { // active
          setCoordinatorInfo({
            id: 0,
            addr: coord[0],
            bond: coord[2],
            active: coord[3],
          });
        }
      } catch {
        // No coordinator registered
      }

      // Load proposals
      const proposalCount = await publicClient.readContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'nextProposalId',
      }) as bigint;

      const proposalsData: ProposalInfo[] = [];

      for (let i = 0; i < Number(proposalCount); i++) {
        const proposal = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'proposals',
          args: [BigInt(i)],
        }) as [string, bigint, bigint, bigint, bigint, boolean];

        const messageCount = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'getMessageCount',
          args: [BigInt(i)],
        }) as bigint;

        const batchIndex = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'currentBatchIndex',
          args: [BigInt(i)],
        }) as bigint;

        const tally = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'tallies',
          args: [BigInt(i)],
        }) as [bigint, bigint, string, bigint, boolean, string, bigint, boolean];

        proposalsData.push({
          id: i,
          description: proposal[0],
          votingEndTime: proposal[3],
          messageCount: Number(messageCount),
          hasStateRoot: batchIndex > 0n,
          hasTally: tally[3] > 0n,
          finalized: proposal[5],
        });
      }

      setProposals(proposalsData.reverse());
    } catch (err) {
      console.error('Error loading data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [publicClient, address]);

  const registerAsCoordinator = async () => {
    if (!walletClient || !publicClient) return;

    try {
      setProcessing(true);
      setError(null);

      const contractAddress = getMACIContractAddress();

      // Generate coordinator key pair via API
      const keyResponse = await fetch('/api/maci/generate-voter-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: 0 }),
      });

      const keyData = await keyResponse.json();
      if (!keyData.success) throw new Error('Failed to generate key');

      // Format public key as bytes (x || y, each 32 bytes)
      const pubKeyHex = keyData.keyPair.publicKey.x.padStart(64, '0') +
                       keyData.keyPair.publicKey.y.padStart(64, '0');

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'registerCoordinator',
        args: [`0x${pubKeyHex}`],
        value: parseEther('10'),
      });

      await publicClient.waitForTransactionReceipt({ hash });

      // Save coordinator key to localStorage
      localStorage.setItem('maci_coordinator_key', JSON.stringify(keyData.keyPair));

      setSuccess('Registered as coordinator!');
      await loadData();
    } catch (err) {
      console.error('Error registering:', err);
      setError(err instanceof Error ? err.message : 'Failed to register');
    } finally {
      setProcessing(false);
    }
  };

  const createProposal = async () => {
    if (!walletClient || !publicClient || !coordinatorInfo) return;

    try {
      setProcessing(true);
      setError(null);

      const contractAddress = getMACIContractAddress();

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'createProposal',
        args: [
          BigInt(coordinatorInfo.id),
          newProposalDesc,
          BigInt(signupDuration),
          BigInt(votingDuration),
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setSuccess('Proposal created!');
      setNewProposalDesc('');
      await loadData();
    } catch (err) {
      console.error('Error creating proposal:', err);
      setError(err instanceof Error ? err.message : 'Failed to create proposal');
    } finally {
      setProcessing(false);
    }
  };

  const processAndSubmit = async (proposalId: number) => {
    if (!walletClient || !publicClient) return;

    try {
      setProcessing(true);
      setError(null);

      const contractAddress = getMACIContractAddress();

      // Get message count
      const messageCount = await publicClient.readContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'getMessageCount',
        args: [BigInt(proposalId)],
      }) as bigint;

      // For demo: just submit a placeholder state root
      // In production, this would process messages off-chain
      const stateRoot = `0x${Array(64).fill('0').join('')}`.slice(0, 66) as `0x${string}`;

      // Submit state root
      const hash1 = await walletClient.writeContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'submitStateRoot',
        args: [BigInt(proposalId), stateRoot, messageCount],
      });

      await publicClient.waitForTransactionReceipt({ hash: hash1 });

      // Submit tally (demo: split evenly)
      const yes = Number(messageCount) / 2;
      const no = Number(messageCount) - yes;
      const tallyCommitment = `0x${Array(64).fill('1').join('')}`.slice(0, 66) as `0x${string}`;

      const hash2 = await walletClient.writeContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'submitTally',
        args: [BigInt(proposalId), BigInt(Math.floor(yes)), BigInt(Math.ceil(no)), tallyCommitment],
      });

      await publicClient.waitForTransactionReceipt({ hash: hash2 });

      setSuccess('State root and tally submitted!');
      await loadData();
    } catch (err) {
      console.error('Error processing:', err);
      setError(err instanceof Error ? err.message : 'Failed to process');
    } finally {
      setProcessing(false);
    }
  };

  const finalize = async (proposalId: number) => {
    try {
      setProcessing(true);
      setError(null);

      const response = await fetch('/api/maci/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Finalize failed');
      }

      setSuccess('Tally finalized!');
      await loadData();
    } catch (err) {
      console.error('Error finalizing:', err);
      setError(err instanceof Error ? err.message : 'Failed to finalize');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Coordinator Dashboard</h1>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded">
            {success}
          </div>
        )}

        {!isConnected ? (
          <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300 px-4 py-3 rounded">
            Please connect your wallet
          </div>
        ) : !coordinatorInfo ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Register as Coordinator
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              To create and manage MACI proposals, you need to register as a coordinator with a 10 ETH bond.
            </p>
            <button
              onClick={registerAsCoordinator}
              disabled={processing}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {processing ? 'Registering...' : 'Register (10 ETH Bond)'}
            </button>
          </div>
        ) : (
          <>
            {/* Coordinator Info */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Coordinator Status
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">ID:</span>
                  <span className="ml-2 font-medium text-gray-900 dark:text-white">{coordinatorInfo.id}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Bond:</span>
                  <span className="ml-2 font-medium text-gray-900 dark:text-white">
                    {Number(coordinatorInfo.bond) / 1e18} ETH
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Status:</span>
                  <span className={`ml-2 font-medium ${coordinatorInfo.active ? 'text-green-600' : 'text-red-600'}`}>
                    {coordinatorInfo.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>

            {/* Create Proposal */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Create Proposal
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={newProposalDesc}
                    onChange={(e) => setNewProposalDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="Enter proposal description"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Signup Duration (seconds)
                    </label>
                    <input
                      type="number"
                      value={signupDuration}
                      onChange={(e) => setSignupDuration(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Voting Duration (seconds)
                    </label>
                    <input
                      type="number"
                      value={votingDuration}
                      onChange={(e) => setVotingDuration(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
                <button
                  onClick={createProposal}
                  disabled={processing || !newProposalDesc}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {processing ? 'Creating...' : 'Create Proposal'}
                </button>
              </div>
            </div>

            {/* Manage Proposals */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Manage Proposals
              </h2>

              {proposals.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400">No proposals yet</p>
              ) : (
                <div className="space-y-4">
                  {proposals.map((p) => {
                    const votingEnded = blockTime >= p.votingEndTime;
                    const canProcess = votingEnded && !p.hasStateRoot && p.messageCount > 0;
                    const canFinalize = p.hasTally && !p.finalized;

                    return (
                      <div
                        key={p.id}
                        className="border border-gray-200 dark:border-gray-600 rounded-lg p-4"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-medium text-gray-900 dark:text-white">
                              {p.description}
                            </h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              Messages: {p.messageCount} | State Root: {p.hasStateRoot ? 'Yes' : 'No'} |
                              Tally: {p.hasTally ? 'Yes' : 'No'} | Finalized: {p.finalized ? 'Yes' : 'No'}
                            </p>
                          </div>
                          <div className="space-x-2">
                            {canProcess && (
                              <button
                                onClick={() => processAndSubmit(p.id)}
                                disabled={processing}
                                className="bg-purple-600 text-white px-3 py-1 rounded text-sm hover:bg-purple-700 disabled:opacity-50"
                              >
                                Process & Submit
                              </button>
                            )}
                            {canFinalize && (
                              <button
                                onClick={() => finalize(p.id)}
                                disabled={processing}
                                className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                              >
                                Finalize
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
