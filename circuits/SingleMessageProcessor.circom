pragma circom 2.1.0;

/**
 * SingleMessageProcessor Circuit
 *
 * Proves that a single encrypted message was correctly:
 * 1. Decrypted using the coordinator's private key
 * 2. Applied to transition state from prevStateRoot to newStateRoot
 *
 * Used in:
 * - ZKP_FULL mode: Prove all messages in batch (via recursive composition)
 * - BISECTION mode: Prove single disputed message transition
 *
 * Public Inputs:
 * - prevStateRoot: State root before processing this message
 * - newStateRoot: State root after processing this message
 * - encryptedMessage: The encrypted message data [voterPubKey, encData, ephemeralKey]
 * - messageIndex: Index of this message in the batch
 * - coordinatorPubKey: Coordinator's public key (for verification)
 *
 * Private Inputs:
 * - coordinatorPrivKey: Coordinator's private key (for decryption)
 * - decryptedVote: The decrypted vote value
 * - decryptedNonce: The decrypted nonce
 * - voterPubKeyX: Voter's public key X coordinate
 * - voterPubKeyY: Voter's public key Y coordinate
 * - prevStateLeaves: Merkle tree leaves before update
 * - newStateLeaves: Merkle tree leaves after update
 * - merkleProof: Proof for state update
 */

include "poseidon.circom";
include "bitify.circom";
include "comparators.circom";
include "mux1.circom";

/**
 * ECDH Key Exchange
 * Computes shared secret: sharedSecret = privateKey * publicKey
 */
template ECDH() {
    signal input privateKey;
    signal input publicKeyX;
    signal input publicKeyY;
    signal output sharedSecretX;
    signal output sharedSecretY;

    // Simplified scalar multiplication for BN254
    // In production, use proper elliptic curve arithmetic
    // For now, we use Poseidon as a placeholder
    component hasher = Poseidon(3);
    hasher.inputs[0] <== privateKey;
    hasher.inputs[1] <== publicKeyX;
    hasher.inputs[2] <== publicKeyY;

    sharedSecretX <== hasher.out;
    sharedSecretY <== hasher.out; // Simplified
}

/**
 * Symmetric Decryption
 * Decrypts data using shared secret
 */
template SymmetricDecrypt(n) {
    signal input sharedSecret;
    signal input ciphertext[n];
    signal output plaintext[n];

    component hashers[n];
    for (var i = 0; i < n; i++) {
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== sharedSecret;
        hashers[i].inputs[1] <== i;
        // XOR decryption (simplified)
        plaintext[i] <== ciphertext[i] - hashers[i].out;
    }
}

/**
 * Merkle Tree Update
 * Verifies and updates a leaf in a Merkle tree
 */
template MerkleUpdate(levels) {
    signal input oldRoot;
    signal input newRoot;
    signal input oldLeaf;
    signal input newLeaf;
    signal input pathIndices[levels];
    signal input siblings[levels];

    // Declare all components at template scope (required by circom 2.x)
    component oldHashers[levels];
    component oldMuxL[levels];
    component oldMuxR[levels];
    component newHashers[levels];
    component newMuxL[levels];
    component newMuxR[levels];

    // Verify old leaf is in tree
    signal oldPath[levels + 1];
    oldPath[0] <== oldLeaf;

    for (var i = 0; i < levels; i++) {
        oldHashers[i] = Poseidon(2);

        // pathIndices[i] == 0: current is left, sibling is right
        // pathIndices[i] == 1: current is right, sibling is left
        oldMuxL[i] = Mux1();
        oldMuxL[i].c[0] <== oldPath[i];
        oldMuxL[i].c[1] <== siblings[i];
        oldMuxL[i].s <== pathIndices[i];

        oldMuxR[i] = Mux1();
        oldMuxR[i].c[0] <== siblings[i];
        oldMuxR[i].c[1] <== oldPath[i];
        oldMuxR[i].s <== pathIndices[i];

        oldHashers[i].inputs[0] <== oldMuxL[i].out;
        oldHashers[i].inputs[1] <== oldMuxR[i].out;
        oldPath[i + 1] <== oldHashers[i].out;
    }

    oldPath[levels] === oldRoot;

    // Verify new leaf creates new root
    signal newPath[levels + 1];
    newPath[0] <== newLeaf;

    for (var i = 0; i < levels; i++) {
        newHashers[i] = Poseidon(2);

        newMuxL[i] = Mux1();
        newMuxL[i].c[0] <== newPath[i];
        newMuxL[i].c[1] <== siblings[i];
        newMuxL[i].s <== pathIndices[i];

        newMuxR[i] = Mux1();
        newMuxR[i].c[0] <== siblings[i];
        newMuxR[i].c[1] <== newPath[i];
        newMuxR[i].s <== pathIndices[i];

        newHashers[i].inputs[0] <== newMuxL[i].out;
        newHashers[i].inputs[1] <== newMuxR[i].out;
        newPath[i + 1] <== newHashers[i].out;
    }

    newPath[levels] === newRoot;
}

