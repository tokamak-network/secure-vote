pragma circom 2.0.0;

// ProcessMessages with larger message tree for 50/100 vote benchmarks
// Parameters: stateTreeDepth=10, msgTreeDepth=3, msgBatchDepth=1, voteOptionTreeDepth=2
// Message batch size = 5^1 = 5
// Max messages = 5^3 = 125
include "../node_modules/.pnpm/maci-circuits@2.5.0_@types+snarkjs@0.7.9/node_modules/maci-circuits/circom/core/qv/processMessages.circom";

component main {public[numSignUps, index, batchEndIndex, msgRoot, currentSbCommitment, newSbCommitment, pollEndTimestamp, actualStateTreeDepth, coordinatorPublicKeyHash]} = ProcessMessages(10, 3, 1, 2);
