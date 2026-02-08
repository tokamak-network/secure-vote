#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# E2E Web API Test — Full voting platform flow via HTTP APIs
#
# Prerequisites:
#   1. Anvil running on port 8545
#   2. Contracts deployed (deploy-platform.ts)
#   3. Frontend running on port 3001
#
# Tests:
#   Scenario 1: Voter flow (signup + vote)
#   Scenario 2: Coordinator flow (process + RLA commit/reveal/proofs/finalize)
#   Scenario 3: Results verification
# ═══════════════════════════════════════════════════════════════════

set -e
FRONTEND="http://localhost:3001"
PASS=0
FAIL=0
ERRORS=""

red() { echo -e "\033[31m$1\033[0m"; }
green() { echo -e "\033[32m$1\033[0m"; }
yellow() { echo -e "\033[33m$1\033[0m"; }

check() {
  local desc="$1"
  local result="$2"
  local expected="$3"
  if echo "$result" | grep -q "$expected"; then
    green "  ✓ $desc"
    PASS=$((PASS + 1))
  else
    red "  ✗ $desc"
    red "    Expected: $expected"
    red "    Got: $(echo "$result" | head -c 200)"
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  - $desc"
  fi
}

check_json() {
  local desc="$1"
  local result="$2"
  local key="$3"
  local expected="$4"
  local actual
  actual=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$key',''))" 2>/dev/null)
  if [ "$actual" = "$expected" ]; then
    green "  ✓ $desc ($key=$actual)"
    PASS=$((PASS + 1))
  else
    red "  ✗ $desc ($key expected=$expected actual=$actual)"
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  - $desc"
  fi
}

