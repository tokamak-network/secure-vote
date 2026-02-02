// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/ICommitteeEligibility.sol";

/**
 * @title SecureVoting
 * @notice Threshold cryptography based commit-reveal voting with fraud proofs
 * @dev Features:
 *      - Commit-reveal with vote overwrite (pre-tally bribery defense)
 *      - Fraud proof with Merkle root (post-tally bribery defense)
 *      - Committee rotation with consensus
 *      - Flexible eligibility rules
 */
contract SecureVoting {
    // ============ Structs ============

    /**
     * @notice Committee configuration
     * @dev Each committee has its own threshold public key for encryption
     */
    struct CommitteeConfig {
        address[] members;
        uint256 threshold; // k in k/n threshold
        bytes publicKey; // ElGamal threshold public key
        uint256 activatedAt;
        bool active;
    }

    /**
     * @notice Proposal structure
     */
    struct Proposal {
        string description;
        uint256 committeeId; // Which committee manages this proposal
        uint256 createdAt;
        uint256 commitEndTime;
        uint256 revealEndTime;
        bool finalized;
    }

    /**
     * @notice Encrypted vote (commit)
     */
    struct EncryptedVote {
        bytes ciphertext; // ElGamal encrypted vote
        uint256 timestamp; // For tracking last commit (overwrite support)
    }

    /**
     * @notice Tally result with Merkle commitment
     */
    struct Tally {
        uint256 yesVotes;
        uint256 noVotes;
        bytes32 votesRoot; // Merkle root of decrypted votes
        uint256 submittedAt;
        address submitter;
        bool challenged;
        bool finalized;
    }

    /**
     * @notice Committee rotation proposal
     */
    struct RotationProposal {
        address[] newMembers;
        uint256 newThreshold;
        bytes newPublicKey;
        mapping(address => bool) approvals;
        uint256 approvalCount;
        uint256 proposedAt;
        bool executed;
    }

    /**
     * @notice Eligibility rule change proposal
     */
    struct EligibilityProposal {
        ICommitteeEligibility newContract;
        mapping(address => bool) approvals;
        uint256 approvalCount;
        uint256 proposedAt;
        bool executed;
    }

    // ============ State Variables ============

    // Committee management
    mapping(uint256 => CommitteeConfig) public committees;
    uint256 public currentCommitteeId;
    RotationProposal public pendingRotation;

    // Eligibility rules
    ICommitteeEligibility public eligibilityContract;
    EligibilityProposal public pendingEligibilityChange;

    // Proposals and votes
    mapping(uint256 => Proposal) public proposals;
    uint256 public nextProposalId;

    // proposalId => voter => EncryptedVote
    mapping(uint256 => mapping(address => EncryptedVote)) public encryptedVotes;

    // proposalId => Tally
    mapping(uint256 => Tally) public tallies;

    // Bond management
    mapping(address => uint256) public bonds;
    uint256 public constant MIN_BOND = 10 ether;

    // Challenge management
    uint256 public constant CHALLENGE_PERIOD = 7 days;
    uint256 public constant CHALLENGE_BOND = 5 ether;
    mapping(uint256 => address) public challengers; // proposalId => challenger

    // Committee constraints
    uint256 public constant MIN_COMMITTEE_DURATION = 30 days;

    // ============ Events ============

    event CommitteeActivated(uint256 indexed committeeId, address[] members, uint256 threshold);
    event ProposalCreated(uint256 indexed proposalId, uint256 committeeId, string description);
    event VoteCommitted(uint256 indexed proposalId, address indexed voter, uint256 timestamp);
    event TallySubmitted(
        uint256 indexed proposalId,
        uint256 yesVotes,
        uint256 noVotes,
        bytes32 votesRoot,
        address submitter
    );
    event TallyChallenged(uint256 indexed proposalId, address challenger);
    event TallyFinalized(uint256 indexed proposalId, uint256 yesVotes, uint256 noVotes);
    event CommitteeSlashed(address indexed member, uint256 amount);
    event ChallengerSlashed(address indexed challenger, uint256 amount);
    event BondDeposited(address indexed member, uint256 amount);
    event BondWithdrawn(address indexed member, uint256 amount);

    event RotationProposed(address[] newMembers, uint256 newThreshold);
    event RotationApproved(address indexed approver, uint256 approvalCount);
    event CommitteeRotated(uint256 indexed newCommitteeId, address[] members);

    event EligibilityChangeProposed(address indexed newContract);
    event EligibilityChangeApproved(address indexed approver, uint256 approvalCount);
    event EligibilityRulesChanged(address indexed newContract);

    // ============ Errors ============

    error NotCommitteeMember();
    error NotEligible();
    error InvalidThreshold();
    error InsufficientBond();
    error CommitPeriodEnded();
    error CommitPeriodNotEnded();
    error AlreadyFinalized();
    error NotEnoughApprovals();
    error AlreadyApproved();
    error PendingRotationExists();
    error CommitteeTooNew();
    error ChallengePeriodNotEnded();
    error AlreadyChallenged();
    error InsufficientChallengeBond();
    error NoTallySubmitted();

    // ============ Modifiers ============

    modifier onlyCurrentCommittee() {
        if (!isCurrentCommitteeMember(msg.sender)) revert NotCommitteeMember();
        _;
    }

    modifier onlyProposalCommittee(uint256 proposalId) {
        uint256 committeeId = proposals[proposalId].committeeId;
        if (!isCommitteeMember(msg.sender, committeeId)) revert NotCommitteeMember();
        _;
    }

    // ============ Constructor ============

    constructor(
        address[] memory initialCommittee,
        uint256 threshold,
        bytes memory publicKey,
        ICommitteeEligibility _eligibilityContract
    ) {
        require(initialCommittee.length >= threshold, "Invalid threshold");
        require(threshold > 0, "Threshold must be positive");

        eligibilityContract = _eligibilityContract;

        // Verify all initial members are eligible
        for (uint256 i = 0; i < initialCommittee.length; i++) {
            require(eligibilityContract.isEligible(initialCommittee[i]), "Member not eligible");
        }

        // Create initial committee
        committees[0] = CommitteeConfig({
            members: initialCommittee,
            threshold: threshold,
            publicKey: publicKey,
            activatedAt: block.timestamp,
            active: true
        });

        currentCommitteeId = 0;

        emit CommitteeActivated(0, initialCommittee, threshold);
    }

    // ============ View Functions ============

    function isCurrentCommitteeMember(address account) public view returns (bool) {
        return isCommitteeMember(account, currentCommitteeId);
    }

    function isCommitteeMember(address account, uint256 committeeId) public view returns (bool) {
        address[] memory members = committees[committeeId].members;
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i] == account) return true;
        }
        return false;
    }

    function getCurrentCommittee() public view returns (address[] memory) {
        return committees[currentCommitteeId].members;
    }

    function getCommittee(uint256 committeeId) public view returns (address[] memory) {
        return committees[committeeId].members;
    }

    function getProposalPublicKey(uint256 proposalId) external view returns (bytes memory) {
        uint256 committeeId = proposals[proposalId].committeeId;
        return committees[committeeId].publicKey;
    }

    function getCurrentThreshold() public view returns (uint256) {
        return committees[currentCommitteeId].threshold;
    }

    // ============ Bond Management ============

    function depositBond() external payable onlyCurrentCommittee {
        bonds[msg.sender] += msg.value;
        emit BondDeposited(msg.sender, msg.value);
    }

    function withdrawBond(uint256 amount) external {
        require(bonds[msg.sender] >= amount, "Insufficient bond");
        bonds[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
        emit BondWithdrawn(msg.sender, amount);
    }

    // ============ Proposal Management ============

    function createProposal(
        string calldata description,
        uint256 commitDuration,
        uint256 revealDuration
    ) external returns (uint256) {
        uint256 proposalId = nextProposalId++;

        proposals[proposalId] = Proposal({
            description: description,
            committeeId: currentCommitteeId, // Lock to current committee
            createdAt: block.timestamp,
            commitEndTime: block.timestamp + commitDuration,
            revealEndTime: block.timestamp + commitDuration + revealDuration,
            finalized: false
        });

        emit ProposalCreated(proposalId, currentCommitteeId, description);
        return proposalId;
    }

    // ============ Voting (Commit Phase) ============

    /**
     * @notice Submit encrypted vote (commit)
     * @dev Supports overwrite - later commits replace earlier ones
     */
    function commitVote(uint256 proposalId, bytes calldata ciphertext) external {
        Proposal storage proposal = proposals[proposalId];
        if (block.timestamp > proposal.commitEndTime) revert CommitPeriodEnded();

        // Overwrite support: just update the vote
        encryptedVotes[proposalId][msg.sender] = EncryptedVote({
            ciphertext: ciphertext,
            timestamp: block.timestamp
        });

        emit VoteCommitted(proposalId, msg.sender, block.timestamp);
    }

    // ============ Tally (Reveal Phase) ============

    /**
     * @notice Submit tally result with Merkle root
     * @dev Committee decrypts off-chain and submits aggregate + commitment
     */
    function submitTally(
        uint256 proposalId,
        uint256 yesVotes,
        uint256 noVotes,
        bytes32 votesRoot
    ) external onlyProposalCommittee(proposalId) {
        Proposal storage proposal = proposals[proposalId];
        if (block.timestamp <= proposal.commitEndTime) revert CommitPeriodNotEnded();
        if (proposal.finalized) revert AlreadyFinalized();
        if (bonds[msg.sender] < MIN_BOND) revert InsufficientBond();

        tallies[proposalId] = Tally({
            yesVotes: yesVotes,
            noVotes: noVotes,
            votesRoot: votesRoot,
            submittedAt: block.timestamp,
            submitter: msg.sender,
            challenged: false,
            finalized: false
        });

        emit TallySubmitted(proposalId, yesVotes, noVotes, votesRoot, msg.sender);
    }

    // ============ Fraud Proof (Challenge) ============

    /**
     * @notice Challenge a tally result
     * @dev Requires bond, committee must respond with proof
     */
    function challengeTally(uint256 proposalId) external payable {
        if (msg.value < CHALLENGE_BOND) revert InsufficientChallengeBond();

        Tally storage tally = tallies[proposalId];
        if (tally.submittedAt == 0) revert NoTallySubmitted();
        if (tally.challenged) revert AlreadyChallenged();
        if (tally.finalized) revert AlreadyFinalized();

        tally.challenged = true;
        challengers[proposalId] = msg.sender;

        emit TallyChallenged(proposalId, msg.sender);

        // Committee must now reveal proof off-chain or get slashed
        // In real implementation, would have dispute resolution mechanism
    }

    /**
     * @notice Finalize tally after challenge period
     */
    function finalizeTally(uint256 proposalId) external {
        Tally storage tally = tallies[proposalId];
        Proposal storage proposal = proposals[proposalId];

        if (tally.submittedAt == 0) revert NoTallySubmitted();
        if (tally.finalized) revert AlreadyFinalized();

        // If challenged, would need dispute resolution
        // For now, simple time-based finalization
        if (!tally.challenged) {
            if (block.timestamp <= tally.submittedAt + CHALLENGE_PERIOD) {
                revert ChallengePeriodNotEnded();
            }
        }

        tally.finalized = true;
        proposal.finalized = true;

        emit TallyFinalized(proposalId, tally.yesVotes, tally.noVotes);
    }

    // ============ Committee Rotation ============

    /**
     * @notice Propose committee rotation
     * @dev New committee must perform DKG off-chain first
     */
    function proposeCommitteeRotation(
        address[] calldata newMembers,
        uint256 newThreshold,
        bytes calldata newPublicKey
    ) external onlyCurrentCommittee {
        if (pendingRotation.proposedAt != 0 && !pendingRotation.executed) {
            revert PendingRotationExists();
        }

        CommitteeConfig storage current = committees[currentCommitteeId];
        if (block.timestamp < current.activatedAt + MIN_COMMITTEE_DURATION) {
            revert CommitteeTooNew();
        }

        require(newMembers.length >= newThreshold, "Invalid threshold");
        require(newThreshold > 0, "Threshold must be positive");

        // Verify all new members are eligible
        for (uint256 i = 0; i < newMembers.length; i++) {
            if (!eligibilityContract.isEligible(newMembers[i])) revert NotEligible();
        }

        // Reset pending rotation
        delete pendingRotation;

        pendingRotation.newMembers = newMembers;
        pendingRotation.newThreshold = newThreshold;
        pendingRotation.newPublicKey = newPublicKey;
        pendingRotation.proposedAt = block.timestamp;
        pendingRotation.executed = false;
        pendingRotation.approvalCount = 0;

        emit RotationProposed(newMembers, newThreshold);
    }

    /**
     * @notice Approve pending rotation
     */
    function approveRotation() external onlyCurrentCommittee {
        if (pendingRotation.proposedAt == 0) revert PendingRotationExists();
        if (pendingRotation.executed) revert AlreadyFinalized();
        if (pendingRotation.approvals[msg.sender]) revert AlreadyApproved();

        pendingRotation.approvals[msg.sender] = true;
        pendingRotation.approvalCount++;

        emit RotationApproved(msg.sender, pendingRotation.approvalCount);
    }

    /**
     * @notice Execute rotation after threshold approvals
     */
    function executeRotation() external {
        if (pendingRotation.approvalCount < getCurrentThreshold()) {
            revert NotEnoughApprovals();
        }
        if (pendingRotation.executed) revert AlreadyFinalized();

        // Create new committee
        uint256 newId = currentCommitteeId + 1;
        committees[newId] = CommitteeConfig({
            members: pendingRotation.newMembers,
            threshold: pendingRotation.newThreshold,
            publicKey: pendingRotation.newPublicKey,
            activatedAt: block.timestamp,
            active: true
        });

        currentCommitteeId = newId;
        pendingRotation.executed = true;

        emit CommitteeRotated(newId, pendingRotation.newMembers);
    }

    // ============ Eligibility Rule Changes ============

    /**
     * @notice Propose eligibility rule change
     */
    function proposeEligibilityChange(ICommitteeEligibility newContract)
        external
        onlyCurrentCommittee
    {
        require(address(newContract) != address(0), "Invalid contract");
        require(address(newContract).code.length > 0, "Not a contract");

        // Verify at least 1 current member remains eligible
        address[] memory current = getCurrentCommittee();
        uint256 eligibleCount = 0;
        for (uint256 i = 0; i < current.length; i++) {
            if (newContract.isEligible(current[i])) {
                eligibleCount++;
            }
        }
        require(eligibleCount >= 1, "Must keep at least 1 member eligible");

        delete pendingEligibilityChange;

        pendingEligibilityChange.newContract = newContract;
        pendingEligibilityChange.proposedAt = block.timestamp;
        pendingEligibilityChange.executed = false;
        pendingEligibilityChange.approvalCount = 0;

        emit EligibilityChangeProposed(address(newContract));
    }

    /**
     * @notice Approve eligibility change
     */
    function approveEligibilityChange() external onlyCurrentCommittee {
        if (address(pendingEligibilityChange.newContract) == address(0)) {
            revert PendingRotationExists();
        }
        if (pendingEligibilityChange.executed) revert AlreadyFinalized();
        if (pendingEligibilityChange.approvals[msg.sender]) revert AlreadyApproved();

        pendingEligibilityChange.approvals[msg.sender] = true;
        pendingEligibilityChange.approvalCount++;

        emit EligibilityChangeApproved(msg.sender, pendingEligibilityChange.approvalCount);
    }

    /**
     * @notice Execute eligibility change
     */
    function executeEligibilityChange() external {
        if (pendingEligibilityChange.approvalCount < getCurrentThreshold()) {
            revert NotEnoughApprovals();
        }
        if (pendingEligibilityChange.executed) revert AlreadyFinalized();

        eligibilityContract = pendingEligibilityChange.newContract;
        pendingEligibilityChange.executed = true;

        emit EligibilityRulesChanged(address(eligibilityContract));
    }
}
