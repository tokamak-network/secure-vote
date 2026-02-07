import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as fs from "fs";
import * as path from "path";

// Task to overwrite Poseidon artifacts with real circomlibjs bytecodes
task("build-poseidon", "Generate real Poseidon contract bytecodes").setAction(
  async (_, hre) => {
    // circomlibjs has no TS types, import from resolved path
    const circomlibjs = require("circomlibjs");
    const { createCode, generateABI } = circomlibjs.poseidonContract;

    for (const numInputs of [2, 3, 4, 5]) {
      const contractName = `PoseidonT${numInputs + 1}`;
      const bytecode: string = createCode(numInputs);
      const abi = generateABI(numInputs);

      // Read existing artifact and overwrite bytecodes
      const artifactPath = path.join(
        hre.config.paths.artifacts,
        "contracts",
        "crypto",
        `${contractName}.sol`,
        `${contractName}.json`
      );

      const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      artifact.bytecode = bytecode;
      artifact.deployedBytecode = bytecode; // same for library-like contracts
      artifact.abi = abi;
      fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));

      console.log(`  Overwritten: ${contractName} (${bytecode.length} chars)`);
    }
  }
);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      blockGasLimit: 30_000_000,
      allowUnlimitedContractSize: true,
    },
  },
  mocha: {
    timeout: 300_000,
  },
};

export default config;
