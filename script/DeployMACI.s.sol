// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MACIVoting.sol";

contract DeployMACI is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        MACIVoting maci = new MACIVoting();

        vm.stopBroadcast();

        console.log("MACIVoting deployed to:", address(maci));
    }
}
