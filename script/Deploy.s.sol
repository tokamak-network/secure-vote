// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/SecureVoting.sol";
import "../src/eligibility/WhitelistEligibility.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // Example initial committee (5 members)
        address[] memory initialCommittee = new address[](5);
        initialCommittee[0] = 0x1234567890123456789012345678901234567890;
        initialCommittee[1] = 0x2345678901234567890123456789012345678901;
        initialCommittee[2] = 0x3456789012345678901234567890123456789012;
        initialCommittee[3] = 0x4567890123456789012345678901234567890123;
        initialCommittee[4] = 0x5678901234567890123456789012345678901234;

        // Deploy whitelist eligibility
        WhitelistEligibility eligibility = new WhitelistEligibility(initialCommittee);
        console.log("WhitelistEligibility deployed at:", address(eligibility));

        // Threshold: 3/5
        uint256 threshold = 3;

        // Placeholder public key (in real deployment, generate via DKG off-chain)
        bytes memory publicKey = hex"0000000000000000000000000000000000000000000000000000000000000000";

        // Deploy SecureVoting
        SecureVoting voting = new SecureVoting(
            initialCommittee,
            threshold,
            publicKey,
            eligibility
        );
        console.log("SecureVoting deployed at:", address(voting));

        vm.stopBroadcast();
    }
}
