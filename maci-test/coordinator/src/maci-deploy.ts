/**
 * MACI deployment helpers for the coordinator service.
 *
 * Wraps the maci-contracts deployment functions into a single
 * deployFullStack() call that returns all contract instances.
 */
import {
  deployMaci,
  deployVkRegistry,
  deployVerifier,
  deployFreeForAllSignUpGatekeeper,
  deployConstantInitialVoiceCreditProxy,
  EMode,
} from "maci-contracts";
import {
  Poll__factory,
  AccQueueQuinaryMaci__factory,
} from "maci-contracts";
import { Keypair, VerifyingKey } from "maci-domainobjs";
import { loadVkFromFile } from "./utils";

export interface DeployConfig {
  stateTreeDepth: number;
  intStateTreeDepth: number;
  msgTreeDepth: number;
  msgTreeSubDepth: number;
  voteOptionTreeDepth: number;
  msgBatchSize: number;
  processVkJson: string;
  tallyVkJson: string;
  coordinatorStake: bigint;
  proofCostEstimate: bigint;
}

export interface DeployResult {
  maciContract: any;
  pollContract: any;
  messageAqContract: any;
  verifierContract: any;
  vkRegistryContract: any;
  maciRlaContract: any;
  maciAddress: string;
  pollAddress: string;
  maciRlaAddress: string;
  pollId: bigint;
  coordinatorKeypair: Keypair;
}

/**
 * Deploy the full MACI + MaciRLA stack for a single election.
 *
 * @param config Deployment configuration
 * @param deployer Signer for deployment transactions
 * @param ethers Ethers module from hardhat
 * @param pollDuration Duration of the poll in seconds
 */
export async function deployFullStack(
  config: DeployConfig,
  deployer: any,
  ethers: any,
  pollDuration: number = 3600,
): Promise<DeployResult> {
  // Deploy MACI infrastructure
  const gatekeeperContract = await deployFreeForAllSignUpGatekeeper(deployer, true);
  const voiceCreditProxyContract = await deployConstantInitialVoiceCreditProxy(100, deployer, true);
  const verifierContract = await deployVerifier(deployer, true);
  const vkRegistryContract = await deployVkRegistry(deployer, true);

  const r = await deployMaci({
    signUpTokenGatekeeperContractAddress: await gatekeeperContract.getAddress(),
    initialVoiceCreditBalanceAddress: await voiceCreditProxyContract.getAddress(),
    signer: deployer,
    stateTreeDepth: config.stateTreeDepth,
    quiet: true,
  });
  const maciContract = r.maciContract;

  // Register VKs
  const processVk = VerifyingKey.fromObj(loadVkFromFile(config.processVkJson));
  const tallyVk = VerifyingKey.fromObj(loadVkFromFile(config.tallyVkJson));

  await (
    await vkRegistryContract.setVerifyingKeys(
      config.stateTreeDepth,
      config.intStateTreeDepth,
      config.msgTreeDepth,
      config.voteOptionTreeDepth,
      config.msgBatchSize,
      EMode.QV,
      processVk.asContractParam(),
      tallyVk.asContractParam()
    )
  ).wait();

  // Deploy MaciRLA
  const MaciRLA = await ethers.getContractFactory("MaciRLA");
  const maciRlaContract = await MaciRLA.deploy(
    config.coordinatorStake,
    config.proofCostEstimate,
    await verifierContract.getAddress(),
    await vkRegistryContract.getAddress()
  );
  await maciRlaContract.waitForDeployment();

  // Deploy Poll
  const coordinatorKeypair = new Keypair();
  const deployPollTx = await maciContract.deployPoll(
    pollDuration,
    {
      intStateTreeDepth: config.intStateTreeDepth,
      messageTreeSubDepth: config.msgTreeSubDepth,
      messageTreeDepth: config.msgTreeDepth,
      voteOptionTreeDepth: config.voteOptionTreeDepth,
    },
    coordinatorKeypair.pubKey.asContractParam(),
    await verifierContract.getAddress(),
    await vkRegistryContract.getAddress(),
    EMode.QV
  );
  await deployPollTx.wait();

  const pollId = (await maciContract.nextPollId()) - 1n;
  const pollContracts = await maciContract.getPoll(pollId);
  const pollContract = Poll__factory.connect(pollContracts.poll, deployer);
  const extContracts = await pollContract.extContracts();
  const messageAqContract = AccQueueQuinaryMaci__factory.connect(extContracts.messageAq, deployer);

  return {
    maciContract,
    pollContract,
    messageAqContract,
    verifierContract,
    vkRegistryContract,
    maciRlaContract,
    maciAddress: await maciContract.getAddress(),
    pollAddress: pollContracts.poll,
    maciRlaAddress: await maciRlaContract.getAddress(),
    pollId,
    coordinatorKeypair,
  };
}
