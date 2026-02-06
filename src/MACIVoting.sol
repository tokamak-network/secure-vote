// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BisectionGame.sol";
import "./Verifier.sol";

/**
 * @title MACIVoting
 * @notice MACI-style voting with hybrid fraud proof mechanism
 * @dev Key features:
 *      - Coordinator processes messages off-chain (no ZKP in happy path)
 *      - State root submission without proof
 *      - Hybrid challenge: ZKP_FULL for small batches, BISECTION for large
 *      - Voter key changes for bribery resistance
 *
 * Challenge Modes:
 * - ZKP_FULL: Challenger requests full ZKP proof (fast, expensive for large batches)
 * - BISECTION: Interactive game narrowing to single message (slow, constant cost)
 */
contract MACIVoting {
    // ============ Structs ============

    /**
     * @notice Coordinator configuration
     */
    struct Coordinator {
        address addr;
        bytes publicKey; // BN254 G1 point (64 bytes: x || y)
        uint256 bond;
        bool active;
        uint256 registeredAt;
    }

    /**
     * @notice Proposal (voting session)
     */
    struct Proposal {
        string description;
        uint256 createdAt;
        uint256 signupEndTime;      // Voter registration deadline
        uint256 votingEndTime;      // Message submission deadline
        uint256 coordinatorId;
        bool finalized;
    }

    /**
     * @notice Encrypted message from voter
     */
    struct Message {
        bytes voterPubKey;      // Voter's public key (64 bytes)
        bytes encryptedData;    // Encrypted vote data (128 bytes)
        bytes ephemeralPubKey;  // Ephemeral key for ECDH (64 bytes)
        uint256 timestamp;
    }

    /**
     * @notice State root submission
     */
    struct StateSubmission {
        bytes32 stateRoot;
        uint256 submittedAt;
        uint256 messageCount;
        bool challenged;
        address challenger;
        uint256 challengeBond;
        bool resolved;
    }

    /**
     * @notice Tally result
     */
    struct Tally {
        uint256 yesVotes;
        uint256 noVotes;
        bytes32 tallyCommitment; // Hash of full tally data
        uint256 submittedAt;
        bool challenged;
        address challenger;
        uint256 challengeBond;
        bool finalized;
    }

    /**
     * @notice Challenge mode for hybrid fraud proof
     */
    enum ChallengeMode {
        ZKP_FULL,   // Full ZKP proof required (small batches)
        BISECTION   // Bisection game (large batches)
    }

    /**
     * @notice Challenge information for hybrid system
     */
    struct Challenge {
        ChallengeMode mode;
        address challenger;
        uint256 challengerBond;
        bytes32 challengerStateRoot; // What challenger claims the state should be
        uint256 bisectionGameId;     // If mode == BISECTION
        uint256 startedAt;
        bool resolved;
    }

    // ============ Constants ============

    uint256 public constant MIN_COORDINATOR_BOND = 10 ether;
    uint256 public constant MIN_CHALLENGE_BOND = 1 ether;
    uint256 public constant CHALLENGE_PERIOD = 7 days;
    uint256 public constant RESPONSE_PERIOD = 7 days;
    uint256 public constant BISECTION_THRESHOLD = 100; // Messages below this use ZKP_FULL

    // ============ State Variables ============

    // Bisection game contract
    BisectionGame public bisectionGame;

    // ZKP Verifier
    IVerifier public verifier;

    // Coordinators
    mapping(uint256 => Coordinator) public coordinators;
    uint256 public nextCoordinatorId;

    // Proposals
    mapping(uint256 => Proposal) public proposals;
    uint256 public nextProposalId;

    // Messages: proposalId => messageIndex => Message
    mapping(uint256 => mapping(uint256 => Message)) public messages;
    mapping(uint256 => uint256) public messageCount;

    // State submissions: proposalId => batchIndex => StateSubmission
    mapping(uint256 => mapping(uint256 => StateSubmission)) public stateSubmissions;
    mapping(uint256 => uint256) public currentBatchIndex;

    // Tallies: proposalId => Tally
    mapping(uint256 => Tally) public tallies;

    // Hybrid challenges: proposalId => batchIndex => Challenge
    mapping(uint256 => mapping(uint256 => Challenge)) public challenges;

    // Intermediate state commitments: proposalId => batchIndex => commitment
    mapping(uint256 => mapping(uint256 => bytes32)) public intermediateCommitments;

    // ============ Events ============

    event CoordinatorRegistered(
        uint256 indexed coordinatorId,
        address indexed addr,
        bytes publicKey,
        uint256 bond
    );
    event CoordinatorDeactivated(uint256 indexed coordinatorId);

    event ProposalCreated(
        uint256 indexed proposalId,
        uint256 coordinatorId,
        string description,
        uint256 signupEndTime,
        uint256 votingEndTime
    );

    event MessageSubmitted(
        uint256 indexed proposalId,
        uint256 indexed messageIndex,
        bytes voterPubKey
    );

    event StateRootSubmitted(
        uint256 indexed proposalId,
        uint256 indexed batchIndex,
        bytes32 stateRoot,
        uint256 messageCount
    );

    event StateRootChallenged(
        uint256 indexed proposalId,
        uint256 indexed batchIndex,
        address challenger,
        uint256 bond
    );

    event ChallengeResolved(
        uint256 indexed proposalId,
        uint256 indexed batchIndex,
        bool coordinatorWon
    );

    event TallySubmitted(
        uint256 indexed proposalId,
        uint256 yesVotes,
        uint256 noVotes,
        bytes32 tallyCommitment
    );

    event TallyChallenged(
        uint256 indexed proposalId,
        address challenger,
        uint256 bond
    );

    event TallyFinalized(
        uint256 indexed proposalId,
        uint256 yesVotes,
        uint256 noVotes
    );

    event HybridChallengeStarted(
        uint256 indexed proposalId,
        uint256 indexed batchIndex,
        ChallengeMode mode,
        address challenger,
        uint256 bond
    );

    event BisectionGameStarted(
        uint256 indexed proposalId,
        uint256 indexed batchIndex,
        uint256 gameId
    );

    event HybridChallengeResolved(
        uint256 indexed proposalId,
        uint256 indexed batchIndex,
        bool coordinatorWon,
        ChallengeMode mode
    );

    // ============ Errors ============

    error NotCoordinator();
    error InsufficientBond();
    error CoordinatorNotActive();
    error SignupPeriodEnded();
    error VotingPeriodEnded();
    error VotingPeriodNotEnded();
    error InvalidMessageLength();
    error ProposalNotFound();
    error AlreadyChallenged();
    error ChallengePeriodNotEnded();
    error ChallengePeriodEnded();
    error ResponsePeriodEnded();
    error NotChallenger();
    error AlreadyFinalized();
    error NoStateSubmission();
    error NoTallySubmission();
    error ChallengeNotResolved();
    error InvalidChallengeMode();
    error ChallengeAlreadyExists();
    error NoChallengeExists();
    error NotBisectionGame();
    error BisectionNotComplete();

    // ============ Modifiers ============

    modifier onlyCoordinator(uint256 coordinatorId) {
        if (coordinators[coordinatorId].addr != msg.sender) revert NotCoordinator();
        if (!coordinators[coordinatorId].active) revert CoordinatorNotActive();
        _;
    }

    modifier onlyProposalCoordinator(uint256 proposalId) {
        uint256 coordId = proposals[proposalId].coordinatorId;
        if (coordinators[coordId].addr != msg.sender) revert NotCoordinator();
        if (!coordinators[coordId].active) revert CoordinatorNotActive();
        _;
    }

    // ============ Constructor & Setup ============

    /**
     * @notice Set the BisectionGame contract address
     * @dev Should only be called once during setup
     */
    function setBisectionGame(address _bisectionGame) external {
        require(address(bisectionGame) == address(0), "Already set");
        bisectionGame = BisectionGame(_bisectionGame);
    }

    /**
     * @notice Set the Verifier contract address
     * @dev Can be updated to switch to real verifier after circuit compilation
     */
    function setVerifier(address _verifier) external {
        // Note: In production, add access control
        verifier = IVerifier(_verifier);
    }

    // ============ Coordinator Management ============

    /**
     * @notice Register as a coordinator
     * @param publicKey BN254 G1 public key (64 bytes)
     */
    function registerCoordinator(bytes calldata publicKey) external payable returns (uint256) {
        if (msg.value < MIN_COORDINATOR_BOND) revert InsufficientBond();
        if (publicKey.length != 64) revert InvalidMessageLength();

        uint256 coordinatorId = nextCoordinatorId++;

        coordinators[coordinatorId] = Coordinator({
            addr: msg.sender,
            publicKey: publicKey,
            bond: msg.value,
            active: true,
            registeredAt: block.timestamp
        });

        emit CoordinatorRegistered(coordinatorId, msg.sender, publicKey, msg.value);
        return coordinatorId;
    }

    /**
     * @notice Add more bond as coordinator
     */
    function addBond(uint256 coordinatorId) external payable onlyCoordinator(coordinatorId) {
        coordinators[coordinatorId].bond += msg.value;
    }

    /**
     * @notice Deactivate coordinator (can withdraw bond after pending proposals resolved)
     */
    function deactivateCoordinator(uint256 coordinatorId) external onlyCoordinator(coordinatorId) {
        coordinators[coordinatorId].active = false;
        emit CoordinatorDeactivated(coordinatorId);
    }

    /**
     * @notice Withdraw bond (only if no pending proposals)
     */
    function withdrawBond(uint256 coordinatorId, uint256 amount) external {
        Coordinator storage coord = coordinators[coordinatorId];
        if (coord.addr != msg.sender) revert NotCoordinator();
        if (coord.bond < amount) revert InsufficientBond();

        coord.bond -= amount;
        payable(msg.sender).transfer(amount);
    }

    // ============ Proposal Management ============

    /**
     * @notice Create a new voting proposal
     */
    function createProposal(
        uint256 coordinatorId,
        string calldata description,
        uint256 signupDuration,
        uint256 votingDuration
    ) external onlyCoordinator(coordinatorId) returns (uint256) {
        uint256 proposalId = nextProposalId++;

        proposals[proposalId] = Proposal({
            description: description,
            createdAt: block.timestamp,
            signupEndTime: block.timestamp + signupDuration,
            votingEndTime: block.timestamp + signupDuration + votingDuration,
            coordinatorId: coordinatorId,
            finalized: false
        });

        emit ProposalCreated(
            proposalId,
            coordinatorId,
            description,
            block.timestamp + signupDuration,
            block.timestamp + signupDuration + votingDuration
        );

        return proposalId;
    }

    // ============ Message Submission ============

    /**
     * @notice Submit encrypted vote message
     * @dev Voters can submit multiple messages (key changes, vote updates)
     */
    function submitMessage(
        uint256 proposalId,
        bytes calldata voterPubKey,
        bytes calldata encryptedData,
        bytes calldata ephemeralPubKey
    ) external {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.createdAt == 0) revert ProposalNotFound();
        if (block.timestamp > proposal.votingEndTime) revert VotingPeriodEnded();

        // Validate message lengths
        if (voterPubKey.length != 64) revert InvalidMessageLength();
        if (encryptedData.length != 128) revert InvalidMessageLength();
        if (ephemeralPubKey.length != 64) revert InvalidMessageLength();

        uint256 msgIndex = messageCount[proposalId]++;

        messages[proposalId][msgIndex] = Message({
            voterPubKey: voterPubKey,
            encryptedData: encryptedData,
            ephemeralPubKey: ephemeralPubKey,
            timestamp: block.timestamp
        });

        emit MessageSubmitted(proposalId, msgIndex, voterPubKey);
    }

    // ============ State Root Submission ============

    /**
     * @notice Submit state root after processing messages
     * @dev No proof required - fraud proof model
     * @param proposalId The proposal ID
     * @param stateRoot Final state root after processing
     * @param processedMessageCount Number of messages processed
     * @param _intermediateCommitment Merkle root of all intermediate states (for bisection)
     */
    function submitStateRoot(
        uint256 proposalId,
        bytes32 stateRoot,
        uint256 processedMessageCount,
        bytes32 _intermediateCommitment
    ) external onlyProposalCoordinator(proposalId) {
        Proposal storage proposal = proposals[proposalId];
        if (block.timestamp <= proposal.votingEndTime) revert VotingPeriodNotEnded();

        uint256 batchIndex = currentBatchIndex[proposalId]++;

        stateSubmissions[proposalId][batchIndex] = StateSubmission({
            stateRoot: stateRoot,
            submittedAt: block.timestamp,
            messageCount: processedMessageCount,
            challenged: false,
            challenger: address(0),
            challengeBond: 0,
            resolved: false
        });

        // Store intermediate commitment for bisection games
        intermediateCommitments[proposalId][batchIndex] = _intermediateCommitment;

        emit StateRootSubmitted(proposalId, batchIndex, stateRoot, processedMessageCount);
    }

    /**
     * @notice Submit state root (legacy function without intermediate commitment)
     * @dev Kept for backwards compatibility
     */
    function submitStateRootLegacy(
        uint256 proposalId,
        bytes32 stateRoot,
        uint256 processedMessageCount
    ) external onlyProposalCoordinator(proposalId) {
        Proposal storage proposal = proposals[proposalId];
        if (block.timestamp <= proposal.votingEndTime) revert VotingPeriodNotEnded();

        uint256 batchIndex = currentBatchIndex[proposalId]++;

        stateSubmissions[proposalId][batchIndex] = StateSubmission({
            stateRoot: stateRoot,
            submittedAt: block.timestamp,
            messageCount: processedMessageCount,
            challenged: false,
            challenger: address(0),
            challengeBond: 0,
            resolved: false
        });

        emit StateRootSubmitted(proposalId, batchIndex, stateRoot, processedMessageCount);
    }

    // ============ Challenge Mechanism ============

    /**
     * @notice Challenge a state root submission (legacy - uses ZKP_FULL by default)
     */
    function challengeStateRoot(
        uint256 proposalId,
        uint256 batchIndex
    ) external payable {
        if (msg.value < MIN_CHALLENGE_BOND) revert InsufficientBond();

        StateSubmission storage submission = stateSubmissions[proposalId][batchIndex];
        if (submission.submittedAt == 0) revert NoStateSubmission();
        if (submission.challenged) revert AlreadyChallenged();
        if (submission.resolved) revert AlreadyFinalized();
        if (block.timestamp > submission.submittedAt + CHALLENGE_PERIOD) {
            revert ChallengePeriodEnded();
        }

        submission.challenged = true;
        submission.challenger = msg.sender;
        submission.challengeBond = msg.value;

        emit StateRootChallenged(proposalId, batchIndex, msg.sender, msg.value);
    }

    // ============ Hybrid Challenge Mechanism ============

    /**
     * @notice Challenge with mode selection (ZKP_FULL or BISECTION)
     * @param proposalId The proposal ID
     * @param batchIndex The batch index
     * @param mode Challenge mode (ZKP_FULL for small batches, BISECTION for large)
     * @param challengerStateRoot What the challenger believes the correct state is
     */
    function challengeWithMode(
        uint256 proposalId,
        uint256 batchIndex,
        ChallengeMode mode,
        bytes32 challengerStateRoot
    ) external payable {
        if (msg.value < MIN_CHALLENGE_BOND) revert InsufficientBond();

        StateSubmission storage submission = stateSubmissions[proposalId][batchIndex];
        if (submission.submittedAt == 0) revert NoStateSubmission();
        if (submission.resolved) revert AlreadyFinalized();
        if (block.timestamp > submission.submittedAt + CHALLENGE_PERIOD) {
            revert ChallengePeriodEnded();
        }

        // Check if already challenged via hybrid system
        if (challenges[proposalId][batchIndex].startedAt != 0) {
            revert ChallengeAlreadyExists();
        }

        // Mark as challenged in legacy system too (for compatibility)
        if (!submission.challenged) {
            submission.challenged = true;
            submission.challenger = msg.sender;
            submission.challengeBond = msg.value;
        }

        // Create hybrid challenge
        Challenge storage challenge = challenges[proposalId][batchIndex];
        challenge.mode = mode;
        challenge.challenger = msg.sender;
        challenge.challengerBond = msg.value;
        challenge.challengerStateRoot = challengerStateRoot;
        challenge.startedAt = block.timestamp;
        challenge.resolved = false;

        emit HybridChallengeStarted(proposalId, batchIndex, mode, msg.sender, msg.value);

        // If BISECTION mode, start the bisection game
        if (mode == ChallengeMode.BISECTION) {
            _startBisectionGame(proposalId, batchIndex, challengerStateRoot);
        }
    }

    /**
     * @notice Start a bisection game for a challenge
     */
    function _startBisectionGame(
        uint256 proposalId,
        uint256 batchIndex,
        bytes32 challengerStateRoot
    ) internal {
        StateSubmission storage submission = stateSubmissions[proposalId][batchIndex];
        Challenge storage challenge = challenges[proposalId][batchIndex];

        require(address(bisectionGame) != address(0), "BisectionGame not set");

        uint256 gameId = bisectionGame.startGame(
            proposalId,
            batchIndex,
            challenge.challenger,
            challenge.challengerBond,
            submission.messageCount,
            submission.stateRoot,
            challengerStateRoot,
            intermediateCommitments[proposalId][batchIndex]
        );

        challenge.bisectionGameId = gameId;

        emit BisectionGameStarted(proposalId, batchIndex, gameId);
    }

    /**
     * @notice Respond to ZKP_FULL challenge with full proof
     * @param proposalId The proposal ID
     * @param batchIndex The batch index
     * @param _pA Proof component A
     * @param _pB Proof component B
     * @param _pC Proof component C
     * @param _pubSignals Public signals (14 elements)
     */
    function respondToHybridChallenge(
        uint256 proposalId,
        uint256 batchIndex,
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[13] calldata _pubSignals
    ) external onlyProposalCoordinator(proposalId) {
        Challenge storage challenge = challenges[proposalId][batchIndex];
        if (challenge.startedAt == 0) revert NoChallengeExists();
        if (challenge.resolved) revert AlreadyFinalized();
        if (challenge.mode != ChallengeMode.ZKP_FULL) revert InvalidChallengeMode();

        StateSubmission storage submission = stateSubmissions[proposalId][batchIndex];
        if (block.timestamp > submission.submittedAt + CHALLENGE_PERIOD + RESPONSE_PERIOD) {
            revert ResponsePeriodEnded();
        }

        // Verify ZKP proof
        require(address(verifier) != address(0), "Verifier not set");
        require(verifier.verifyProof(_pA, _pB, _pC, _pubSignals), "Invalid proof");

        // Verify public signals match submission
        // _pubSignals[1] should be the new state root
        require(uint256(submission.stateRoot) == _pubSignals[1], "State root mismatch");

        // Coordinator wins
        challenge.resolved = true;
        submission.resolved = true;

        // Slash challenger
        uint256 challengeBond = challenge.challengerBond;
        challenge.challengerBond = 0;
        submission.challengeBond = 0;

        Coordinator storage coord = coordinators[proposals[proposalId].coordinatorId];
        coord.bond += challengeBond;

        emit HybridChallengeResolved(proposalId, batchIndex, true, ChallengeMode.ZKP_FULL);
        emit ChallengeResolved(proposalId, batchIndex, true);
    }

    /**
     * @notice Respond to ZKP_FULL challenge with raw bytes proof (legacy)
     * @dev Kept for backward compatibility
     */
    function respondToHybridChallengeLegacy(
        uint256 proposalId,
        uint256 batchIndex,
        bytes calldata proof
    ) external onlyProposalCoordinator(proposalId) {
        Challenge storage challenge = challenges[proposalId][batchIndex];
        if (challenge.startedAt == 0) revert NoChallengeExists();
        if (challenge.resolved) revert AlreadyFinalized();
        if (challenge.mode != ChallengeMode.ZKP_FULL) revert InvalidChallengeMode();

        StateSubmission storage submission = stateSubmissions[proposalId][batchIndex];
        if (block.timestamp > submission.submittedAt + CHALLENGE_PERIOD + RESPONSE_PERIOD) {
            revert ResponsePeriodEnded();
        }

        // Legacy: require non-empty proof
        require(proof.length > 0, "Empty proof");

        // Coordinator wins
        challenge.resolved = true;
        submission.resolved = true;

        // Slash challenger
        uint256 challengeBond = challenge.challengerBond;
        challenge.challengerBond = 0;
        submission.challengeBond = 0;

        Coordinator storage coord = coordinators[proposals[proposalId].coordinatorId];
        coord.bond += challengeBond;

        emit HybridChallengeResolved(proposalId, batchIndex, true, ChallengeMode.ZKP_FULL);
        emit ChallengeResolved(proposalId, batchIndex, true);
    }

    /**
     * @notice Callback from BisectionGame when game is resolved
     * @dev Only callable by BisectionGame contract
     */
    function onBisectionResolved(
        uint256 proposalId,
        uint256 batchIndex,
        uint256 gameId,
        bool coordinatorWon,
        address challenger,
        uint256 challengerBond
    ) external {
        if (msg.sender != address(bisectionGame)) revert NotBisectionGame();

        Challenge storage challenge = challenges[proposalId][batchIndex];
        if (challenge.bisectionGameId != gameId) revert InvalidChallengeMode();

        challenge.resolved = true;

        StateSubmission storage submission = stateSubmissions[proposalId][batchIndex];
        submission.resolved = true;

        Coordinator storage coord = coordinators[proposals[proposalId].coordinatorId];

        if (coordinatorWon) {
            // Slash challenger, reward coordinator
            coord.bond += challengerBond;
        } else {
            // Slash coordinator, reward challenger
            uint256 slashAmount = coord.bond;
            coord.bond = 0;
            coord.active = false;

            uint256 reward = challengerBond + slashAmount;
            payable(challenger).transfer(reward);
        }

        emit HybridChallengeResolved(proposalId, batchIndex, coordinatorWon, ChallengeMode.BISECTION);
        emit ChallengeResolved(proposalId, batchIndex, coordinatorWon);
    }

    /**
     * @notice Respond to challenge with proof
     * @dev In production, this would verify a ZK proof
     *      For now, simplified verification placeholder
     */
    function respondToChallenge(
        uint256 proposalId,
        uint256 batchIndex,
        bytes calldata /* proof */
    ) external onlyProposalCoordinator(proposalId) {
        StateSubmission storage submission = stateSubmissions[proposalId][batchIndex];
        if (!submission.challenged) revert NoStateSubmission();
        if (submission.resolved) revert AlreadyFinalized();
        if (block.timestamp > submission.submittedAt + CHALLENGE_PERIOD + RESPONSE_PERIOD) {
            revert ResponsePeriodEnded();
        }

        // TODO: Verify ZK proof
        // For now, assume proof is valid if submitted
        // In production: require(verifyProof(proof, submission.stateRoot), "Invalid proof");

        submission.resolved = true;

        // Slash challenger
        uint256 challengeBond = submission.challengeBond;
        submission.challengeBond = 0;

        // Transfer challenger's bond to coordinator
        Coordinator storage coord = coordinators[proposals[proposalId].coordinatorId];
        coord.bond += challengeBond;

        emit ChallengeResolved(proposalId, batchIndex, true);
    }

    /**
     * @notice Resolve challenge if coordinator fails to respond
     */
    function resolveFailedChallenge(
        uint256 proposalId,
        uint256 batchIndex
    ) external {
        StateSubmission storage submission = stateSubmissions[proposalId][batchIndex];
        if (!submission.challenged) revert NoStateSubmission();
        if (submission.resolved) revert AlreadyFinalized();
        if (block.timestamp <= submission.submittedAt + CHALLENGE_PERIOD + RESPONSE_PERIOD) {
            revert ResponsePeriodEnded();
        }

        submission.resolved = true;

        // Slash coordinator
        Coordinator storage coord = coordinators[proposals[proposalId].coordinatorId];
        uint256 slashAmount = coord.bond;
        coord.bond = 0;
        coord.active = false;

        // Return challenger's bond + reward
        uint256 reward = submission.challengeBond + slashAmount;
        submission.challengeBond = 0;
        payable(submission.challenger).transfer(reward);

        emit ChallengeResolved(proposalId, batchIndex, false);
    }

    // ============ Tally Submission ============

    /**
     * @notice Submit final tally
     */
    function submitTally(
        uint256 proposalId,
        uint256 yesVotes,
        uint256 noVotes,
        bytes32 tallyCommitment
    ) external onlyProposalCoordinator(proposalId) {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.finalized) revert AlreadyFinalized();

        // Ensure all state submissions are resolved
        uint256 batchCount = currentBatchIndex[proposalId];
        for (uint256 i = 0; i < batchCount; i++) {
            StateSubmission storage sub = stateSubmissions[proposalId][i];
            if (sub.challenged && !sub.resolved) revert ChallengeNotResolved();
        }

        tallies[proposalId] = Tally({
            yesVotes: yesVotes,
            noVotes: noVotes,
            tallyCommitment: tallyCommitment,
            submittedAt: block.timestamp,
            challenged: false,
            challenger: address(0),
            challengeBond: 0,
            finalized: false
        });

        emit TallySubmitted(proposalId, yesVotes, noVotes, tallyCommitment);
    }

    /**
     * @notice Challenge tally result
     */
    function challengeTally(uint256 proposalId) external payable {
        if (msg.value < MIN_CHALLENGE_BOND) revert InsufficientBond();

        Tally storage tally = tallies[proposalId];
        if (tally.submittedAt == 0) revert NoTallySubmission();
        if (tally.challenged) revert AlreadyChallenged();
        if (tally.finalized) revert AlreadyFinalized();
        if (block.timestamp > tally.submittedAt + CHALLENGE_PERIOD) {
            revert ChallengePeriodEnded();
        }

        tally.challenged = true;
        tally.challenger = msg.sender;
        tally.challengeBond = msg.value;

        emit TallyChallenged(proposalId, msg.sender, msg.value);
    }

    /**
     * @notice Respond to tally challenge with proof
     */
    function respondToTallyChallenge(
        uint256 proposalId,
        bytes calldata /* proof */
    ) external onlyProposalCoordinator(proposalId) {
        Tally storage tally = tallies[proposalId];
        if (!tally.challenged) revert NoTallySubmission();
        if (tally.finalized) revert AlreadyFinalized();
        if (block.timestamp > tally.submittedAt + CHALLENGE_PERIOD + RESPONSE_PERIOD) {
            revert ResponsePeriodEnded();
        }

        // TODO: Verify ZK proof for tally
        // For now, assume proof is valid

        tally.finalized = true;
        proposals[proposalId].finalized = true;

        // Slash challenger
        uint256 challengeBond = tally.challengeBond;
        tally.challengeBond = 0;

        Coordinator storage coord = coordinators[proposals[proposalId].coordinatorId];
        coord.bond += challengeBond;

        emit TallyFinalized(proposalId, tally.yesVotes, tally.noVotes);
    }

    /**
     * @notice Finalize tally after challenge period
     */
    function finalizeTally(uint256 proposalId) external {
        Tally storage tally = tallies[proposalId];
        Proposal storage proposal = proposals[proposalId];

        if (tally.submittedAt == 0) revert NoTallySubmission();
        if (tally.finalized) revert AlreadyFinalized();

        // If challenged but not resolved, cannot finalize normally
        if (tally.challenged) {
            // Check if response period expired (coordinator failed)
            if (block.timestamp > tally.submittedAt + CHALLENGE_PERIOD + RESPONSE_PERIOD) {
                // Coordinator failed - slash and don't finalize
                Coordinator storage coord = coordinators[proposal.coordinatorId];
                uint256 slashAmount = coord.bond;
                coord.bond = 0;
                coord.active = false;

                uint256 reward = tally.challengeBond + slashAmount;
                tally.challengeBond = 0;
                payable(tally.challenger).transfer(reward);

                // Don't finalize - tally is invalid
                return;
            }
            revert ChallengeNotResolved();
        }

        // Normal finalization after challenge period
        if (block.timestamp <= tally.submittedAt + CHALLENGE_PERIOD) {
            revert ChallengePeriodNotEnded();
        }

        tally.finalized = true;
        proposal.finalized = true;

        emit TallyFinalized(proposalId, tally.yesVotes, tally.noVotes);
    }

    // ============ View Functions ============

    function getCoordinatorPublicKey(uint256 coordinatorId) external view returns (bytes memory) {
        return coordinators[coordinatorId].publicKey;
    }

    function getProposalCoordinatorPublicKey(uint256 proposalId) external view returns (bytes memory) {
        uint256 coordId = proposals[proposalId].coordinatorId;
        return coordinators[coordId].publicKey;
    }

    function getMessage(
        uint256 proposalId,
        uint256 messageIndex
    ) external view returns (
        bytes memory voterPubKey,
        bytes memory encryptedData,
        bytes memory ephemeralPubKey,
        uint256 timestamp
    ) {
        Message storage msg_ = messages[proposalId][messageIndex];
        return (msg_.voterPubKey, msg_.encryptedData, msg_.ephemeralPubKey, msg_.timestamp);
    }

    function getMessageCount(uint256 proposalId) external view returns (uint256) {
        return messageCount[proposalId];
    }

    function getLatestStateRoot(uint256 proposalId) external view returns (bytes32) {
        uint256 batchIndex = currentBatchIndex[proposalId];
        if (batchIndex == 0) return bytes32(0);
        return stateSubmissions[proposalId][batchIndex - 1].stateRoot;
    }

    function getTallyResult(uint256 proposalId) external view returns (
        uint256 yesVotes,
        uint256 noVotes,
        bool finalized
    ) {
        Tally storage tally = tallies[proposalId];
        return (tally.yesVotes, tally.noVotes, tally.finalized);
    }

    /**
     * @notice Get challenge info for a batch
     */
    function getChallenge(
        uint256 proposalId,
        uint256 batchIndex
    ) external view returns (
        ChallengeMode mode,
        address challenger,
        uint256 bond,
        bytes32 challengerStateRoot,
        uint256 bisectionGameId,
        bool resolved
    ) {
        Challenge storage c = challenges[proposalId][batchIndex];
        return (
            c.mode,
            c.challenger,
            c.challengerBond,
            c.challengerStateRoot,
            c.bisectionGameId,
            c.resolved
        );
    }

    /**
     * @notice Get intermediate commitment for a batch
     */
    function getIntermediateCommitment(
        uint256 proposalId,
        uint256 batchIndex
    ) external view returns (bytes32) {
        return intermediateCommitments[proposalId][batchIndex];
    }
}
