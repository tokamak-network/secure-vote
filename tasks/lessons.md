# Lessons Learned

## JavaScript Bit Shift Overflow

**Date:** 2026-02-05

**Issue:** `1 << 34` in JavaScript returns `4`, not `17179869184`.

**Root Cause:** JavaScript bit shift operators (`<<`, `>>`) use 32-bit integers. `1 << 34` is equivalent to `1 << (34 % 32)` = `1 << 2` = `4`.

**Fix:** Use `2 ** 34` or `Math.pow(2, 34)` for large exponents, or use BigInt: `1n << 34n`.

**Context:** Caused discrete log search to fail in MACI encryption because max search range was set to 4 instead of 2^34.

---

## Solidity Precompile Addresses

**Date:** 2026-02-06

**Issue:** Using `address(0x1)` through `address(0x9)` as test addresses causes failures when transferring ETH.

**Root Cause:** Addresses 0x1-0x9 are reserved for Ethereum precompile contracts (ECRecover, SHA256, etc.). These addresses cannot receive ETH via `transfer()`.

**Fix:** Use addresses >= 0x10 for test accounts. Example: `address(0x1001)` instead of `address(0x1)`.

**Context:** MACIVoting test failed when coordinator tried to withdraw bond because coordinator address was set to 0x1 (ECRecover precompile).

---

## Circom 2.x Component Declarations

**Date:** 2026-02-07

**Issue:** `component muxL = Mux1()` inside a `for` loop causes compile error: "Signal, bus or component declaration inside While scope."

**Root Cause:** Circom 2.x requires all component declarations at template scope level, not inside for/while loops.

**Fix:** Declare component arrays at template scope, then instantiate inside the loop:
```circom
// At template scope:
component muxL[levels];
// Inside for loop:
muxL[i] = Mux1();
```

---

## Bun + snarkjs Worker Thread Incompatibility

**Date:** 2026-02-07

**Issue:** snarkjs Groth16 proof generation hangs indefinitely under Bun runtime (>5 minutes for 25K constraints).

**Root Cause:** snarkjs uses `web-worker` package with `worker_threads` that triggers a `dispatchEvent` TypeError in Bun: "Argument 1 ('event') to EventTarget.dispatchEvent must be an instance of Event".

**Fix:** Use Node.js for proof generation/verification. Bun can run tests that don't invoke snarkjs's `groth16.fullProve()` or `groth16.verify()`. Created `offchain/test-proof.mjs` as a Node.js-only script.

**Context:** Proof generation that takes 0.9s on Node.js was timing out at 5+ minutes on Bun.

---

## snarkjs Generated Verifier Contract Naming

**Date:** 2026-02-07

**Issue:** snarkjs generates Solidity verifier with contract name `Groth16Verifier`, which conflicts with the placeholder verifier of the same name.

**Fix:** Add a sed command in the compile script to rename it:
```bash
sed -i.bak 's/contract Groth16Verifier/contract GeneratedGroth16Verifier/' src/GeneratedVerifier.sol
```

---

## circomlib Include Paths

**Date:** 2026-02-07

**Issue:** `include "circomlib/circuits/poseidon.circom"` fails even though circomlib is installed.

**Root Cause:** The `-l` flag in circom points to `node_modules/circomlib/circuits/`, so the include should be just `"poseidon.circom"` not `"circomlib/circuits/poseidon.circom"`.

**Fix:** Use simple includes: `include "poseidon.circom"` with `-l node_modules/circomlib/circuits`.