echo "═══════════════════════════════════════════════════════════════"
echo " E2E Web API Test — MACI + MaciRLA Voting Platform"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─── Pre-checks ──────────────────────────────────────────────────
echo "▶ Pre-flight checks"
ANVIL_STATUS=$(curl -s http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' 2>/dev/null)
check "Anvil is running" "$ANVIL_STATUS" "result"

FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND/" 2>/dev/null)
check "Frontend is running" "$FRONTEND_STATUS" "200"

# ─── Scenario 1: Page accessibility ─────────────────────────────
echo ""
echo "▶ Scenario 1: Page accessibility"

for page in "/" "/elections/create" "/elections/0" "/elections/0/results" "/coordinator" "/coordinator/0"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND$page" 2>/dev/null)
  check "GET $page returns 200" "$STATUS" "200"
done

# ─── Scenario 2: Voter flow (3 voters: 2 Yes, 1 No) ──────────
echo ""
echo "▶ Scenario 2: Voter flow (3 voters: 2 Yes, 1 No)"

# Voter 1: Yes
echo "  Voter 1 signup..."
SIGNUP1=$(curl -s -X POST "$FRONTEND/api/vote/keygen" 2>/dev/null)
check_json "Voter 1 signup" "$SIGNUP1" "success" "True"
SI1=$(echo "$SIGNUP1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('stateIndex',''))" 2>/dev/null)
PUB1=$(echo "$SIGNUP1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['keypair']['pubKey'])" 2>/dev/null)
PRIV1=$(echo "$SIGNUP1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['keypair']['privKey'])" 2>/dev/null)
echo "    stateIndex=$SI1"

echo "  Voter 1 vote (Yes, nonce=1)..."
VOTE1=$(curl -s -X POST "$FRONTEND/api/vote/encrypt" -H "Content-Type: application/json" -d "{
  \"pollId\": 0,
  \"voterKey\": {\"pubKey\": \"$PUB1\", \"privKey\": \"$PRIV1\"},
  \"voteOption\": 1,
  \"stateIndex\": $SI1,
  \"nonce\": 1
}" 2>/dev/null)
check_json "Voter 1 vote" "$VOTE1" "success" "True"

# Voter 2: Yes
echo "  Voter 2 signup..."
SIGNUP2=$(curl -s -X POST "$FRONTEND/api/vote/keygen" 2>/dev/null)
check_json "Voter 2 signup" "$SIGNUP2" "success" "True"
SI2=$(echo "$SIGNUP2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('stateIndex',''))" 2>/dev/null)
PUB2=$(echo "$SIGNUP2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['keypair']['pubKey'])" 2>/dev/null)
PRIV2=$(echo "$SIGNUP2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['keypair']['privKey'])" 2>/dev/null)
echo "    stateIndex=$SI2"

echo "  Voter 2 vote (Yes, nonce=1)..."
VOTE2=$(curl -s -X POST "$FRONTEND/api/vote/encrypt" -H "Content-Type: application/json" -d "{
  \"pollId\": 0,
  \"voterKey\": {\"pubKey\": \"$PUB2\", \"privKey\": \"$PRIV2\"},
  \"voteOption\": 1,
  \"stateIndex\": $SI2,
  \"nonce\": 1
}" 2>/dev/null)
check_json "Voter 2 vote" "$VOTE2" "success" "True"

# Voter 3: No
echo "  Voter 3 signup..."
SIGNUP3=$(curl -s -X POST "$FRONTEND/api/vote/keygen" 2>/dev/null)
check_json "Voter 3 signup" "$SIGNUP3" "success" "True"
SI3=$(echo "$SIGNUP3" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('stateIndex',''))" 2>/dev/null)
PUB3=$(echo "$SIGNUP3" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['keypair']['pubKey'])" 2>/dev/null)
PRIV3=$(echo "$SIGNUP3" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['keypair']['privKey'])" 2>/dev/null)
echo "    stateIndex=$SI3"

echo "  Voter 3 vote (No, nonce=1)..."
VOTE3=$(curl -s -X POST "$FRONTEND/api/vote/encrypt" -H "Content-Type: application/json" -d "{
  \"pollId\": 0,
  \"voterKey\": {\"pubKey\": \"$PUB3\", \"privKey\": \"$PRIV3\"},
  \"voteOption\": 0,
  \"stateIndex\": $SI3,
  \"nonce\": 1
}" 2>/dev/null)
check_json "Voter 3 vote" "$VOTE3" "success" "True"

# ─── Scenario 2b: Re-vote + Key change (MACI anti-collusion) ──
echo ""
echo "▶ Scenario 2b: Re-vote + Key change"

# Voter 3 re-votes: changes No → Yes (nonce=2)
echo "  Voter 3 re-vote (No→Yes, nonce=2)..."
REVOTE3=$(curl -s -X POST "$FRONTEND/api/vote/encrypt" -H "Content-Type: application/json" -d "{
  \"pollId\": 0,
  \"voterKey\": {\"pubKey\": \"$PUB3\", \"privKey\": \"$PRIV3\"},
  \"voteOption\": 1,
  \"stateIndex\": $SI3,
  \"nonce\": 2
}" 2>/dev/null)
check_json "Voter 3 re-vote" "$REVOTE3" "success" "True"

# Voter 2 key change: generate new key, send key-change message, re-vote with new key
echo "  Voter 2 keygen-only (new key for key change)..."
NEWKEY2=$(curl -s -X POST "$FRONTEND/api/vote/keygen-only" 2>/dev/null)
check_json "Voter 2 keygen-only" "$NEWKEY2" "success" "True"
NEWPUB2=$(echo "$NEWKEY2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['keypair']['pubKey'])" 2>/dev/null)
NEWPRIV2=$(echo "$NEWKEY2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['keypair']['privKey'])" 2>/dev/null)

echo "  Voter 2 key change (nonce=2, old key signs, new key set)..."
KEYCHANGE2=$(curl -s -X POST "$FRONTEND/api/vote/encrypt" -H "Content-Type: application/json" -d "{
  \"pollId\": 0,
  \"voterKey\": {\"pubKey\": \"$PUB2\", \"privKey\": \"$PRIV2\"},
  \"voteOption\": 0,
  \"stateIndex\": $SI2,
  \"nonce\": 2,
  \"newPubKey\": \"$NEWPUB2\",
  \"newPrivKey\": \"$NEWPRIV2\"
}" 2>/dev/null)
check_json "Voter 2 key change" "$KEYCHANGE2" "success" "True"

echo "  Voter 2 re-vote with new key (No, nonce=3)..."
REVOTE2=$(curl -s -X POST "$FRONTEND/api/vote/encrypt" -H "Content-Type: application/json" -d "{
  \"pollId\": 0,
  \"voterKey\": {\"pubKey\": \"$NEWPUB2\", \"privKey\": \"$NEWPRIV2\"},
  \"voteOption\": 0,
  \"stateIndex\": $SI2,
  \"nonce\": 3
}" 2>/dev/null)
check_json "Voter 2 re-vote with new key" "$REVOTE2" "success" "True"

# ─── Scenario 3: Coordinator flow ───────────────────────────────
echo ""
echo "▶ Scenario 3: Coordinator flow"

# Step 1: Generate proofs
echo "  Starting proof generation..."
rm -f "$(dirname "$0")/../proofs-web/status.json" 2>/dev/null
PROCESS=$(curl -s -X POST "$FRONTEND/api/coordinator/process" -H "Content-Type: application/json" -d '{"pollId":0}' 2>/dev/null)
check_json "Proof gen started" "$PROCESS" "success" "True"

# Poll for completion (max 5 minutes)
echo "  Waiting for proofs..."
for i in $(seq 1 60); do
  sleep 5
  STATUS=$(curl -s "$FRONTEND/api/coordinator/process" 2>/dev/null)
  PHASE=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
  echo "    [$i] status: $PHASE"
  if [ "$PHASE" = "complete" ]; then
    break
  fi
  if [ "$PHASE" = "error" ]; then
    ERR=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null)
    red "    Proof generation error: $ERR"
    break
  fi
