// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/MACIVoting.sol";

contract MACIVotingTest is Test {
    MACIVoting public voting;

    address public coordinator = address(0x1001);
    address public voter1 = address(0x2001);
    address public voter2 = address(0x2002);
    address public voter3 = address(0x2003);
    address public challenger = address(0x3001);

    // Sample BN254 public key (64 bytes)
    bytes public coordinatorPubKey = new bytes(64);
    bytes public voterPubKey1 = new bytes(64);
    bytes public voterPubKey2 = new bytes(64);
    bytes public encryptedData = new bytes(128);
    bytes public ephemeralPubKey = new bytes(64);

    uint256 public coordinatorId;
    uint256 public proposalId;

    function setUp() public {
        voting = new MACIVoting();

        // Initialize test data
        for (uint i = 0; i < 64; i++) {
            coordinatorPubKey[i] = bytes1(uint8(i + 1));
            voterPubKey1[i] = bytes1(uint8(i + 65));
            voterPubKey2[i] = bytes1(uint8(i + 129));
            ephemeralPubKey[i] = bytes1(uint8(i + 193));
        }
        for (uint i = 0; i < 128; i++) {
            encryptedData[i] = bytes1(uint8(i));
        }

        // Fund accounts
        vm.deal(coordinator, 100 ether);
        vm.deal(voter1, 10 ether);
        vm.deal(voter2, 10 ether);
        vm.deal(challenger, 10 ether);

        // Register coordinator
        vm.prank(coordinator);
        coordinatorId = voting.registerCoordinator{value: 10 ether}(coordinatorPubKey);
    }

    // ============ Coordinator Tests ============

    function test_RegisterCoordinator() public view {
        (
            address addr,
            bytes memory pubKey,
            uint256 bond,
            bool active,
        ) = voting.coordinators(coordinatorId);

        assertEq(addr, coordinator);
        assertEq(pubKey, coordinatorPubKey);
        assertEq(bond, 10 ether);
        assertTrue(active);
    }

    function test_RegisterCoordinator_InsufficientBond() public {
        vm.deal(address(0x2), 5 ether);
        vm.prank(address(0x2));
        vm.expectRevert(MACIVoting.InsufficientBond.selector);
        voting.registerCoordinator{value: 5 ether}(coordinatorPubKey);
    }

    function test_RegisterCoordinator_InvalidPubKeyLength() public {
        vm.deal(address(0x2), 15 ether);
        vm.prank(address(0x2));
        vm.expectRevert(MACIVoting.InvalidMessageLength.selector);
        voting.registerCoordinator{value: 15 ether}(new bytes(32)); // Wrong length
    }

    function test_AddBond() public {
        vm.prank(coordinator);
        voting.addBond{value: 5 ether}(coordinatorId);

        (, , uint256 bond, ,) = voting.coordinators(coordinatorId);
        assertEq(bond, 15 ether);
    }

    function test_DeactivateCoordinator() public {
        vm.prank(coordinator);
        voting.deactivateCoordinator(coordinatorId);

        (, , , bool active,) = voting.coordinators(coordinatorId);
        assertFalse(active);
    }

    function test_WithdrawBond() public {
        // Note: Coordinator doesn't need to be deactivated to withdraw
        // Just need to have sufficient bond
        uint256 balanceBefore = coordinator.balance;

        vm.prank(coordinator);
        voting.withdrawBond(coordinatorId, 5 ether);

        assertEq(coordinator.balance, balanceBefore + 5 ether);
        (, , uint256 bond, ,) = voting.coordinators(coordinatorId);
        assertEq(bond, 5 ether);
    }

    // ============ Proposal Tests ============

    function test_CreateProposal() public {
        vm.prank(coordinator);
        proposalId = voting.createProposal(
            coordinatorId,
            "Test Proposal",
            1 days,  // signup duration
            2 days   // voting duration
        );

        (
            string memory description,
            uint256 createdAt,
            uint256 signupEndTime,
            uint256 votingEndTime,
            uint256 coordId,
            bool finalized
        ) = voting.proposals(proposalId);

        assertEq(description, "Test Proposal");
        assertEq(coordId, coordinatorId);
        assertFalse(finalized);
        assertEq(signupEndTime, createdAt + 1 days);
        assertEq(votingEndTime, createdAt + 3 days);
    }

    function test_CreateProposal_NotCoordinator() public {
        vm.prank(voter1);
        vm.expectRevert(MACIVoting.NotCoordinator.selector);
        voting.createProposal(coordinatorId, "Test", 1 days, 1 days);
    }

    // ============ Message Submission Tests ============

    function _createProposal() internal returns (uint256) {
        vm.prank(coordinator);
        return voting.createProposal(coordinatorId, "Test", 1 days, 2 days);
    }

    function test_SubmitMessage() public {
        proposalId = _createProposal();

        vm.prank(voter1);
        voting.submitMessage(proposalId, voterPubKey1, encryptedData, ephemeralPubKey);

        assertEq(voting.getMessageCount(proposalId), 1);

        (
            bytes memory storedPubKey,
            bytes memory storedData,
            bytes memory storedEphemeral,
            uint256 timestamp
        ) = voting.getMessage(proposalId, 0);

        assertEq(storedPubKey, voterPubKey1);
        assertEq(storedData, encryptedData);
        assertEq(storedEphemeral, ephemeralPubKey);
        assertGt(timestamp, 0);
    }

    function test_SubmitMultipleMessages() public {
        proposalId = _createProposal();

        vm.prank(voter1);
        voting.submitMessage(proposalId, voterPubKey1, encryptedData, ephemeralPubKey);

        vm.prank(voter2);
        voting.submitMessage(proposalId, voterPubKey2, encryptedData, ephemeralPubKey);

        // Same voter can submit again (key change)
        vm.prank(voter1);
        voting.submitMessage(proposalId, voterPubKey2, encryptedData, ephemeralPubKey);

        assertEq(voting.getMessageCount(proposalId), 3);
    }

    function test_SubmitMessage_AfterVotingEnd() public {
        proposalId = _createProposal();

        // Fast forward past voting end
        vm.warp(block.timestamp + 4 days);

        vm.prank(voter1);
        vm.expectRevert(MACIVoting.VotingPeriodEnded.selector);
        voting.submitMessage(proposalId, voterPubKey1, encryptedData, ephemeralPubKey);
    }

    function test_SubmitMessage_InvalidLength() public {
        proposalId = _createProposal();

        vm.prank(voter1);
        vm.expectRevert(MACIVoting.InvalidMessageLength.selector);
        voting.submitMessage(proposalId, new bytes(32), encryptedData, ephemeralPubKey);
    }

    // ============ State Root Tests ============

    function test_SubmitStateRoot() public {
        proposalId = _createProposal();

        // Submit some messages
        vm.prank(voter1);
        voting.submitMessage(proposalId, voterPubKey1, encryptedData, ephemeralPubKey);

        // Fast forward past voting end
        vm.warp(block.timestamp + 4 days);

        // Submit state root (using legacy function for backward compatibility)
        bytes32 stateRoot = keccak256("test_state_root");
        vm.prank(coordinator);
        voting.submitStateRootLegacy(proposalId, stateRoot, 1);

        assertEq(voting.getLatestStateRoot(proposalId), stateRoot);
    }

    function test_SubmitStateRoot_BeforeVotingEnd() public {
        proposalId = _createProposal();

        vm.prank(coordinator);
        vm.expectRevert(MACIVoting.VotingPeriodNotEnded.selector);
        voting.submitStateRootLegacy(proposalId, bytes32(0), 0);
    }

    function test_SubmitStateRoot_NotCoordinator() public {
        proposalId = _createProposal();
        vm.warp(block.timestamp + 4 days);

        vm.prank(voter1);
        vm.expectRevert(MACIVoting.NotCoordinator.selector);
        voting.submitStateRootLegacy(proposalId, bytes32(0), 0);
    }

    // ============ Challenge Tests ============

    function _setupForChallenge() internal returns (uint256) {
        proposalId = _createProposal();

        vm.prank(voter1);
        voting.submitMessage(proposalId, voterPubKey1, encryptedData, ephemeralPubKey);

        vm.warp(block.timestamp + 4 days);

        vm.prank(coordinator);
        voting.submitStateRootLegacy(proposalId, keccak256("state"), 1);

        return proposalId;
    }

    function test_ChallengeStateRoot() public {
        proposalId = _setupForChallenge();

        vm.prank(challenger);
        voting.challengeStateRoot{value: 1 ether}(proposalId, 0);

        (
            ,
            ,
            ,
            bool challenged,
            address challengerAddr,
            uint256 challengeBond,
        ) = voting.stateSubmissions(proposalId, 0);

        assertTrue(challenged);
        assertEq(challengerAddr, challenger);
        assertEq(challengeBond, 1 ether);
    }

    function test_ChallengeStateRoot_InsufficientBond() public {
        proposalId = _setupForChallenge();

        vm.prank(challenger);
        vm.expectRevert(MACIVoting.InsufficientBond.selector);
        voting.challengeStateRoot{value: 0.5 ether}(proposalId, 0);
    }

    function test_ChallengeStateRoot_AfterPeriod() public {
        proposalId = _setupForChallenge();

        // Fast forward past challenge period
        vm.warp(block.timestamp + 8 days);

        vm.prank(challenger);
        vm.expectRevert(MACIVoting.ChallengePeriodEnded.selector);
        voting.challengeStateRoot{value: 1 ether}(proposalId, 0);
    }

    function test_RespondToChallenge() public {
        proposalId = _setupForChallenge();

        vm.prank(challenger);
        voting.challengeStateRoot{value: 1 ether}(proposalId, 0);

        // Coordinator responds with proof
        vm.prank(coordinator);
        voting.respondToChallenge(proposalId, 0, "proof");

        // Check challenge resolved
        (, , , , , , bool resolved) = voting.stateSubmissions(proposalId, 0);
        assertTrue(resolved);

        // Coordinator should receive challenger's bond
        (, , uint256 coordBond, ,) = voting.coordinators(coordinatorId);
        assertEq(coordBond, 11 ether); // 10 + 1 from challenger
    }

    function test_ResolveFailedChallenge() public {
        proposalId = _setupForChallenge();

        vm.prank(challenger);
        voting.challengeStateRoot{value: 1 ether}(proposalId, 0);

        // Fast forward past response period
        vm.warp(block.timestamp + 15 days);

        uint256 challengerBalanceBefore = challenger.balance;

        // Anyone can resolve
        voting.resolveFailedChallenge(proposalId, 0);

        // Challenger should receive bond back + coordinator's bond
        assertEq(challenger.balance, challengerBalanceBefore + 11 ether);

        // Coordinator should be deactivated
        (, , uint256 coordBond, bool active,) = voting.coordinators(coordinatorId);
        assertEq(coordBond, 0);
        assertFalse(active);
    }

    // ============ Tally Tests ============

    function _setupForTally() internal returns (uint256) {
        proposalId = _setupForChallenge();
        return proposalId;
    }

    function test_SubmitTally() public {
        proposalId = _setupForTally();

        vm.prank(coordinator);
        voting.submitTally(proposalId, 5, 3, keccak256("tally"));

        (uint256 yes, uint256 no, bool finalized) = voting.getTallyResult(proposalId);
        assertEq(yes, 5);
        assertEq(no, 3);
        assertFalse(finalized);
    }

    function test_ChallengeTally() public {
        proposalId = _setupForTally();

        vm.prank(coordinator);
        voting.submitTally(proposalId, 5, 3, keccak256("tally"));

        vm.prank(challenger);
        voting.challengeTally{value: 1 ether}(proposalId);

        (
            ,
            ,
            ,
            ,
            bool challenged,
            address challengerAddr,
            ,
        ) = voting.tallies(proposalId);

        assertTrue(challenged);
        assertEq(challengerAddr, challenger);
    }

    function test_FinalizeTally() public {
        proposalId = _setupForTally();

        vm.prank(coordinator);
        voting.submitTally(proposalId, 5, 3, keccak256("tally"));

        // Fast forward past challenge period
        vm.warp(block.timestamp + 8 days);

        voting.finalizeTally(proposalId);

        (uint256 yes, uint256 no, bool finalized) = voting.getTallyResult(proposalId);
        assertEq(yes, 5);
        assertEq(no, 3);
        assertTrue(finalized);
    }

    function test_FinalizeTally_BeforeChallengePeriod() public {
        proposalId = _setupForTally();

        vm.prank(coordinator);
        voting.submitTally(proposalId, 5, 3, keccak256("tally"));

        vm.expectRevert(MACIVoting.ChallengePeriodNotEnded.selector);
        voting.finalizeTally(proposalId);
    }

    function test_RespondToTallyChallenge() public {
        proposalId = _setupForTally();

        vm.prank(coordinator);
        voting.submitTally(proposalId, 5, 3, keccak256("tally"));

        vm.prank(challenger);
        voting.challengeTally{value: 1 ether}(proposalId);

        // Coordinator responds
        vm.prank(coordinator);
        voting.respondToTallyChallenge(proposalId, "proof");

        (uint256 yes, uint256 no, bool finalized) = voting.getTallyResult(proposalId);
        assertTrue(finalized);
        assertEq(yes, 5);
        assertEq(no, 3);
    }

    // ============ Full Flow Test ============

    function test_FullVotingFlow() public {
        // 1. Create proposal
        vm.prank(coordinator);
        proposalId = voting.createProposal(coordinatorId, "Full Flow Test", 1 days, 2 days);

        // 2. Voters submit messages
        vm.prank(voter1);
        voting.submitMessage(proposalId, voterPubKey1, encryptedData, ephemeralPubKey);

        vm.prank(voter2);
        voting.submitMessage(proposalId, voterPubKey2, encryptedData, ephemeralPubKey);

        assertEq(voting.getMessageCount(proposalId), 2);

        // 3. Fast forward past voting period
        vm.warp(block.timestamp + 4 days);

        // 4. Coordinator submits state root
        vm.prank(coordinator);
        voting.submitStateRootLegacy(proposalId, keccak256("final_state"), 2);

        // 5. Coordinator submits tally
        vm.prank(coordinator);
        voting.submitTally(proposalId, 1, 1, keccak256("tally_data"));

        // 6. Fast forward past challenge period
        vm.warp(block.timestamp + 8 days);

        // 7. Finalize
        voting.finalizeTally(proposalId);

        // 8. Verify final state
        (uint256 yes, uint256 no, bool finalized) = voting.getTallyResult(proposalId);
        assertEq(yes, 1);
        assertEq(no, 1);
        assertTrue(finalized);

        (, , , , , bool proposalFinalized) = voting.proposals(proposalId);
        assertTrue(proposalFinalized);
    }

    // ============ Fuzz Tests ============

    function testFuzz_SubmitMessage(
        bytes32 pubKeySeed,
        bytes32 encryptedSeed,
        bytes32 ephemeralSeed
    ) public {
        proposalId = _createProposal();

        // Generate deterministic test data from seeds
        bytes memory pubKey = new bytes(64);
        bytes memory encrypted = new bytes(128);
        bytes memory ephemeral = new bytes(64);

        for (uint i = 0; i < 32; i++) {
            pubKey[i] = pubKeySeed[i];
            pubKey[i + 32] = pubKeySeed[i];
            ephemeral[i] = ephemeralSeed[i];
            ephemeral[i + 32] = ephemeralSeed[i];
        }
        for (uint i = 0; i < 32; i++) {
            encrypted[i] = encryptedSeed[i];
            encrypted[i + 32] = encryptedSeed[i];
            encrypted[i + 64] = encryptedSeed[i];
            encrypted[i + 96] = encryptedSeed[i];
        }

        vm.prank(voter1);
        voting.submitMessage(proposalId, pubKey, encrypted, ephemeral);

        assertEq(voting.getMessageCount(proposalId), 1);
    }
}
