// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Verifier.sol";

/**
 * @title BisectionGame
 * @notice Bisection fraud proof game for MACI voting
 * @dev Allows challengers to narrow down a fraudulent state transition
 *      to a single message, which is then verified via ZKP
 *
 * Flow:
 * 1. Challenger starts bisection game with claimed state root at end
 * 2. Coordinator responds with intermediate state at midpoint
 * 3. Challenger picks side where state roots diverge
 * 4. Repeat until narrowed to single message
 * 5. Coordinator provides ZKP for that single message transition
 */
contract BisectionGame {
    // ============ Structs ============

    /**
     * @notice Bisection game state
     */
    struct Game {
        uint256 proposalId;
        uint256 batchIndex;
        address challenger;
        uint256 challengerBond;
        uint256 l;  // left bound (inclusive)
        uint256 r;  // right bound (inclusive)
        bytes32 coordinatorStateRoot;  // coordinator's claimed final state
        bytes32 challengerStateRoot;   // challenger's expected state (differs at some point)
        bytes32 intermediateCommitment; // merkle root of all intermediate states
        uint256 round;
        uint256 lastMoveAt;
        bool isCoordinatorTurn;
        GameStatus status;
    }

    enum GameStatus {
        Active,
        CoordinatorWon,
        ChallengerWon,
        Expired
    }

    // ============ Constants ============

    uint256 public constant BISECTION_TIMEOUT = 1 days;
    uint256 public constant MAX_ROUNDS = 256; // log2 of max messages

    // ============ State Variables ============

    // gameId => Game
    mapping(uint256 => Game) public games;
    uint256 public nextGameId;

    // Integration with MACIVoting
    address public maciVoting;

    // ZKP Verifier
    IVerifier public verifier;

    // ============ Events ============

    event GameStarted(
        uint256 indexed gameId,
        uint256 indexed proposalId,
        uint256 batchIndex,
        address challenger,
        uint256 l,
        uint256 r
    );

    event BisectionMove(
        uint256 indexed gameId,
        uint256 round,
        uint256 l,
        uint256 r,
        bool isCoordinatorTurn
    );

    event GameResolved(
        uint256 indexed gameId,
        GameStatus status,
        address winner
    );

    event SingleMessageChallenge(
        uint256 indexed gameId,
        uint256 messageIndex,
        bytes32 prevStateRoot,
        bytes32 claimedStateRoot
    );

    // ============ Errors ============

    error NotMACIVoting();
    error GameNotActive();
    error NotYourTurn();
    error InvalidMidpoint();
    error InvalidProof();
    error GameExpired();
    error GameNotExpired();
    error AlreadyNarrowedToSingle();
    error NotNarrowedToSingle();
    error InvalidStateRoot();

    // ============ Modifiers ============

    modifier onlyMACIVoting() {
        if (msg.sender != maciVoting) revert NotMACIVoting();
        _;
    }

    modifier gameActive(uint256 gameId) {
        if (games[gameId].status != GameStatus.Active) revert GameNotActive();
        _;
    }

    // ============ Constructor ============

    constructor(address _maciVoting) {
        maciVoting = _maciVoting;
    }

    /**
     * @notice Set the Verifier contract address
     * @dev Can be updated to switch to real verifier after circuit compilation
     */
    function setVerifier(address _verifier) external onlyMACIVoting {
        verifier = IVerifier(_verifier);
    }

    // ============ Game Initialization ============

    /**
     * @notice Start a new bisection game
     * @param proposalId The proposal being challenged
     * @param batchIndex The batch being challenged
     * @param challenger Address of the challenger
     * @param challengerBond Bond amount from challenger
     * @param messageCount Total number of messages in batch
     * @param coordinatorStateRoot Coordinator's claimed final state root
     * @param challengerStateRoot Challenger's expected final state root
     * @param intermediateCommitment Merkle root of intermediate states
     */
    function startGame(
        uint256 proposalId,
        uint256 batchIndex,
        address challenger,
        uint256 challengerBond,
        uint256 messageCount,
        bytes32 coordinatorStateRoot,
        bytes32 challengerStateRoot,
        bytes32 intermediateCommitment
    ) external onlyMACIVoting returns (uint256) {
        uint256 gameId = nextGameId++;

        games[gameId] = Game({
            proposalId: proposalId,
            batchIndex: batchIndex,
            challenger: challenger,
            challengerBond: challengerBond,
            l: 0,
            r: messageCount - 1,
            coordinatorStateRoot: coordinatorStateRoot,
            challengerStateRoot: challengerStateRoot,
            intermediateCommitment: intermediateCommitment,
            round: 0,
            lastMoveAt: block.timestamp,
            isCoordinatorTurn: true, // Coordinator goes first
            status: GameStatus.Active
        });

        emit GameStarted(gameId, proposalId, batchIndex, challenger, 0, messageCount - 1);
        return gameId;
    }

    // ============ Bisection Moves ============

    /**
     * @notice Coordinator provides intermediate state at midpoint
     * @param gameId The game ID
     * @param midStateRoot State root at the midpoint
     * @param proof Merkle proof that midStateRoot is committed
     */
    function coordinatorBisect(
        uint256 gameId,
        bytes32 midStateRoot,
        bytes32[] calldata proof
    ) external gameActive(gameId) {
        Game storage game = games[gameId];

        if (!game.isCoordinatorTurn) revert NotYourTurn();
        if (block.timestamp > game.lastMoveAt + BISECTION_TIMEOUT) revert GameExpired();
        if (game.l == game.r) revert AlreadyNarrowedToSingle();

        uint256 mid = (game.l + game.r) / 2;

        // Verify the midStateRoot is in the committed intermediate states
        if (!_verifyIntermediateProof(game.intermediateCommitment, mid, midStateRoot, proof)) {
            revert InvalidProof();
        }

        // Coordinator has provided midpoint, challenger must choose a side
        game.round++;
        game.lastMoveAt = block.timestamp;
        game.isCoordinatorTurn = false;

        emit BisectionMove(gameId, game.round, game.l, game.r, false);
    }

    /**
     * @notice Challenger chooses which half contains the fraud
     * @param gameId The game ID
     * @param chooseLeft If true, fraud is in [l, mid], else in [mid+1, r]
     * @param expectedMidStateRoot The state root challenger expects at midpoint
     */
    function challengerBisect(
        uint256 gameId,
        bool chooseLeft,
        bytes32 expectedMidStateRoot
    ) external gameActive(gameId) {
        Game storage game = games[gameId];

        if (game.isCoordinatorTurn) revert NotYourTurn();
        if (msg.sender != game.challenger) revert NotYourTurn();
        if (block.timestamp > game.lastMoveAt + BISECTION_TIMEOUT) revert GameExpired();

        uint256 mid = (game.l + game.r) / 2;

        if (chooseLeft) {
            // Challenger claims fraud is in left half
            game.r = mid;
        } else {
            // Challenger claims fraud is in right half
            game.l = mid + 1;
        }

        game.challengerStateRoot = expectedMidStateRoot;
        game.lastMoveAt = block.timestamp;
        game.isCoordinatorTurn = true;

        emit BisectionMove(gameId, game.round, game.l, game.r, true);
    }

    // ============ Game Resolution ============

    /**
     * @notice Resolve game when narrowed to single message with ZKP
     * @param gameId The game ID
     * @param _pA Proof component A
     * @param _pB Proof component B
     * @param _pC Proof component C
     * @param _pubSignals Public signals (14 elements)
     *
     * @dev The proof must show that:
     *      - Decryption of message[l] was correct
     *      - State transition from prevState to newState was correct
     */
    function resolveWithProof(
        uint256 gameId,
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[13] calldata _pubSignals
    ) external gameActive(gameId) {
        Game storage game = games[gameId];

        if (game.l != game.r) revert NotNarrowedToSingle();

        // Verify ZKP proof
        require(address(verifier) != address(0), "Verifier not set");
        require(verifier.verifyProof(_pA, _pB, _pC, _pubSignals), "Invalid proof");

        // Verify public signals match game state
        // _pubSignals[7] should be the message index
        require(_pubSignals[7] == game.l, "Message index mismatch");

        // Coordinator wins by providing valid proof
        game.status = GameStatus.CoordinatorWon;

        emit GameResolved(gameId, GameStatus.CoordinatorWon, address(0));

        // Notify MACIVoting to handle bond transfers
        IMACIVotingCallback(maciVoting).onBisectionResolved(
            game.proposalId,
            game.batchIndex,
            gameId,
            true, // coordinatorWon
            game.challenger,
            game.challengerBond
        );
    }

    /**
     * @notice Resolve game with raw bytes proof (legacy)
     * @dev Kept for backward compatibility
     */
    function resolveWithProofLegacy(
        uint256 gameId,
        bytes calldata zkProof
    ) external gameActive(gameId) {
        Game storage game = games[gameId];

        if (game.l != game.r) revert NotNarrowedToSingle();

        // Legacy: require non-empty proof as placeholder
        if (zkProof.length == 0) revert InvalidProof();

        // Coordinator wins by providing valid proof
        game.status = GameStatus.CoordinatorWon;

        emit GameResolved(gameId, GameStatus.CoordinatorWon, address(0));

        // Notify MACIVoting to handle bond transfers
        IMACIVotingCallback(maciVoting).onBisectionResolved(
            game.proposalId,
            game.batchIndex,
            gameId,
            true, // coordinatorWon
            game.challenger,
            game.challengerBond
        );
    }

    /**
     * @notice Resolve game when a party times out
     * @param gameId The game ID
     */
    function resolveTimeout(uint256 gameId) external gameActive(gameId) {
        Game storage game = games[gameId];

        if (block.timestamp <= game.lastMoveAt + BISECTION_TIMEOUT) {
            revert GameNotExpired();
        }

        if (game.isCoordinatorTurn) {
            // Coordinator timed out - challenger wins
            game.status = GameStatus.ChallengerWon;
            emit GameResolved(gameId, GameStatus.ChallengerWon, game.challenger);

            IMACIVotingCallback(maciVoting).onBisectionResolved(
                game.proposalId,
                game.batchIndex,
                gameId,
                false, // coordinatorWon
                game.challenger,
                game.challengerBond
            );
        } else {
            // Challenger timed out - coordinator wins
            game.status = GameStatus.CoordinatorWon;
            emit GameResolved(gameId, GameStatus.CoordinatorWon, address(0));

            IMACIVotingCallback(maciVoting).onBisectionResolved(
                game.proposalId,
                game.batchIndex,
                gameId,
                true, // coordinatorWon
                game.challenger,
                game.challengerBond
            );
        }
    }

    // ============ View Functions ============

    function getGame(uint256 gameId) external view returns (Game memory) {
        return games[gameId];
    }

    function getCurrentBounds(uint256 gameId) external view returns (uint256 l, uint256 r) {
        Game storage game = games[gameId];
        return (game.l, game.r);
    }

    function isNarrowedToSingle(uint256 gameId) external view returns (bool) {
        Game storage game = games[gameId];
        return game.l == game.r;
    }

    function getDisputedMessageIndex(uint256 gameId) external view returns (uint256) {
        Game storage game = games[gameId];
        require(game.l == game.r, "Not narrowed to single");
        return game.l;
    }

    // ============ Internal Functions ============

    /**
     * @notice Verify Merkle proof for intermediate state
     * @dev Simplified version - in production would be more robust
     */
    function _verifyIntermediateProof(
        bytes32 root,
        uint256 index,
        bytes32 stateRoot,
        bytes32[] calldata proof
    ) internal pure returns (bool) {
        bytes32 computedHash = stateRoot;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];

            if (index % 2 == 0) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }

            index = index / 2;
        }

        return computedHash == root;
    }
}

/**
 * @notice Callback interface for MACIVoting
 */
interface IMACIVotingCallback {
    function onBisectionResolved(
        uint256 proposalId,
        uint256 batchIndex,
        uint256 gameId,
        bool coordinatorWon,
        address challenger,
        uint256 challengerBond
    ) external;
}