done
check_json "Proof gen complete" "$STATUS" "status" "complete"

# Check tally
PM_COUNT=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('pmProofCount',0))" 2>/dev/null)
TV_COUNT=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tvProofCount',0))" 2>/dev/null)
echo "    PM proofs: $PM_COUNT, TV proofs: $TV_COUNT"

# Step 2: RLA Commit
echo "  RLA Commit..."
COMMIT=$(curl -s -X POST "$FRONTEND/api/coordinator/rla-commit" -H "Content-Type: application/json" -d '{"pollId":0}' 2>/dev/null)
check_json "RLA commit" "$COMMIT" "success" "True"
RLA_POLL_ID=$(echo "$COMMIT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('rlaPollId',0))" 2>/dev/null)
echo "    rlaPollId=$RLA_POLL_ID, pmBatches=$(echo "$COMMIT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('pmBatches',0))" 2>/dev/null), tvBatches=$(echo "$COMMIT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tvBatches',0))" 2>/dev/null)"

# Step 3: RLA Reveal
echo "  RLA Reveal..."
REVEAL=$(curl -s -X POST "$FRONTEND/api/coordinator/rla-reveal" -H "Content-Type: application/json" -d "{\"pollId\":$RLA_POLL_ID}" 2>/dev/null)
check_json "RLA reveal" "$REVEAL" "success" "True"
echo "    pmSamples=$(echo "$REVEAL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('pmSamples',0))" 2>/dev/null), tvSamples=$(echo "$REVEAL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tvSamples',0))" 2>/dev/null)"

# Step 4: Submit proofs
echo "  Submitting sampled proofs..."
PROOFS=$(curl -s -X POST "$FRONTEND/api/coordinator/rla-proofs" -H "Content-Type: application/json" -d "{\"pollId\":$RLA_POLL_ID}" 2>/dev/null)
check_json "RLA proofs submitted" "$PROOFS" "success" "True"
echo "    $(echo "$PROOFS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"PM={d.get('pmProofsSubmitted',0)} TV={d.get('tvProofsSubmitted',0)}\")" 2>/dev/null)"

# Step 5: Finalize
echo "  Finalizing (includes 7-day time travel)..."
FINALIZE=$(curl -s -X POST "$FRONTEND/api/coordinator/rla-finalize" -H "Content-Type: application/json" -d "{\"pollId\":$RLA_POLL_ID}" 2>/dev/null)
check_json "RLA finalized" "$FINALIZE" "finalized" "True"
echo "    yesVotes=$(echo "$FINALIZE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('yesVotes',0))" 2>/dev/null), noVotes=$(echo "$FINALIZE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('noVotes',0))" 2>/dev/null)"

# ─── Scenario 4: Error handling ──────────────────────────────────
echo ""
echo "▶ Scenario 4: Error handling"

# Bad method
BAD_METHOD=$(curl -s -X GET "$FRONTEND/api/vote/keygen" 2>/dev/null)
check "GET /api/vote/keygen returns error" "$BAD_METHOD" "Method not allowed"

# Missing fields
BAD_ENCRYPT=$(curl -s -X POST "$FRONTEND/api/vote/encrypt" -H "Content-Type: application/json" -d '{}' 2>/dev/null)
check "Missing fields in encrypt returns error" "$BAD_ENCRYPT" "Missing required fields"

# Double finalize should fail
DOUBLE_FIN=$(curl -s -X POST "$FRONTEND/api/coordinator/rla-finalize" -H "Content-Type: application/json" -d "{\"pollId\":$RLA_POLL_ID}" 2>/dev/null)
check "Double finalize returns error" "$DOUBLE_FIN" "false"

# ─── Summary ─────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " RESULTS: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
  red "\n Failures:$ERRORS"
  exit 1
else
  green "\n All tests passed!"
  exit 0
fi
