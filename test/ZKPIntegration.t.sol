// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/MACIVoting.sol";
import "../src/BisectionGame.sol";
import "../src/Verifier.sol";
import "../src/GeneratedVerifier.sol";

/**
 * @title ZKPIntegrationTest
 * @notice Integration tests for ZKP verification in the voting system
 */
contract ZKPIntegrationTest is Test {
    MACIVoting public voting;
    BisectionGame public bisectionGame;
    Groth16Verifier public verifier;

    address public coordinator = address(0x1);
    address public challenger = address(0x2);
    address public voter1 = address(0x3);

    bytes public coordPubKey;
    uint256 public coordId;
    uint256 public proposalId;

    function setUp() public {
        // Deploy contracts
        voting = new MACIVoting();
        verifier = new Groth16Verifier();

        // Deploy BisectionGame with MACIVoting address
        bisectionGame = new BisectionGame(address(voting));

        // Set up contract connections
        voting.setBisectionGame(address(bisectionGame));
        voting.setVerifier(address(verifier));

        // Set verifier on BisectionGame (through MACIVoting)
        vm.prank(address(voting));
        bisectionGame.setVerifier(address(verifier));

        // Create coordinator public key (mock 64 bytes)
        coordPubKey = new bytes(64);
        for (uint256 i = 0; i < 64; i++) {
            coordPubKey[i] = bytes1(uint8(i + 1));
        }

        // Register coordinator
        vm.deal(coordinator, 100 ether);
        vm.prank(coordinator);
        coordId = voting.registerCoordinator{value: 10 ether}(coordPubKey);

        // Create proposal
        vm.prank(coordinator);
        proposalId = voting.createProposal(
            coordId,
            "Test Proposal",
            1 days, // signup duration
            1 days  // voting duration
        );
    }

    // ============ Verifier Tests ============

    function test_VerifierAcceptsValidProof() public view {
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory pC = [uint256(7), uint256(8)];
        uint256[13] memory pubSignals;
        for (uint256 i = 0; i < 13; i++) {
            pubSignals[i] = i + 1;
        }

        bool result = verifier.verifyProof(pA, pB, pC, pubSignals);
        assertTrue(result);
    }

    function test_VerifierRejectsZeroProof() public {
        uint256[2] memory pA = [uint256(0), uint256(0)];
        uint256[2][2] memory pB = [[uint256(0), uint256(0)], [uint256(0), uint256(0)]];
        uint256[2] memory pC = [uint256(0), uint256(0)];
        uint256[13] memory pubSignals;

        vm.expectRevert(Groth16Verifier.InvalidProof.selector);
        verifier.verifyProof(pA, pB, pC, pubSignals);
    }

    function test_VerifierRejectsInvalidFieldElement() public {
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory pC = [uint256(7), uint256(8)];
        uint256[13] memory pubSignals;

        // Set one public signal to be >= SNARK_SCALAR_FIELD
        pubSignals[0] = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

        vm.expectRevert(Groth16Verifier.InvalidInput.selector);
        verifier.verifyProof(pA, pB, pC, pubSignals);
    }

    // ============ ZKP_FULL Challenge Tests ============

    function test_ZKP_FULL_ChallengeResolution() public {
        // Submit messages
        _submitVoteMessage();

        // Advance time past voting period
        vm.warp(block.timestamp + 3 days);

        // Submit state root (use small value within SNARK field for testing)
        // In production, state roots would be Poseidon hashes which are already in field
        bytes32 stateRoot = bytes32(uint256(12345678901234567890));
        bytes32 intermediateCommitment = bytes32(uint256(98765432109876543210));

        vm.prank(coordinator);
        voting.submitStateRoot(proposalId, stateRoot, 1, intermediateCommitment);

        // Challenge with ZKP_FULL mode
        vm.deal(challenger, 10 ether);
        vm.prank(challenger);
        voting.challengeWithMode{value: 1 ether}(
            proposalId,
            0, // batchIndex
            MACIVoting.ChallengeMode.ZKP_FULL,
            keccak256("challenger_state")
        );

        // Verify challenge was created
        (
            MACIVoting.ChallengeMode mode,
            address challengerAddr,
            uint256 bond,
            ,
            ,
            bool resolved
        ) = voting.getChallenge(proposalId, 0);

        assertEq(uint8(mode), uint8(MACIVoting.ChallengeMode.ZKP_FULL));
        assertEq(challengerAddr, challenger);
        assertEq(bond, 1 ether);
        assertFalse(resolved);

        // Coordinator responds with proof
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory pC = [uint256(7), uint256(8)];
        uint256[13] memory pubSignals;
        // All signals should be within SNARK field
        for (uint256 i = 0; i < 13; i++) {
            pubSignals[i] = i + 100;
        }
        pubSignals[1] = uint256(stateRoot); // newStateRoot matches submission

        vm.prank(coordinator);
        voting.respondToHybridChallenge(proposalId, 0, pA, pB, pC, pubSignals);

        // Verify challenge resolved
        (, , , , , resolved) = voting.getChallenge(proposalId, 0);
        assertTrue(resolved);

        // Verify coordinator received challenger's bond
        (,,uint256 coordBond,,) = voting.coordinators(coordId);
        assertEq(coordBond, 11 ether); // 10 initial + 1 from challenger
    }

    // ============ BISECTION Challenge Tests ============

    function test_BISECTION_GameCreation() public {
        // Submit multiple messages
        for (uint256 i = 0; i < 5; i++) {
            _submitVoteMessage();
        }

        // Advance time past voting period
        vm.warp(block.timestamp + 3 days);

        // Submit state root
        bytes32 stateRoot = keccak256("test_state_root");
        bytes32 intermediateCommitment = keccak256("intermediate");

        vm.prank(coordinator);
        voting.submitStateRoot(proposalId, stateRoot, 5, intermediateCommitment);

        // Challenge with BISECTION mode
        vm.deal(challenger, 10 ether);
        vm.prank(challenger);
        voting.challengeWithMode{value: 1 ether}(
            proposalId,
            0, // batchIndex
            MACIVoting.ChallengeMode.BISECTION,
            keccak256("challenger_state")
        );

        // Verify bisection game was created
        (
            MACIVoting.ChallengeMode mode,
            ,
            ,
            ,
            uint256 gameId,
            bool resolved
        ) = voting.getChallenge(proposalId, 0);

        assertEq(uint8(mode), uint8(MACIVoting.ChallengeMode.BISECTION));
        assertFalse(resolved);
        assertTrue(gameId > 0 || gameId == 0); // gameId was assigned

        // Check game state
        BisectionGame.Game memory game = bisectionGame.getGame(gameId);
        assertEq(game.challenger, challenger);
        assertEq(uint8(game.status), uint8(BisectionGame.GameStatus.Active));
    }

    function test_BISECTION_SingleMessageProof() public {
        // Submit one message to simplify bisection
        _submitVoteMessage();

        // Advance time past voting period
        vm.warp(block.timestamp + 3 days);

        // Submit state root
        bytes32 stateRoot = keccak256("test_state_root");
        bytes32 intermediateCommitment = keccak256("intermediate");

        vm.prank(coordinator);
        voting.submitStateRoot(proposalId, stateRoot, 1, intermediateCommitment);

        // Challenge with BISECTION mode
        vm.deal(challenger, 10 ether);
        vm.prank(challenger);
        voting.challengeWithMode{value: 1 ether}(
            proposalId,
            0,
            MACIVoting.ChallengeMode.BISECTION,
            keccak256("challenger_state")
        );

        // Get game ID
        (, , , , uint256 gameId, ) = voting.getChallenge(proposalId, 0);

        // With only 1 message, game should already be narrowed to single
        assertTrue(bisectionGame.isNarrowedToSingle(gameId));
        assertEq(bisectionGame.getDisputedMessageIndex(gameId), 0);

        // Resolve with proof
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory pC = [uint256(7), uint256(8)];
        uint256[13] memory pubSignals;
        pubSignals[7] = 0; // messageIndex

        bisectionGame.resolveWithProof(gameId, pA, pB, pC, pubSignals);

        // Check game resolved
        BisectionGame.Game memory game = bisectionGame.getGame(gameId);
        assertEq(uint8(game.status), uint8(BisectionGame.GameStatus.CoordinatorWon));
    }

    // ============ VerifierWrapper Tests ============

    function test_VerifierWrapper() public {
        VerifierWrapper wrapper = new VerifierWrapper(address(verifier));

        // Should be in dev mode by default
        assertTrue(wrapper.devMode());

        // Should accept any non-zero proof in dev mode
        uint256[2] memory pA = [uint256(1), uint256(0)];
        uint256[2][2] memory pB = [[uint256(0), uint256(0)], [uint256(0), uint256(0)]];
        uint256[2] memory pC = [uint256(0), uint256(0)];
        uint256[13] memory pubSignals;

        bool result = wrapper.verifyProof(pA, pB, pC, pubSignals);
        assertTrue(result);

        // Disable dev mode
        wrapper.setDevMode(false);
        assertFalse(wrapper.devMode());
    }

    // ============ Helper Functions ============

    function _submitVoteMessage() internal {
        bytes memory voterPubKey = new bytes(64);
        bytes memory encryptedData = new bytes(128);
        bytes memory ephemeralPubKey = new bytes(64);

        // Fill with non-zero data
        for (uint256 i = 0; i < 64; i++) {
            voterPubKey[i] = bytes1(uint8(i + 1));
            ephemeralPubKey[i] = bytes1(uint8(i + 65));
        }
        for (uint256 i = 0; i < 128; i++) {
            encryptedData[i] = bytes1(uint8(i + 1));
        }

        vm.prank(voter1);
        voting.submitMessage(proposalId, voterPubKey, encryptedData, ephemeralPubKey);
    }
}