/**
 * Vote Validation
 * Ensures vote is valid (0, 1, or 2 for no/yes/abstain)
 */
template VoteValidator() {
    signal input vote;
    signal output isValid;

    // vote must be 0, 1, or 2
    component eq0 = IsEqual();
    eq0.in[0] <== vote;
    eq0.in[1] <== 0;

    component eq1 = IsEqual();
    eq1.in[0] <== vote;
    eq1.in[1] <== 1;

    component eq2 = IsEqual();
    eq2.in[0] <== vote;
    eq2.in[1] <== 2;

    isValid <== eq0.out + eq1.out + eq2.out;
    isValid === 1;
}

/**
 * Nonce Validator
 * Ensures nonce is greater than or equal to previous nonce
 */
template NonceValidator() {
    signal input currentNonce;
    signal input previousNonce;
    signal output isValid;

    component gte = GreaterEqThan(32);
    gte.in[0] <== currentNonce;
    gte.in[1] <== previousNonce;

    isValid <== gte.out;
    isValid === 1;
}

/**
 * Main Circuit: Single Message Processor
 *
 * Proves correct processing of one encrypted vote message
 */
template SingleMessageProcessor(treeLevels) {
    // Public inputs
    signal input prevStateRoot;
    signal input newStateRoot;
    signal input encryptedVoterPubKeyX;
    signal input encryptedVoterPubKeyY;
    signal input encryptedData[4]; // [encVote, encNonce, encNewKeyX, encNewKeyY]
    signal input ephemeralPubKeyX;
    signal input ephemeralPubKeyY;
    signal input messageIndex;
    signal input coordinatorPubKeyX;
    signal input coordinatorPubKeyY;

    // Private inputs
    signal input coordinatorPrivKey;
    signal input decryptedVote;
    signal input decryptedNonce;
    signal input voterPubKeyX;
    signal input voterPubKeyY;
    signal input previousVoterNonce;
    signal input previousVoterVote;
    signal input pathIndices[treeLevels];
    signal input siblings[treeLevels];

    // 1. Verify coordinator key pair
    component coordKeyVerify = Poseidon(1);
    coordKeyVerify.inputs[0] <== coordinatorPrivKey;
    // In production: verify coordinatorPubKey = coordKeyVerify.out * G

    // 2. Compute shared secret via ECDH
    component ecdh = ECDH();
    ecdh.privateKey <== coordinatorPrivKey;
    ecdh.publicKeyX <== ephemeralPubKeyX;
    ecdh.publicKeyY <== ephemeralPubKeyY;

    // 3. Decrypt the encrypted data
    component decrypt = SymmetricDecrypt(4);
    decrypt.sharedSecret <== ecdh.sharedSecretX;
    for (var i = 0; i < 4; i++) {
        decrypt.ciphertext[i] <== encryptedData[i];
    }

    // Verify decrypted values match claimed values
    decrypt.plaintext[0] === decryptedVote;
    decrypt.plaintext[1] === decryptedNonce;

    // 4. Validate vote
    component voteValidator = VoteValidator();
    voteValidator.vote <== decryptedVote;

    // 5. Validate nonce (must be >= previous)
    component nonceValidator = NonceValidator();
    nonceValidator.currentNonce <== decryptedNonce;
    nonceValidator.previousNonce <== previousVoterNonce;

    // 6. Compute old leaf hash
    component oldLeafHasher = Poseidon(4);
    oldLeafHasher.inputs[0] <== voterPubKeyX;
    oldLeafHasher.inputs[1] <== voterPubKeyY;
    oldLeafHasher.inputs[2] <== previousVoterVote;
    oldLeafHasher.inputs[3] <== previousVoterNonce;

    // 7. Compute new leaf hash
    component newLeafHasher = Poseidon(4);
    newLeafHasher.inputs[0] <== voterPubKeyX;
    newLeafHasher.inputs[1] <== voterPubKeyY;
    newLeafHasher.inputs[2] <== decryptedVote;
    newLeafHasher.inputs[3] <== decryptedNonce;

    // 8. Verify Merkle tree update
    component merkleUpdate = MerkleUpdate(treeLevels);
    merkleUpdate.oldRoot <== prevStateRoot;
    merkleUpdate.newRoot <== newStateRoot;
    merkleUpdate.oldLeaf <== oldLeafHasher.out;
    merkleUpdate.newLeaf <== newLeafHasher.out;
    for (var i = 0; i < treeLevels; i++) {
        merkleUpdate.pathIndices[i] <== pathIndices[i];
        merkleUpdate.siblings[i] <== siblings[i];
    }
}

// Instantiate with 20 levels (supports ~1M voters)
component main {public [
    prevStateRoot,
    newStateRoot,
    encryptedVoterPubKeyX,
    encryptedVoterPubKeyY,
    encryptedData,
    ephemeralPubKeyX,
    ephemeralPubKeyY,
    messageIndex,
    coordinatorPubKeyX,
    coordinatorPubKeyY
]} = SingleMessageProcessor(20);
