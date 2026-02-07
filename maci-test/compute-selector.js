const ethers = require('ethers');
const hash = ethers.keccak256(ethers.toUtf8Bytes('PoseidonHashLibrariesNotLinked()'));
console.log('Full hash:', hash);
console.log('Selector:', hash.slice(0, 10));