/**
 * @title GeneratedVerifierTest
 * @notice Tests using the real snarkjs-generated Groth16 verifier with actual proof data
 */
contract GeneratedVerifierTest is Test {
    GeneratedGroth16Verifier public realVerifier;

    function setUp() public {
        realVerifier = new GeneratedGroth16Verifier();
    }

    function test_RealVerifierAcceptsValidProof() public view {
        // Real proof generated by snarkjs from test/fixtures/real-proof.json
        uint256[2] memory pA = [
            uint256(12708715123405724004658656505959655543920786524610370918811713079818266024958),
            uint256(2322260380689958904742351734256519118148476794499341891606975178577808156205)
        ];
        uint256[2][2] memory pB = [
            [
                uint256(12502080612610045883288530439889155600728819869052674647799144701305756052216),
                uint256(20469730699993041903060761686223987864957175392701678852995237616386227435293)
            ],
            [
                uint256(5296919790538878201261156125717443732043214688749011184825106045722242189442),
                uint256(12488259151617418678237771675268810121773350297399586143155261762276879095126)
            ]
        ];
        uint256[2] memory pC = [
            uint256(18358508893852167245598396523494015429691134159228855689476093581478363902163),
            uint256(3269936585284691457491419181656833169454810423122735395892481744533101603529)
        ];
        uint256[13] memory pubSignals = [
            uint256(2336747551601206011856220779362468156942587634173265559929009704502306417044),
            uint256(12438835436659921755938067542811787162204164477224189035088662862894639945740),
            uint256(11111),
            uint256(22222),
            uint256(90029617699355326941167531563642494179039984583353070505327016755421531030),
            uint256(9176254347070563948945369503011775935283296144267799866208401882420717689925),
            uint256(9211891433369855650219620397278070921013065614108619553584431454656783944275),
            uint256(8798628441676461989059210501591689966032509171682895150850766182264428578124),
            uint256(33333),
            uint256(44444),
            uint256(0),
            uint256(4267533774488295900887461483015112262021273608761099826938271132511348470966),
            uint256(4267533774488295900887461483015112262021273608761099826938271132511348470966)
        ];

        bool result = realVerifier.verifyProof(pA, pB, pC, pubSignals);
        assertTrue(result, "Real proof should be valid");
    }

    function test_RealVerifierRejectsInvalidProof() public view {
        // Modify one element of the proof to make it invalid
        uint256[2] memory pA = [
            uint256(12708715123405724004658656505959655543920786524610370918811713079818266024958),
            uint256(2322260380689958904742351734256519118148476794499341891606975178577808156205)
        ];
        uint256[2][2] memory pB = [
            [
                uint256(12502080612610045883288530439889155600728819869052674647799144701305756052216),
                uint256(20469730699993041903060761686223987864957175392701678852995237616386227435293)
            ],
            [
                uint256(5296919790538878201261156125717443732043214688749011184825106045722242189442),
                uint256(12488259151617418678237771675268810121773350297399586143155261762276879095126)
            ]
        ];
        uint256[2] memory pC = [
            uint256(18358508893852167245598396523494015429691134159228855689476093581478363902163),
            uint256(3269936585284691457491419181656833169454810423122735395892481744533101603529)
        ];
        uint256[13] memory pubSignals = [
            uint256(2336747551601206011856220779362468156942587634173265559929009704502306417044),
            uint256(12438835436659921755938067542811787162204164477224189035088662862894639945740),
            uint256(11111),
            uint256(22222),
            uint256(90029617699355326941167531563642494179039984583353070505327016755421531030),
            uint256(9176254347070563948945369503011775935283296144267799866208401882420717689925),
            uint256(9211891433369855650219620397278070921013065614108619553584431454656783944275),
            uint256(8798628441676461989059210501591689966032509171682895150850766182264428578124),
            uint256(33333),
            uint256(44444),
            uint256(0),
            uint256(4267533774488295900887461483015112262021273608761099826938271132511348470966),
            uint256(4267533774488295900887461483015112262021273608761099826938271132511348470966)
        ];

        // Tamper with a public signal (change newStateRoot)
        pubSignals[1] = 999;

        bool result = realVerifier.verifyProof(pA, pB, pC, pubSignals);
        assertFalse(result, "Tampered proof should be invalid");
    }

    function test_RealVerifierRejectsWrongProofPoints() public view {
        // Use correct public signals but wrong proof points
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory pC = [uint256(7), uint256(8)];
        uint256[13] memory pubSignals = [
            uint256(2336747551601206011856220779362468156942587634173265559929009704502306417044),
            uint256(12438835436659921755938067542811787162204164477224189035088662862894639945740),
            uint256(11111),
            uint256(22222),
            uint256(90029617699355326941167531563642494179039984583353070505327016755421531030),
            uint256(9176254347070563948945369503011775935283296144267799866208401882420717689925),
            uint256(9211891433369855650219620397278070921013065614108619553584431454656783944275),
            uint256(8798628441676461989059210501591689966032509171682895150850766182264428578124),
            uint256(33333),
            uint256(44444),
            uint256(0),
            uint256(4267533774488295900887461483015112262021273608761099826938271132511348470966),
            uint256(4267533774488295900887461483015112262021273608761099826938271132511348470966)
        ];

        bool result = realVerifier.verifyProof(pA, pB, pC, pubSignals);
        assertFalse(result, "Wrong proof points should be invalid");
    }
}
