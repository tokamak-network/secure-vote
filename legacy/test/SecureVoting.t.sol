// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/SecureVoting.sol";
import "../src/eligibility/WhitelistEligibility.sol";

contract SecureVotingTest is Test {
    SecureVoting public voting;
    WhitelistEligibility public eligibility;

    address[] public committee;
    address public member1 = address(0x1);
    address public member2 = address(0x2);
    address public member3 = address(0x3);
    address public member4 = address(0x4);
    address public member5 = address(0x5);

    address public voter1 = address(0x100);
    address public voter2 = address(0x200);

    uint256 public constant THRESHOLD = 3;
    bytes public publicKey = hex"1234567890abcdef";

    function setUp() public {
        // Setup committee
        committee.push(member1);
        committee.push(member2);
        committee.push(member3);
        committee.push(member4);
        committee.push(member5);

        // Deploy eligibility
        eligibility = new WhitelistEligibility(committee);

        // Deploy voting contract
        voting = new SecureVoting(committee, THRESHOLD, publicKey, eligibility);

        // Give ETH to members for bonds
        vm.deal(member1, 100 ether);
        vm.deal(member2, 100 ether);
        vm.deal(member3, 100 ether);
        vm.deal(member4, 100 ether);
        vm.deal(member5, 100 ether);

        // Members deposit bonds
        vm.prank(member1);
        voting.depositBond{value: 10 ether}();
        vm.prank(member2);
        voting.depositBond{value: 10 ether}();
        vm.prank(member3);
        voting.depositBond{value: 10 ether}();
    }

    // ============ Basic Tests ============

    function test_Deployment() public view {
        assertEq(voting.currentCommitteeId(), 0);
        assertEq(voting.getCurrentThreshold(), THRESHOLD);
        address[] memory members = voting.getCurrentCommittee();
        assertEq(members.length, 5);
        assertEq(members[0], member1);
    }

    function test_CreateProposal() public {
        uint256 proposalId = voting.createProposal("Test Proposal", 1 days, 1 days);
        assertEq(proposalId, 0);

        (
            string memory description,
            uint256 committeeId,
            uint256 createdAt,
            uint256 commitEndTime,
            uint256 revealEndTime,
            bool finalized
        ) = voting.proposals(proposalId);

        assertEq(description, "Test Proposal");
        assertEq(committeeId, 0);
        assertEq(finalized, false);
        assertGt(commitEndTime, createdAt);
        assertGt(revealEndTime, commitEndTime);
    }

    function test_CommitVote() public {
        uint256 proposalId = voting.createProposal("Test", 1 days, 1 days);

        bytes memory ciphertext = hex"abcdef1234567890";
        vm.prank(voter1);
        voting.commitVote(proposalId, ciphertext);

        // Verify vote was recorded
        (bytes memory storedCiphertext, uint256 timestamp) =
            voting.encryptedVotes(proposalId, voter1);
        assertEq(storedCiphertext, ciphertext);
        assertGt(timestamp, 0);
    }

    function test_VoteOverwrite() public {
        uint256 proposalId = voting.createProposal("Test", 1 days, 1 days);

        // First vote
        bytes memory ciphertext1 = hex"1111";
        vm.prank(voter1);
        voting.commitVote(proposalId, ciphertext1);

        uint256 timestamp1;
        (, timestamp1) = voting.encryptedVotes(proposalId, voter1);

        // Wait a bit
        vm.warp(block.timestamp + 100);

        // Second vote (overwrite)
        bytes memory ciphertext2 = hex"2222";
        vm.prank(voter1);
        voting.commitVote(proposalId, ciphertext2);

        // Verify overwrite
        (bytes memory storedCiphertext, uint256 timestamp2) =
            voting.encryptedVotes(proposalId, voter1);
        assertEq(storedCiphertext, ciphertext2);
        assertGt(timestamp2, timestamp1);
    }

    function test_CannotCommitAfterDeadline() public {
        uint256 proposalId = voting.createProposal("Test", 1 days, 1 days);

        // Fast forward past commit deadline
        vm.warp(block.timestamp + 2 days);

        bytes memory ciphertext = hex"abcd";
        vm.prank(voter1);
        vm.expectRevert(SecureVoting.CommitPeriodEnded.selector);
        voting.commitVote(proposalId, ciphertext);
    }

    function test_SubmitTally() public {
        uint256 proposalId = voting.createProposal("Test", 1 days, 1 days);

        // Commit some votes
        vm.prank(voter1);
        voting.commitVote(proposalId, hex"1111");
        vm.prank(voter2);
        voting.commitVote(proposalId, hex"2222");

        // Fast forward past commit period
        vm.warp(block.timestamp + 2 days);

        // Submit tally
        bytes32 votesRoot = keccak256("merkle_root");
        vm.prank(member1);
        voting.submitTally(proposalId, 1, 1, votesRoot);

        // Verify tally
        (
            uint256 yesVotes,
            uint256 noVotes,
            bytes32 storedRoot,
            uint256 submittedAt,
            address submitter,
            bool challenged,
            bool finalized
        ) = voting.tallies(proposalId);

        assertEq(yesVotes, 1);
        assertEq(noVotes, 1);
        assertEq(storedRoot, votesRoot);
        assertEq(submitter, member1);
        assertEq(challenged, false);
        assertEq(finalized, false);
    }

    function test_CannotSubmitTallyWithoutBond() public {
        uint256 proposalId = voting.createProposal("Test", 1 days, 1 days);
        vm.warp(block.timestamp + 2 days);

        // member5 has no bond
        vm.prank(member5);
        vm.expectRevert(SecureVoting.InsufficientBond.selector);
        voting.submitTally(proposalId, 1, 1, bytes32(0));
    }

    function test_FinalizeTally() public {
        uint256 proposalId = voting.createProposal("Test", 1 days, 1 days);
        vm.warp(block.timestamp + 2 days);

        bytes32 votesRoot = keccak256("root");
        vm.prank(member1);
        voting.submitTally(proposalId, 5, 3, votesRoot);

        // Fast forward past challenge period
        vm.warp(block.timestamp + 8 days);

        // Finalize
        voting.finalizeTally(proposalId);

        // Verify finalized
        (,,,,, bool challenged, bool finalized) = voting.tallies(proposalId);
        assertEq(challenged, false);
        assertEq(finalized, true);
    }

    function test_ChallengeTally() public {
        uint256 proposalId = voting.createProposal("Test", 1 days, 1 days);
        vm.warp(block.timestamp + 2 days);

        vm.prank(member1);
        voting.submitTally(proposalId, 10, 5, bytes32(0));

        // Challenge
        address challenger = address(0x999);
        vm.deal(challenger, 10 ether);
        vm.prank(challenger);
        voting.challengeTally{value: 5 ether}(proposalId);

        // Verify challenged
        (,,,,, bool challenged,) = voting.tallies(proposalId);
        assertEq(challenged, true);
        assertEq(voting.challengers(proposalId), challenger);
    }

    // ============ Committee Rotation Tests ============

    function test_ProposeRotation() public {
        // Wait minimum duration
        vm.warp(block.timestamp + 31 days);

        address[] memory newMembers = new address[](3);
        newMembers[0] = member1;
        newMembers[1] = member2;
        newMembers[2] = address(0x6);

        // Add new member to eligibility
        vm.prank(address(this));
        eligibility.addToWhitelist(address(0x6));

        bytes memory newPK = hex"aabbccdd";

        vm.prank(member1);
        voting.proposeCommitteeRotation(newMembers, 2, newPK);

        // Rotation proposal was created (verified by not reverting)
        // Cannot easily verify struct with mapping via auto-getter
    }

    function test_ApproveAndExecuteRotation() public {
        vm.warp(block.timestamp + 31 days);

        address[] memory newMembers = new address[](3);
        newMembers[0] = member1;
        newMembers[1] = member3;
        newMembers[2] = member5;

        vm.prank(member1);
        voting.proposeCommitteeRotation(newMembers, 2, hex"aabbccdd");

        // Approve (need 3/5)
        vm.prank(member1);
        voting.approveRotation();
        vm.prank(member2);
        voting.approveRotation();
        vm.prank(member3);
        voting.approveRotation();

        // Execute
        voting.executeRotation();

        // Verify new committee
        assertEq(voting.currentCommitteeId(), 1);
        address[] memory currentMembers = voting.getCurrentCommittee();
        assertEq(currentMembers.length, 3);
        assertEq(currentMembers[0], member1);
        assertEq(currentMembers[1], member3);
    }

    function test_CannotRotateTooEarly() public {
        address[] memory newMembers = new address[](2);
        newMembers[0] = member1;
        newMembers[1] = member2;

        vm.prank(member1);
        vm.expectRevert(SecureVoting.CommitteeTooNew.selector);
        voting.proposeCommitteeRotation(newMembers, 2, hex"aa");
    }

    // ============ Eligibility Change Tests ============

    function test_ProposeEligibilityChange() public {
        // Create new eligibility contract
        address[] memory newWhitelist = new address[](2);
        newWhitelist[0] = member1; // Keep at least one current member
        newWhitelist[1] = address(0x999);
        WhitelistEligibility newEligibility = new WhitelistEligibility(newWhitelist);

        vm.prank(member1);
        voting.proposeEligibilityChange(newEligibility);

        // Proposal created (verified by not reverting)
    }

    function test_ApproveAndExecuteEligibilityChange() public {
        address[] memory newWhitelist = new address[](2);
        newWhitelist[0] = member1;
        newWhitelist[1] = member2;
        WhitelistEligibility newEligibility = new WhitelistEligibility(newWhitelist);

        vm.prank(member1);
        voting.proposeEligibilityChange(newEligibility);

        // Approve
        vm.prank(member1);
        voting.approveEligibilityChange();
        vm.prank(member2);
        voting.approveEligibilityChange();
        vm.prank(member3);
        voting.approveEligibilityChange();

        // Execute
        voting.executeEligibilityChange();

        // Verify change
        assertEq(address(voting.eligibilityContract()), address(newEligibility));
    }

    // ============ Fuzzing Tests ============

    function testFuzz_CommitVote(bytes calldata ciphertext) public {
        uint256 proposalId = voting.createProposal("Fuzz Test", 1 days, 1 days);

        vm.assume(ciphertext.length > 0);
        vm.assume(ciphertext.length < 10000);

        vm.prank(voter1);
        voting.commitVote(proposalId, ciphertext);

        (bytes memory stored,) = voting.encryptedVotes(proposalId, voter1);
        assertEq(stored, ciphertext);
    }

    function testFuzz_VoteOverwriteTimestamp(uint256 delay) public {
        vm.assume(delay > 0 && delay < 1 days);

        uint256 proposalId = voting.createProposal("Test", 1 days, 1 days);

        vm.prank(voter1);
        voting.commitVote(proposalId, hex"1111");
        (, uint256 time1) = voting.encryptedVotes(proposalId, voter1);

        vm.warp(block.timestamp + delay);

        vm.prank(voter1);
        voting.commitVote(proposalId, hex"2222");
        (, uint256 time2) = voting.encryptedVotes(proposalId, voter1);

        assertGt(time2, time1);
    }
}
