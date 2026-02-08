/**
 * MACI SDK helpers for the frontend.
 *
 * Wraps maci-domainobjs and maci-crypto for vote encryption.
 * These functions run server-side (API routes) since the MACI
 * libraries depend on Node.js crypto primitives.
 */

/**
 * Create an encrypted vote message using the official MACI SDK.
 *
 * @param voterPrivKey Serialized voter private key
 * @param voterPubKey Serialized voter public key
 * @param coordinatorPubKey Serialized coordinator public key
 * @param stateIndex Voter's state index (from signup)
 * @param voteOption Vote option (0 = No, 1 = Yes)
 * @param pollId MACI poll ID
 * @returns Encrypted message and ephemeral public key for on-chain submission
 */
export async function createVoteMessage(
  voterPrivKey: string,
  voterPubKey: string,
  coordinatorPubKey: string,
  stateIndex: bigint,
  voteOption: bigint,
  pollId: bigint,
) {
  const { Keypair, PCommand, PrivKey, PubKey } = await import('maci-domainobjs');
  const { genRandomSalt } = await import('maci-crypto');

  const privKey = PrivKey.deserialize(voterPrivKey);
  const pubKey = PubKey.deserialize(voterPubKey);
  const coordPubKey = PubKey.deserialize(coordinatorPubKey);

  const command = new PCommand(
    stateIndex,
    pubKey,
    voteOption,
    1n, // voteWeight (QV)
    1n, // nonce
    pollId,
    genRandomSalt(),
  );

  const signature = command.sign(privKey);
  const ephemeral = new Keypair();
  const sharedKey = Keypair.genEcdhSharedKey(ephemeral.privKey, coordPubKey);
  const encMessage = command.encrypt(signature, sharedKey);

  return {
    message: encMessage.asContractParam(),
    encPubKey: ephemeral.pubKey.asContractParam(),
  };
}
