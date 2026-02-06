// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/MACIVoting.sol";
import "../src/BisectionGame.sol";

contract BisectionGameTest is Test {
    MACIVoting public voting;
    BisectionGame public bisectionGame;

    address public coordinator = address(0x1001);
    address public voter1 = address(0x2001);
    address public challenger = address(0x3001);

    bytes public coordinatorPubKey = new bytes(64);
    bytes public voterPubKey = new bytes(64);
    bytes public encryptedData = new bytes(128);
    bytes public ephemeralPubKey = new bytes(64);

    uint256 public coordinatorId;
    uint256 public proposalId;

    function setUp() public {
        // Deploy contracts
        voting = new MACIVoting();
        bisectionGame = new BisectionGame(address(voting));

        // Set bisection game in MACIVoting
        voting.setBisectionGame(address(bisectionGame));

        // Initialize test data
        for (uint i = 0; i < 64; i++) {
            coordinatorPubKey[i] = bytes1(uint8(i + 1));
            voterPubKey[i] = bytes1(uint8(i + 65));
            ephemeralPubKey[i] = bytes1(uint8(i + 193));
        }
        for (uint i = 0; i < 128; i++) {
            encryptedData[i] = bytes1(uint8(i));
        }

        // Fund accounts
        vm.deal(coordinator, 100 ether);
        vm.deal(voter1, 10 ether);
        vm.deal(challenger, 50 ether);

        // Register coordinator
        vm.prank(coordinator);
        coordinatorId = voting.registerCoordinator{value: 10 ether}(coordinatorPubKey);

        // Create proposal
        vm.prank(coordinator);
        proposalId = voting.createProposal(coordinatorId, "Bisection Test", 1 days, 2 days);
    }

    // ============ Setup Helpers ============

    function _submitMessagesAndStateRoot(uint256 messageCount) internal returns (bytes32, bytes32) {
        // Submit messages
        for (uint256 i = 0; i < messageCount; i++) {
            bytes memory uniquePubKey = new bytes(64);
            for (uint j = 0; j < 64; j++) {
                uniquePubKey[j] = bytes1(uint8(i * 64 + j));
            }
            vm.prank(voter1);
            voting.submitMessage(proposalId, uniquePubKey, encryptedData, ephemeralPubKey);
        }

        // Fast forward past voting period
        vm.warp(block.timestamp + 4 days);

        // Submit state root with intermediate commitment
        bytes32 stateRoot = keccak256(abi.encodePacked("state_", messageCount));
        bytes32 intermediateCommitment = keccak256(abi.encodePacked("intermediate_", messageCount));

        vm.prank(coordinator);
        voting.submitStateRoot(proposalId, stateRoot, messageCount, intermediateCommitment);

        return (stateRoot, intermediateCommitment);
    }

    // ============ Hybrid Challenge Mode Tests ============

    function test_ChallengeWithMode_ZKP_FULL() public {
        (bytes32 stateRoot,) = _submitMessagesAndStateRoot(10);

        bytes32 challengerStateRoot = keccak256("challenger_state");

        vm.prank(challenger);
        voting.challengeWithMode{value: 2 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.ZKP_FULL,
            challengerStateRoot
        );

        // Check challenge was created
        (
            MACIVoting.ChallengeMode mode,
            address challengerAddr,
            uint256 bond,
            bytes32 claimedState,
            ,
            bool resolved
        ) = voting.getChallenge(proposalId, 0);

        assertEq(uint(mode), uint(MACIVoting.ChallengeMode.ZKP_FULL));
        assertEq(challengerAddr, challenger);
        assertEq(bond, 2 ether);
        assertEq(claimedState, challengerStateRoot);
        assertFalse(resolved);
    }

    function test_ChallengeWithMode_BISECTION() public {
        (bytes32 stateRoot, bytes32 intermediateCommitment) = _submitMessagesAndStateRoot(100);

        bytes32 challengerStateRoot = keccak256("challenger_state");

        vm.prank(challenger);
        voting.challengeWithMode{value: 2 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.BISECTION,
            challengerStateRoot
        );

        // Check challenge was created with bisection game
        (
            MACIVoting.ChallengeMode mode,
            ,
            ,
            ,
            uint256 bisectionGameId,
            bool resolved
        ) = voting.getChallenge(proposalId, 0);

        assertEq(uint(mode), uint(MACIVoting.ChallengeMode.BISECTION));
        assertFalse(resolved);
        assertGt(bisectionGameId, 0); // Game was created (starts at 0, so 0 is valid)

        // Check bisection game was initialized
        BisectionGame.Game memory game = bisectionGame.getGame(bisectionGameId);
        assertEq(game.proposalId, proposalId);
        assertEq(game.batchIndex, 0);
        assertEq(game.challenger, challenger);
        assertEq(game.l, 0);
        assertEq(game.r, 99); // 100 messages, indices 0-99
    }

    function test_RespondToHybridChallenge_ZKP_FULL() public {
        _submitMessagesAndStateRoot(10);

        bytes32 challengerStateRoot = keccak256("challenger_state");

        vm.prank(challenger);
        voting.challengeWithMode{value: 2 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.ZKP_FULL,
            challengerStateRoot
        );

        // Coordinator responds with proof
        vm.prank(coordinator);
        voting.respondToHybridChallengeLegacy(proposalId, 0, "valid_proof");

        // Check challenge resolved
        (,,,,, bool resolved) = voting.getChallenge(proposalId, 0);
        assertTrue(resolved);

        // Coordinator should have received challenger's bond
        (, , uint256 coordBond, ,) = voting.coordinators(coordinatorId);
        assertEq(coordBond, 12 ether); // 10 initial + 2 from challenger
    }

    // ============ Bisection Game Flow Tests ============

    function test_BisectionGame_FullFlow_CoordinatorWins() public {
        _submitMessagesAndStateRoot(8); // 8 messages for simpler bisection

        bytes32 challengerStateRoot = keccak256("wrong_state");

        // Start bisection challenge
        vm.prank(challenger);
        voting.challengeWithMode{value: 2 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.BISECTION,
            challengerStateRoot
        );

        (,,,,uint256 gameId,) = voting.getChallenge(proposalId, 0);

        // Verify initial bounds
        (uint256 l, uint256 r) = bisectionGame.getCurrentBounds(gameId);
        assertEq(l, 0);
        assertEq(r, 7);

        // Round 1: Coordinator provides midpoint state
        bytes32 midState1 = keccak256("mid_state_4");
        bytes32[] memory proof1 = new bytes32[](3);
        proof1[0] = keccak256("sibling_0");
        proof1[1] = keccak256("sibling_1");
        proof1[2] = keccak256("sibling_2");

        vm.prank(coordinator);
        bisectionGame.coordinatorBisect(gameId, midState1, proof1);

        // Challenger chooses right half (claims fraud is in messages 4-7)
        vm.prank(challenger);
        bisectionGame.challengerBisect(gameId, false, keccak256("expected_at_4"));

        // Verify bounds updated
        (l, r) = bisectionGame.getCurrentBounds(gameId);
        assertEq(l, 4);
        assertEq(r, 7);

        // Round 2: Continue bisection
        bytes32 midState2 = keccak256("mid_state_5");
        vm.prank(coordinator);
        bisectionGame.coordinatorBisect(gameId, midState2, proof1);

        vm.prank(challenger);
        bisectionGame.challengerBisect(gameId, true, keccak256("expected_at_5"));

        (l, r) = bisectionGame.getCurrentBounds(gameId);
        assertEq(l, 4);
        assertEq(r, 5);

        // Round 3: Final bisection
        bytes32 midState3 = keccak256("mid_state_4_final");
        vm.prank(coordinator);
        bisectionGame.coordinatorBisect(gameId, midState3, proof1);

        vm.prank(challenger);
        bisectionGame.challengerBisect(gameId, true, keccak256("expected_at_4_final"));

        // Now narrowed to single message
        assertTrue(bisectionGame.isNarrowedToSingle(gameId));
        assertEq(bisectionGame.getDisputedMessageIndex(gameId), 4);

        // Coordinator provides ZKP for single message
        vm.prank(coordinator);
        bisectionGame.resolveWithProofLegacy(gameId, "valid_zkp");

        // Check game resolved
        BisectionGame.Game memory game = bisectionGame.getGame(gameId);
        assertEq(uint(game.status), uint(BisectionGame.GameStatus.CoordinatorWon));

        // Check MACIVoting challenge resolved
        (,,,,, bool resolved) = voting.getChallenge(proposalId, 0);
        assertTrue(resolved);
    }

    function test_BisectionGame_Timeout_ChallengerWins() public {
        _submitMessagesAndStateRoot(8);

        bytes32 challengerStateRoot = keccak256("wrong_state");

        vm.prank(challenger);
        voting.challengeWithMode{value: 2 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.BISECTION,
            challengerStateRoot
        );

        (,,,,uint256 gameId,) = voting.getChallenge(proposalId, 0);

        uint256 challengerBalanceBefore = challenger.balance;

        // Coordinator doesn't respond - fast forward past timeout
        vm.warp(block.timestamp + 2 days);

        // Anyone can resolve timeout
        bisectionGame.resolveTimeout(gameId);

        // Check challenger won
        BisectionGame.Game memory game = bisectionGame.getGame(gameId);
        assertEq(uint(game.status), uint(BisectionGame.GameStatus.ChallengerWon));

        // Challenger should receive bond back + coordinator's slashed bond
        assertEq(challenger.balance, challengerBalanceBefore + 12 ether); // 2 + 10
    }

    function test_BisectionGame_Timeout_CoordinatorWins() public {
        _submitMessagesAndStateRoot(8);

        bytes32 challengerStateRoot = keccak256("wrong_state");

        vm.prank(challenger);
        voting.challengeWithMode{value: 2 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.BISECTION,
            challengerStateRoot
        );

        (,,,,uint256 gameId,) = voting.getChallenge(proposalId, 0);

        // Coordinator provides midpoint
        bytes32[] memory proof = new bytes32[](3);
        proof[0] = keccak256("sibling_0");
        proof[1] = keccak256("sibling_1");
        proof[2] = keccak256("sibling_2");

        vm.prank(coordinator);
        bisectionGame.coordinatorBisect(gameId, keccak256("mid"), proof);

        // Challenger doesn't respond - fast forward past timeout
        vm.warp(block.timestamp + 2 days);

        // Resolve timeout
        bisectionGame.resolveTimeout(gameId);

        // Check coordinator won
        BisectionGame.Game memory game = bisectionGame.getGame(gameId);
        assertEq(uint(game.status), uint(BisectionGame.GameStatus.CoordinatorWon));
    }

    // ============ Error Cases ============

    function test_ChallengeWithMode_InsufficientBond() public {
        _submitMessagesAndStateRoot(10);

        vm.prank(challenger);
        vm.expectRevert(MACIVoting.InsufficientBond.selector);
        voting.challengeWithMode{value: 0.5 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.ZKP_FULL,
            bytes32(0)
        );
    }

    function test_ChallengeWithMode_DoubleChallengeReverts() public {
        _submitMessagesAndStateRoot(10);

        vm.prank(challenger);
        voting.challengeWithMode{value: 2 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.ZKP_FULL,
            bytes32(0)
        );

        // Second challenge should fail
        vm.prank(challenger);
        vm.expectRevert(MACIVoting.ChallengeAlreadyExists.selector);
        voting.challengeWithMode{value: 2 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.ZKP_FULL,
            bytes32(0)
        );
    }

    function test_RespondToHybridChallenge_WrongMode() public {
        _submitMessagesAndStateRoot(10);

        // Start BISECTION challenge
        vm.prank(challenger);
        voting.challengeWithMode{value: 2 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.BISECTION,
            bytes32(0)
        );

        // Try to respond as if it were ZKP_FULL
        vm.prank(coordinator);
        vm.expectRevert(MACIVoting.InvalidChallengeMode.selector);
        voting.respondToHybridChallengeLegacy(proposalId, 0, "proof");
    }

    function test_BisectionGame_NotYourTurn() public {
        _submitMessagesAndStateRoot(8);

        vm.prank(challenger);
        voting.challengeWithMode{value: 2 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.BISECTION,
            bytes32(0)
        );

        (,,,,uint256 gameId,) = voting.getChallenge(proposalId, 0);

        // Challenger tries to move when it's coordinator's turn
        vm.prank(challenger);
        vm.expectRevert(BisectionGame.NotYourTurn.selector);
        bisectionGame.challengerBisect(gameId, true, bytes32(0));
    }

    function test_BisectionGame_TimeoutNotExpired() public {
        _submitMessagesAndStateRoot(8);

        vm.prank(challenger);
        voting.challengeWithMode{value: 2 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.BISECTION,
            bytes32(0)
        );

        (,,,,uint256 gameId,) = voting.getChallenge(proposalId, 0);

        // Try to resolve before timeout
        vm.expectRevert(BisectionGame.GameNotExpired.selector);
        bisectionGame.resolveTimeout(gameId);
    }

    // ============ View Function Tests ============

    function test_GetIntermediateCommitment() public {
        (bytes32 stateRoot, bytes32 intermediateCommitment) = _submitMessagesAndStateRoot(10);

        bytes32 storedCommitment = voting.getIntermediateCommitment(proposalId, 0);
        assertEq(storedCommitment, intermediateCommitment);
    }

    function test_GetChallenge_NoneExists() public {
        _submitMessagesAndStateRoot(10);

        (MACIVoting.ChallengeMode mode,,,,,) = voting.getChallenge(proposalId, 0);
        // Default enum value is ZKP_FULL (0)
        assertEq(uint(mode), 0);
    }

    // ============ Integration Test ============

    function test_FullHybridFlow_BISECTION() public {
        // 1. Setup: messages and state root
        _submitMessagesAndStateRoot(16);

        // 2. Challenger initiates bisection challenge
        vm.prank(challenger);
        voting.challengeWithMode{value: 2 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.BISECTION,
            keccak256("challenger_believes_wrong")
        );

        (,,,,uint256 gameId,) = voting.getChallenge(proposalId, 0);

        // 3. Play through bisection game
        bytes32[] memory proof = new bytes32[](4);
        for (uint i = 0; i < 4; i++) {
            proof[i] = keccak256(abi.encodePacked("sibling_", i));
        }

        // Bisect until narrowed to single message (log2(16) = 4 rounds)
        for (uint round = 0; round < 4; round++) {
            // Coordinator provides midpoint
            vm.prank(coordinator);
            bisectionGame.coordinatorBisect(gameId, keccak256(abi.encodePacked("mid_", round)), proof);

            // Challenger picks a side (always left for simplicity)
            vm.prank(challenger);
            bisectionGame.challengerBisect(gameId, true, keccak256(abi.encodePacked("expected_", round)));
        }

        // 4. Verify narrowed to single message
        assertTrue(bisectionGame.isNarrowedToSingle(gameId));

        // 5. Coordinator provides ZKP for single message
        vm.prank(coordinator);
        bisectionGame.resolveWithProofLegacy(gameId, "valid_zkp_proof");

        // 6. Verify resolution
        BisectionGame.Game memory game = bisectionGame.getGame(gameId);
        assertEq(uint(game.status), uint(BisectionGame.GameStatus.CoordinatorWon));

        (,,,,, bool resolved) = voting.getChallenge(proposalId, 0);
        assertTrue(resolved);

        // 7. Coordinator should have received challenger's bond
        (, , uint256 coordBond, ,) = voting.coordinators(coordinatorId);
        assertEq(coordBond, 12 ether); // 10 initial + 2 from challenger
    }
}
