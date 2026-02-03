// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/SecureVoting.sol";
import "../src/eligibility/WhitelistEligibility.sol";

contract DeployScript is Script {
    function run() external {
        vm.startBroadcast();

        // Initial committee (5 members) - Foundry default accounts
        address[] memory initialCommittee = new address[](5);
        initialCommittee[0] = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266; // account[0]
        initialCommittee[1] = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // account[1]
        initialCommittee[2] = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // account[2]
        initialCommittee[3] = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // account[3]
        initialCommittee[4] = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65; // account[4]

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
