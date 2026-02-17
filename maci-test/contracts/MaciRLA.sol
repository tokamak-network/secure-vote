// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IPoll } from "./interfaces/IPoll.sol";
import { IMACI } from "./interfaces/IMACI.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import { IVkRegistry } from "./interfaces/IVkRegistry.sol";
import { SnarkCommon } from "./crypto/SnarkCommon.sol";
import { DomainObjs } from "./utilities/DomainObjs.sol";
import { AccQueue } from "./trees/AccQueue.sol";

/// @title MaciRLA
/// @notice Risk-Limiting Audit (RLA) verification layer for MACI voting results.
///
/// Instead of verifying ALL batch proofs (ProcessMessages + TallyVotes),
/// this contract randomly samples a subset based on the claimed result margin.
/// Wider margins require fewer samples; close races require more.
///
/// Protocol flow:
///   1. commitResult()    — coordinator stakes ETH + publishes all intermediate
///                          state commitments and the claimed tally
///   2. revealSample()    — anyone calls after BLOCK_HASH_DELAY blocks to derive
///                          random batch indices from blockhash-based seed
///   3. submitBatchProof()— coordinator submits Groth16 proofs for sampled batches
///   4. finalizeSampling()— once all sampled proofs pass, starts 7-day challenge window
///   5. challenge()       — anyone can post a bond to demand full verification
///   6. respondToChallenge()— coordinator submits remaining proofs
///   7. finalize()        — after challenge period, result is accepted
///
/// Randomness: uses commit-reveal with blockhash — the coordinator commits data,
/// then after BLOCK_HASH_DELAY blocks, the blockhash of the commit block provides
/// unpredictable randomness that the coordinator cannot manipulate.
///
/// Security: if the coordinator corrupted enough batches to change the outcome,
/// the sampling detects it with ≥95% probability (configurable via CONFIDENCE_X1000).
contract MaciRLA is SnarkCommon, DomainObjs {

    // ═══════════════════════════════════════════════════════════════════
    //                          CONSTANTS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Challenge period after sampling passes
    uint256 public constant CHALLENGE_PERIOD = 7 days;

    /// @notice Deadline for coordinator to submit sampled proofs
    uint256 public constant PROOF_DEADLINE = 1 days;

    /// @notice Deadline for coordinator to respond to a challenge
    uint256 public constant CHALLENGE_RESPONSE_DEADLINE = 3 days;

    /// @notice -ln(0.05) × 1000 ≈ 2996, used for integer sample-count math.
    ///         Represents 95% confidence level.
    uint256 private constant CONFIDENCE_X1000 = 2996;

    /// @notice Minimum blocks to wait after commit before revealing sample.
    ///         Ensures the blockhash is from a block mined after the commitment.
    uint256 public constant BLOCK_HASH_DELAY = 1;

    /// @notice Maximum blocks after commitBlock + BLOCK_HASH_DELAY for which
    ///         blockhash() is valid. EVM only stores the last 256 block hashes.
    uint256 public constant BLOCK_HASH_WINDOW = 256;

    /// @notice MACI tree arity for message batches
    uint256 private constant MSG_TREE_ARITY = 5;

    /// @notice MACI tree arity for tally batches
    uint256 private constant TALLY_TREE_ARITY = 2;

    // ═══════════════════════════════════════════════════════════════════
    //                            TYPES
    // ═══════════════════════════════════════════════════════════════════

    enum Phase {
        None,            // 0 — poll audit not started
        Committed,       // 1 — coordinator committed result
        SampleRevealed,  // 2 — random batch indices determined
        Audited,         // 3 — all sampled proofs verified
        Tentative,       // 4 — challenge period active
        Challenged,      // 5 — someone challenged, awaiting full proof
        Finalized,       // 6 — result accepted
        Rejected         // 7 — result rejected
    }

    enum BatchType {
        ProcessMessages,
        TallyVotes
    }

    struct PollAudit {
        // ── Identity ──
        address coordinator;
        IPoll poll;

        // ── Stake ──
        uint256 stakeAmount;

        // ── Claimed result ──
        uint256 yesVotes;
        uint256 noVotes;

        // ── Batch counts ──
        uint256 pmBatchCount;    // number of ProcessMessages batches
        uint256 tvBatchCount;    // number of TallyVotes batches
        uint256 pmBatchSize;     // messages per PM batch (5^msgTreeSubDepth)
        uint256 tvBatchSize;     // voters per TV batch (2^intStateTreeDepth)

        // ── Sampling ──
        bytes32 commitHash;
        uint256 commitBlock;     // block number when commitResult() was called
        uint256 pmSampleCount;
        uint256 tvSampleCount;
        uint256 pmProofsVerified;
        uint256 tvProofsVerified;

        // ── Timing ──
        uint256 proofDeadline;       // deadline for sampled proof submission
        uint256 tentativeTimestamp;   // when challenge period started
        uint256 challengeDeadline;   // deadline for challenge response

        // ── Challenge ──
        address challenger;
        uint256 challengeBond;
        uint256 fullPmProofsVerified;
        uint256 fullTvProofsVerified;

        // ── Phase ──
        Phase phase;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                        STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════

    address public owner;

    /// @notice Fixed coordinator stake (configurable by owner)
    uint256 public coordinatorStake;

    /// @notice Estimated off-chain cost per proof in wei (for challenge bond)
    uint256 public proofCostEstimate;

    /// @notice MACI infrastructure
    IVerifier public verifier;
    IVkRegistry public vkRegistry;

    /// @notice Poll audits
    mapping(uint256 => PollAudit) public pollAudits;
    uint256 public nextPollId;

    /// @notice Reverse mapping: MACI Poll address → RLA Poll ID
    ///         Allows finding the RLA audit for a given MACI poll
    mapping(address => uint256) public pollToAuditId;

    /// @notice PM intermediate sbCommitments per poll.
    ///         pmCommitments[pollId][0] = initial sbCommitment (from Poll),
    ///         pmCommitments[pollId][i] = sbCommitment after batch i.
    mapping(uint256 => mapping(uint256 => uint256)) public pmCommitments;

    /// @notice TV intermediate tallyCommitments per poll.
    ///         tvCommitments[pollId][0] = 0 (initial),
    ///         tvCommitments[pollId][j] = tallyCommitment after tally batch j.
    mapping(uint256 => mapping(uint256 => uint256)) public tvCommitments;

    /// @notice Selected PM batch indices per poll
    mapping(uint256 => mapping(uint256 => uint256)) public pmSelectedBatches;

    /// @notice Selected TV batch indices per poll
    mapping(uint256 => mapping(uint256 => uint256)) public tvSelectedBatches;

    /// @notice Whether a PM batch proof has been verified
    mapping(uint256 => mapping(uint256 => bool)) public pmBatchVerified;

    /// @notice Whether a TV batch proof has been verified
    mapping(uint256 => mapping(uint256 => bool)) public tvBatchVerified;

    // ═══════════════════════════════════════════════════════════════════
    //                           EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event ResultCommitted(
        uint256 indexed pollId,
        address coordinator,
        uint256 yesVotes,
        uint256 noVotes,
        uint256 pmSamples,
        uint256 tvSamples
    );
    event SampleRevealed(uint256 indexed pollId, uint256[] pmIndices, uint256[] tvIndices);
    event BatchProofVerified(uint256 indexed pollId, BatchType batchType, uint256 batchIndex);
    event AuditPassed(uint256 indexed pollId, uint256 challengeDeadline);
    event ChallengeStarted(uint256 indexed pollId, address challenger, uint256 bond);
    event PollFinalized(uint256 indexed pollId, uint256 yesVotes, uint256 noVotes);
    event PollRejected(uint256 indexed pollId, string reason);
    event StakeSlashed(uint256 indexed pollId, address coordinator, uint256 amount);
    event CoordinatorStakeUpdated(uint256 oldStake, uint256 newStake);

    // ═══════════════════════════════════════════════════════════════════
    //                           ERRORS
    // ═══════════════════════════════════════════════════════════════════

    error NotOwner();
    error InsufficientStake();
    error InvalidPhase(Phase expected, Phase actual);
    error ProofDeadlineExceeded();
    error ChallengeResponseDeadlineExceeded();
    error ChallengePeriodNotOver();
    error BatchNotSampled(uint256 batchIndex);
    error BatchAlreadyVerified(uint256 batchIndex);
    error InvalidProof();
    error InsufficientChallengeBond();
    error NoChallengeActive();
    error InvalidBatchIndex();
    error CommitmentsLengthMismatch();
    error SamplingNotComplete();
    error ZeroMarginFullProofRequired();
    error BlockHashNotReady();
    error BlockHashExpired();

    // ═══════════════════════════════════════════════════════════════════
    //                         CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════

    constructor(
        uint256 _coordinatorStake,
        uint256 _proofCostEstimate,
        address _verifier,
        address _vkRegistry
    ) {
        owner = msg.sender;
        coordinatorStake = _coordinatorStake;
        proofCostEstimate = _proofCostEstimate;
        verifier = IVerifier(_verifier);
        vkRegistry = IVkRegistry(_vkRegistry);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      PHASE 1: COMMIT
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Coordinator commits the claimed result and all intermediate
    ///         state commitments. Must stake exactly `coordinatorStake` ETH.
    /// @param _poll The MACI Poll contract for this election
    /// @param _pmCommitments Array of PM state commitments.
    ///        [0] = initial sbCommitment (from Poll), [1..N] = after each batch.
    /// @param _tvCommitments Array of TV tally commitments.
    ///        [0] = 0 (initial), [1..M] = after each tally batch.
    /// @param _yesVotes Claimed total Yes votes
    /// @param _noVotes Claimed total No votes
    function commitResult(
        IPoll _poll,
        uint256[] calldata _pmCommitments,
        uint256[] calldata _tvCommitments,
        uint256 _yesVotes,
        uint256 _noVotes
    ) external payable {
        if (msg.value < coordinatorStake) revert InsufficientStake();

        // Derive batch sizes from Poll's tree parameters
        (uint8 intStateTreeDepth, uint8 msgTreeSubDepth, , ) = _poll.treeDepths();
        uint256 pmBatchSize = MSG_TREE_ARITY ** msgTreeSubDepth;
        uint256 tvBatchSize = TALLY_TREE_ARITY ** intStateTreeDepth;

        // pmCommitments has pmBatchCount+1 entries (initial + one per batch)
        uint256 pmBatchCount = _pmCommitments.length - 1;
        // tvCommitments has tvBatchCount+1 entries (initial + one per batch)
        uint256 tvBatchCount = _tvCommitments.length - 1;

        if (pmBatchCount == 0 || tvBatchCount == 0) revert CommitmentsLengthMismatch();

        // Calculate sample counts based on margin
        uint256 totalVotes = _yesVotes + _noVotes;
        uint256 margin = _yesVotes > _noVotes
            ? _yesVotes - _noVotes
            : _noVotes - _yesVotes;

        (uint256 pmSamples, uint256 tvSamples) = _calcSampleCounts(
            margin,
            totalVotes,
            pmBatchCount,
            tvBatchCount,
            pmBatchSize,
            tvBatchSize
        );

        // Store poll audit
        uint256 pollId = nextPollId++;

        // Store reverse mapping: MACI Poll address → RLA Poll ID
        pollToAuditId[address(_poll)] = pollId;

        PollAudit storage audit = pollAudits[pollId];
        audit.coordinator = msg.sender;
        audit.poll = _poll;
        audit.stakeAmount = msg.value;
        audit.yesVotes = _yesVotes;
        audit.noVotes = _noVotes;
        audit.pmBatchCount = pmBatchCount;
        audit.tvBatchCount = tvBatchCount;
        audit.pmBatchSize = pmBatchSize;
        audit.tvBatchSize = tvBatchSize;
        audit.pmSampleCount = pmSamples;
        audit.tvSampleCount = tvSamples;
        audit.commitHash = keccak256(abi.encode(
            _pmCommitments, _tvCommitments, _yesVotes, _noVotes
        ));
        audit.commitBlock = block.number;
        audit.phase = Phase.Committed;

        // Store all intermediate commitments
        for (uint256 i = 0; i < _pmCommitments.length; i++) {
            pmCommitments[pollId][i] = _pmCommitments[i];
        }
        for (uint256 j = 0; j < _tvCommitments.length; j++) {
            tvCommitments[pollId][j] = _tvCommitments[j];
        }

        emit ResultCommitted(pollId, msg.sender, _yesVotes, _noVotes, pmSamples, tvSamples);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                    PHASE 2: REVEAL SAMPLE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Derive random batch indices using blockhash-based randomness.
    ///         Must be called after BLOCK_HASH_DELAY blocks from commitResult(),
    ///         and before the blockhash expires (within BLOCK_HASH_WINDOW blocks).
    /// @param _pollId The poll audit ID
    function revealSample(uint256 _pollId) external {
        PollAudit storage audit = pollAudits[_pollId];
        if (audit.phase != Phase.Committed)
            revert InvalidPhase(Phase.Committed, audit.phase);

        uint256 seedBlock = audit.commitBlock + BLOCK_HASH_DELAY;
        if (block.number <= seedBlock) revert BlockHashNotReady();
        if (block.number > seedBlock + BLOCK_HASH_WINDOW) revert BlockHashExpired();

        bytes32 seed = keccak256(abi.encode(audit.commitHash, blockhash(seedBlock)));

        // Select PM batch indices (1-indexed: batch 1..pmBatchCount)
        uint256[] memory pmIndices = _selectIndices(
            seed, "PM", audit.pmSampleCount, audit.pmBatchCount
        );
        for (uint256 i = 0; i < pmIndices.length; i++) {
            pmSelectedBatches[_pollId][i] = pmIndices[i];
        }

        // Select TV batch indices (1-indexed: batch 1..tvBatchCount)
        uint256[] memory tvIndices = _selectIndices(
            seed, "TV", audit.tvSampleCount, audit.tvBatchCount
        );
        for (uint256 i = 0; i < tvIndices.length; i++) {
            tvSelectedBatches[_pollId][i] = tvIndices[i];
        }

        audit.phase = Phase.SampleRevealed;
        audit.proofDeadline = block.timestamp + PROOF_DEADLINE;

        emit SampleRevealed(_pollId, pmIndices, tvIndices);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                   PHASE 3: SUBMIT BATCH PROOFS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Coordinator submits a Groth16 proof for a sampled PM batch.
    /// @param _pollId The poll audit ID
    /// @param _sampleIndex Index within the pmSelectedBatches array
    /// @param _proof The packed Groth16 proof [8 uint256s]
    function submitPmProof(
        uint256 _pollId,
        uint256 _sampleIndex,
        uint256[8] calldata _proof
    ) external {
        PollAudit storage audit = pollAudits[_pollId];
        if (audit.phase != Phase.SampleRevealed && audit.phase != Phase.Challenged)
            revert InvalidPhase(Phase.SampleRevealed, audit.phase);

        uint256 batchIndex = pmSelectedBatches[_pollId][_sampleIndex];
        if (batchIndex == 0 || batchIndex > audit.pmBatchCount)
            revert InvalidBatchIndex();
        if (pmBatchVerified[_pollId][batchIndex])
            revert BatchAlreadyVerified(batchIndex);

        _verifyPmBatch(audit.poll, _pollId, batchIndex, _proof);

        pmBatchVerified[_pollId][batchIndex] = true;

        if (audit.phase == Phase.SampleRevealed) {
            audit.pmProofsVerified++;
        } else {
            audit.fullPmProofsVerified++;
        }

        emit BatchProofVerified(_pollId, BatchType.ProcessMessages, batchIndex);
    }

    /// @notice Coordinator submits a Groth16 proof for a sampled TV batch.
    /// @param _pollId The poll audit ID
    /// @param _sampleIndex Index within the tvSelectedBatches array
    /// @param _proof The packed Groth16 proof [8 uint256s]
    function submitTvProof(
        uint256 _pollId,
        uint256 _sampleIndex,
        uint256[8] calldata _proof
    ) external {
        PollAudit storage audit = pollAudits[_pollId];
        if (audit.phase != Phase.SampleRevealed && audit.phase != Phase.Challenged)
            revert InvalidPhase(Phase.SampleRevealed, audit.phase);

        uint256 batchIndex = tvSelectedBatches[_pollId][_sampleIndex];
        if (batchIndex == 0 || batchIndex > audit.tvBatchCount)
            revert InvalidBatchIndex();
        if (tvBatchVerified[_pollId][batchIndex])
            revert BatchAlreadyVerified(batchIndex);

        _verifyTvBatch(audit.poll, _pollId, audit.pmBatchCount, audit.tvBatchSize, batchIndex, _proof);

        tvBatchVerified[_pollId][batchIndex] = true;

        if (audit.phase == Phase.SampleRevealed) {
            audit.tvProofsVerified++;
        } else {
            audit.fullTvProofsVerified++;
        }

        emit BatchProofVerified(_pollId, BatchType.TallyVotes, batchIndex);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                  PHASE 4: FINALIZE SAMPLING
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Called after all sampled proofs are verified.
    ///         Starts the 7-day challenge period.
    /// @param _pollId The poll audit ID
    function finalizeSampling(uint256 _pollId) external {
        PollAudit storage audit = pollAudits[_pollId];
        if (audit.phase != Phase.SampleRevealed)
            revert InvalidPhase(Phase.SampleRevealed, audit.phase);

        if (
            audit.pmProofsVerified < audit.pmSampleCount ||
            audit.tvProofsVerified < audit.tvSampleCount
        ) revert SamplingNotComplete();

        audit.phase = Phase.Tentative;
        audit.tentativeTimestamp = block.timestamp;

        emit AuditPassed(_pollId, block.timestamp + CHALLENGE_PERIOD);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      PHASE 5: CHALLENGE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Anyone can challenge the result by posting a bond.
    ///         Bond = 1.5 × proofCostEstimate × remaining unverified batches.
    /// @param _pollId The poll audit ID
    function challenge(uint256 _pollId) external payable {
        PollAudit storage audit = pollAudits[_pollId];
        if (audit.phase != Phase.Tentative)
            revert InvalidPhase(Phase.Tentative, audit.phase);

        uint256 remainingBatches = (audit.pmBatchCount - audit.pmSampleCount)
            + (audit.tvBatchCount - audit.tvSampleCount);
        uint256 requiredBond = (remainingBatches * proofCostEstimate * 3) / 2;

        if (msg.value < requiredBond) revert InsufficientChallengeBond();

        audit.phase = Phase.Challenged;
        audit.challenger = msg.sender;
        audit.challengeBond = msg.value;
        audit.challengeDeadline = block.timestamp + CHALLENGE_RESPONSE_DEADLINE;

        emit ChallengeStarted(_pollId, msg.sender, msg.value);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                 PHASE 6: RESPOND TO CHALLENGE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Coordinator submits proof for a PM batch during challenge response.
    ///         Can submit proofs for ALL batches (not just previously sampled ones).
    /// @param _pollId The poll audit ID
    /// @param _batchIndex The 1-based PM batch index to prove
    /// @param _proof The packed Groth16 proof
    function submitPmProofForChallenge(
        uint256 _pollId,
        uint256 _batchIndex,
        uint256[8] calldata _proof
    ) external {
        PollAudit storage audit = pollAudits[_pollId];
        if (audit.phase != Phase.Challenged)
            revert InvalidPhase(Phase.Challenged, audit.phase);
        if (block.timestamp > audit.challengeDeadline)
            revert ChallengeResponseDeadlineExceeded();
        if (_batchIndex == 0 || _batchIndex > audit.pmBatchCount)
            revert InvalidBatchIndex();
        if (pmBatchVerified[_pollId][_batchIndex])
            revert BatchAlreadyVerified(_batchIndex);

        // verify reverts on invalid proof in sampling phase;
        // during challenge, a failed proof means coordinator cheated
        bool valid = _verifyPmBatchSafe(audit.poll, _pollId, _batchIndex, _proof);
        if (!valid) {
            _rejectAndSlash(_pollId, "PM proof failed during challenge");
            return;
        }

        pmBatchVerified[_pollId][_batchIndex] = true;
        audit.fullPmProofsVerified++;

        emit BatchProofVerified(_pollId, BatchType.ProcessMessages, _batchIndex);
    }

    /// @notice Coordinator submits proof for a TV batch during challenge response.
    /// @param _pollId The poll audit ID
    /// @param _batchIndex The 1-based TV batch index to prove
    /// @param _proof The packed Groth16 proof
    function submitTvProofForChallenge(
        uint256 _pollId,
        uint256 _batchIndex,
        uint256[8] calldata _proof
    ) external {
        PollAudit storage audit = pollAudits[_pollId];
        if (audit.phase != Phase.Challenged)
            revert InvalidPhase(Phase.Challenged, audit.phase);
        if (block.timestamp > audit.challengeDeadline)
            revert ChallengeResponseDeadlineExceeded();
        if (_batchIndex == 0 || _batchIndex > audit.tvBatchCount)
            revert InvalidBatchIndex();
        if (tvBatchVerified[_pollId][_batchIndex])
            revert BatchAlreadyVerified(_batchIndex);

        bool valid = _verifyTvBatchSafe(
            audit.poll, _pollId, audit.pmBatchCount, audit.tvBatchSize, _batchIndex, _proof
        );
        if (!valid) {
            _rejectAndSlash(_pollId, "TV proof failed during challenge");
            return;
        }

        tvBatchVerified[_pollId][_batchIndex] = true;
        audit.fullTvProofsVerified++;

        emit BatchProofVerified(_pollId, BatchType.TallyVotes, _batchIndex);
    }

    /// @notice Coordinator calls this after submitting all remaining proofs
    ///         to finalize the challenge response.
    /// @param _pollId The poll audit ID
    function finalizeChallengeResponse(uint256 _pollId) external {
        PollAudit storage audit = pollAudits[_pollId];
        if (audit.phase != Phase.Challenged)
            revert InvalidPhase(Phase.Challenged, audit.phase);

        // Check all batches are verified
        uint256 totalPmVerified = audit.pmProofsVerified + audit.fullPmProofsVerified;
        uint256 totalTvVerified = audit.tvProofsVerified + audit.fullTvProofsVerified;

        if (
            totalPmVerified < audit.pmBatchCount ||
            totalTvVerified < audit.tvBatchCount
        ) revert SamplingNotComplete();

        // All proofs verified — coordinator was honest.
        // Challenger loses bond, which goes to coordinator.
        audit.phase = Phase.Finalized;

        uint256 payout = audit.stakeAmount + audit.challengeBond;
        (bool sent, ) = audit.coordinator.call{value: payout}("");
        require(sent, "Transfer failed");

        emit PollFinalized(_pollId, audit.yesVotes, audit.noVotes);
    }

    /// @notice If coordinator fails to respond to challenge before deadline,
    ///         anyone can call this to reject the result.
    /// @param _pollId The poll audit ID
    function claimChallengeTimeout(uint256 _pollId) external {
        PollAudit storage audit = pollAudits[_pollId];
        if (audit.phase != Phase.Challenged)
            revert InvalidPhase(Phase.Challenged, audit.phase);
        if (block.timestamp <= audit.challengeDeadline)
            revert ChallengePeriodNotOver();

        uint256 totalPmVerified = audit.pmProofsVerified + audit.fullPmProofsVerified;
        uint256 totalTvVerified = audit.tvProofsVerified + audit.fullTvProofsVerified;

        if (
            totalPmVerified >= audit.pmBatchCount &&
            totalTvVerified >= audit.tvBatchCount
        ) {
            // All proofs were actually submitted — should use finalizeChallengeResponse
            revert SamplingNotComplete();
        }

        // Coordinator failed to provide full proof in time
        _rejectAndSlash(_pollId, "Challenge response timeout");
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      PHASE 7: FINALIZE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice After the challenge period expires with no challenge,
    ///         the result is finalized and stake is returned.
    /// @param _pollId The poll audit ID
    function finalize(uint256 _pollId) external {
        PollAudit storage audit = pollAudits[_pollId];
        if (audit.phase != Phase.Tentative)
            revert InvalidPhase(Phase.Tentative, audit.phase);
        if (block.timestamp < audit.tentativeTimestamp + CHALLENGE_PERIOD)
            revert ChallengePeriodNotOver();

        audit.phase = Phase.Finalized;

        // Return stake to coordinator
        (bool sent, ) = audit.coordinator.call{value: audit.stakeAmount}("");
        require(sent, "Transfer failed");

        emit PollFinalized(_pollId, audit.yesVotes, audit.noVotes);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Update the coordinator stake amount
    /// @param _newStake New stake amount in wei
    function setCoordinatorStake(uint256 _newStake) external {
        if (msg.sender != owner) revert NotOwner();
        uint256 old = coordinatorStake;
        coordinatorStake = _newStake;
        emit CoordinatorStakeUpdated(old, _newStake);
    }

    /// @notice Update the estimated proof cost (for challenge bond calculation)
    /// @param _newCost New cost per proof in wei
    function setProofCostEstimate(uint256 _newCost) external {
        if (msg.sender != owner) revert NotOwner();
        proofCostEstimate = _newCost;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                    VIEW / PURE HELPERS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Get the number of required samples for a given margin.
    /// @param _pollId The poll audit ID
    /// @return pmSamples Number of PM batches to sample
    /// @return tvSamples Number of TV batches to sample
    function getSampleCounts(uint256 _pollId) external view returns (uint256 pmSamples, uint256 tvSamples) {
        PollAudit storage audit = pollAudits[_pollId];
        return (audit.pmSampleCount, audit.tvSampleCount);
    }

    /// @notice Get the selected batch indices for a poll
    /// @param _pollId The poll audit ID
    /// @return pmIndices Array of selected PM batch indices
    /// @return tvIndices Array of selected TV batch indices
    function getSelectedBatches(uint256 _pollId) external view returns (
        uint256[] memory pmIndices,
        uint256[] memory tvIndices
    ) {
        PollAudit storage audit = pollAudits[_pollId];
        pmIndices = new uint256[](audit.pmSampleCount);
        tvIndices = new uint256[](audit.tvSampleCount);
        for (uint256 i = 0; i < audit.pmSampleCount; i++) {
            pmIndices[i] = pmSelectedBatches[_pollId][i];
        }
        for (uint256 i = 0; i < audit.tvSampleCount; i++) {
            tvIndices[i] = tvSelectedBatches[_pollId][i];
        }
    }

    /// @notice Calculate the required challenge bond for a poll
    /// @param _pollId The poll audit ID
    /// @return bond The required bond in wei
    function getChallengeBondAmount(uint256 _pollId) external view returns (uint256 bond) {
        PollAudit storage audit = pollAudits[_pollId];
        uint256 remainingBatches = (audit.pmBatchCount - audit.pmSampleCount)
            + (audit.tvBatchCount - audit.tvSampleCount);
        bond = (remainingBatches * proofCostEstimate * 3) / 2;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                     INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    /// @dev Calculate PM and TV sample counts from margin.
    ///      Formula: K = ceil(3 × N / M)
    ///      where M = ceil(votesToFlip / batchSize)
    ///      and votesToFlip = margin / 2 + 1
    ///
    ///      If margin is 0 (tie), all batches must be proven (full proof).
    ///      Approximation: uses -ln(0.05) ≈ 3 (actually 2.996).
    ///      This slightly overestimates K (more conservative = more secure).
    ///
    ///      IMPORTANT: When batchCount > 1, samples are capped at batchCount - 1
    ///      to always reserve at least one unsampled batch. This ensures the
    ///      challenge mechanism remains viable (there is always something left
    ///      for a challenger to demand proof of). With a single batch, full
    ///      proof is required since there is no room for sampling.
    function _calcSampleCounts(
        uint256 _margin,
        uint256 _totalVotes,
        uint256 _pmBatchCount,
        uint256 _tvBatchCount,
        uint256 /* _pmBatchSize */,
        uint256 _tvBatchSize
    ) internal pure returns (uint256 pmSamples, uint256 tvSamples) {
        if (_totalVotes == 0) return (0, 0);

        // Margin 0 = tie → require full proof for both PM and TV
        if (_margin == 0) return (_pmBatchCount, _tvBatchCount);

        // Maximum samples: leave at least 1 unsampled batch when possible
        uint256 tvMaxSamples = _tvBatchCount > 1 ? _tvBatchCount - 1 : _tvBatchCount;

        // Minimum votes that must be changed to flip the result
        uint256 votesToFlip = _margin / 2 + 1;

        // PM: Sequential dependency requires full verification
        // PM batches form a commitment chain where each batch depends on the previous state
        // Sampling intermediate batches would not detect manipulation in earlier batches
        // Therefore, all PM batches must be verified
        pmSamples = _pmBatchCount;

        // TV: how many batches must be corrupted to flip?
        uint256 tvCorrupt = (votesToFlip + _tvBatchSize - 1) / _tvBatchSize;
        if (tvCorrupt > _tvBatchCount) tvCorrupt = _tvBatchCount;
        tvSamples = (CONFIDENCE_X1000 * _tvBatchCount + tvCorrupt * 1000 - 1) / (tvCorrupt * 1000);
        if (tvSamples > tvMaxSamples) tvSamples = tvMaxSamples;
    }

    /// @dev Select K unique indices from [1..N] using a seed.
    ///      Uses Fisher-Yates-like sampling: hash(seed, prefix, i) → index.
    ///      Deduplication via retry with incrementing nonce.
    function _selectIndices(
        bytes32 _seed,
        bytes memory _prefix,
        uint256 _count,
        uint256 _total
    ) internal pure returns (uint256[] memory indices) {
        if (_count >= _total) {
            // Sample all — return [1..total]
            indices = new uint256[](_total);
            for (uint256 i = 0; i < _total; i++) {
                indices[i] = i + 1;
            }
            return indices;
        }

        indices = new uint256[](_count);
        uint256 found = 0;
        uint256 nonce = 0;

        while (found < _count) {
            uint256 raw = uint256(keccak256(abi.encodePacked(_seed, _prefix, nonce)));
            uint256 idx = (raw % _total) + 1; // 1-based index
            nonce++;

            // Check for duplicates
            bool dup = false;
            for (uint256 j = 0; j < found; j++) {
                if (indices[j] == idx) {
                    dup = true;
                    break;
                }
            }
            if (!dup) {
                indices[found] = idx;
                found++;
            }
        }
    }

    /// @dev Verify a PM batch proof. Reverts on invalid proof.
    function _verifyPmBatch(
        IPoll _poll,
        uint256 _pollId,
        uint256 _batchIndex,
        uint256[8] calldata _proof
    ) internal view {
        if (!_verifyPmBatchSafe(_poll, _pollId, _batchIndex, _proof))
            revert InvalidProof();
    }

    /// @dev Verify a PM batch proof. Returns false on invalid proof (no revert).
    function _verifyPmBatchSafe(
        IPoll _poll,
        uint256 _pollId,
        uint256 _batchIndex,
        uint256[8] calldata _proof
    ) internal view returns (bool) {
        uint256[] memory pubInputs = _buildPmPublicInputs(_poll, _pollId, _batchIndex);
        VerifyingKey memory vk = _getPmVerifyingKey(_poll);
        return verifier.verify(_proof, vk, pubInputs);
    }

    /// @dev Verify a TV batch proof. Reverts on invalid proof.
    function _verifyTvBatch(
        IPoll _poll,
        uint256 _pollId,
        uint256 _pmBatchCount,
        uint256 _tvBatchSize,
        uint256 _batchIndex,
        uint256[8] calldata _proof
    ) internal view {
        if (!_verifyTvBatchSafe(_poll, _pollId, _pmBatchCount, _tvBatchSize, _batchIndex, _proof))
            revert InvalidProof();
    }

    /// @dev Verify a TV batch proof. Returns false on invalid proof (no revert).
    function _verifyTvBatchSafe(
        IPoll _poll,
        uint256 _pollId,
        uint256 _pmBatchCount,
        uint256 _tvBatchSize,
        uint256 _batchIndex,
        uint256[8] calldata _proof
    ) internal view returns (bool) {
        uint256[] memory pubInputs = _buildTvPublicInputs(
            _poll, _pollId, _pmBatchCount, _tvBatchSize, _batchIndex
        );
        VerifyingKey memory vk = _getTvVerifyingKey(_poll);
        return verifier.verify(_proof, vk, pubInputs);
    }

    /// @dev Get the ProcessMessages verifying key from VkRegistry.
    function _getPmVerifyingKey(IPoll _poll) internal view returns (VerifyingKey memory vk) {
        (, uint8 msgTreeSubDepth, uint8 msgTreeDepth, uint8 voteOptionTreeDepth) = _poll.treeDepths();
        (IMACI maci, ) = _poll.extContracts();
        vk = vkRegistry.getProcessVk(
            maci.stateTreeDepth(),
            msgTreeDepth,
            voteOptionTreeDepth,
            MSG_TREE_ARITY ** msgTreeSubDepth,
            Mode.QV
        );
    }

    /// @dev Get the TallyVotes verifying key from VkRegistry.
    function _getTvVerifyingKey(IPoll _poll) internal view returns (VerifyingKey memory vk) {
        (uint8 intStateTreeDepth, , , uint8 voteOptionTreeDepth) = _poll.treeDepths();
        (IMACI maci, ) = _poll.extContracts();
        vk = vkRegistry.getTallyVk(
            maci.stateTreeDepth(),
            intStateTreeDepth,
            voteOptionTreeDepth,
            Mode.QV
        );
    }

    /// @dev Build public circuit inputs for a ProcessMessages batch.
    ///      Uses scoping blocks to stay within EVM stack limits.
    ///      Public inputs (9): numSignUps, pollEndTimestamp, msgRoot,
    ///      actualStateTreeDepth, batchEndIndex, currentMessageBatchIndex,
    ///      coordinatorPubKeyHash, currentSbCommitment, newSbCommitment
    function _buildPmPublicInputs(
        IPoll _poll,
        uint256 _pollId,
        uint256 _batchIndex
    ) internal view returns (uint256[] memory pubInputs) {
        pubInputs = new uint256[](9);

        // Scope 1: signups + timestamp
        {
            (uint256 numSignUps, ) = _poll.numSignUpsAndMessages();
            (uint256 deployTime, uint256 duration) = _poll.getDeployTimeAndDuration();
            pubInputs[0] = numSignUps;
            pubInputs[1] = deployTime + duration;
        }

        // Scope 2: msgRoot
        {
            (, , uint8 msgTreeDepth, ) = _poll.treeDepths();
            (, AccQueue messageAq) = _poll.extContracts();
            pubInputs[2] = messageAq.getMainRoot(msgTreeDepth);
        }

        pubInputs[3] = _poll.actualStateTreeDepth();
        pubInputs[6] = _poll.coordinatorPubKeyHash();

        // Scope 3: batch index calculation (MACI processes in reverse)
        {
            (, uint8 msgTreeSubDepth, , ) = _poll.treeDepths();
            uint256 batchSize = MSG_TREE_ARITY ** msgTreeSubDepth;
            (, uint256 numMessages) = _poll.numSignUpsAndMessages();

            uint256 r = numMessages % batchSize;
            uint256 lastBatchStart = r == 0
                ? numMessages - batchSize
                : numMessages - r;
            uint256 msgBatchIdx = lastBatchStart - (_batchIndex - 1) * batchSize;
            uint256 batchEnd = msgBatchIdx + batchSize;
            if (batchEnd > numMessages) batchEnd = numMessages;

            pubInputs[4] = batchEnd;
            pubInputs[5] = msgBatchIdx;
        }

        // State commitments from coordinator's committed data
        pubInputs[7] = pmCommitments[_pollId][_batchIndex - 1];
        pubInputs[8] = pmCommitments[_pollId][_batchIndex];
    }

    /// @dev Build public circuit inputs for a TallyVotes batch.
    ///      Public inputs (5): sbCommitment, currentTallyCommitment,
    ///      newTallyCommitment, batchStartIndex, numSignUps
    function _buildTvPublicInputs(
        IPoll _poll,
        uint256 _pollId,
        uint256 _pmBatchCount,
        uint256 _tvBatchSize,
        uint256 _batchIndex
    ) internal view returns (uint256[] memory pubInputs) {
        (uint256 numSignUps, ) = _poll.numSignUpsAndMessages();

        pubInputs = new uint256[](5);
        pubInputs[0] = pmCommitments[_pollId][_pmBatchCount]; // final sbCommitment
        pubInputs[1] = tvCommitments[_pollId][_batchIndex - 1];
        pubInputs[2] = tvCommitments[_pollId][_batchIndex];
        pubInputs[3] = (_batchIndex - 1) * _tvBatchSize;
        pubInputs[4] = numSignUps;
    }

    /// @dev Reject the result and slash the coordinator's stake.
    ///      Stake goes to challenger (if exists) or is burned.
    function _rejectAndSlash(uint256 _pollId, string memory _reason) internal {
        PollAudit storage audit = pollAudits[_pollId];
        audit.phase = Phase.Rejected;

        emit PollRejected(_pollId, _reason);
        emit StakeSlashed(_pollId, audit.coordinator, audit.stakeAmount);

        if (audit.challenger != address(0)) {
            // Challenger gets: their bond back + coordinator's stake
            uint256 payout = audit.challengeBond + audit.stakeAmount;
            (bool sent, ) = audit.challenger.call{value: payout}("");
            require(sent, "Transfer failed");
        }
        // If no challenger (failed during sampling), stake is locked in contract.
        // Owner can recover via a separate mechanism if needed.
    }
}
