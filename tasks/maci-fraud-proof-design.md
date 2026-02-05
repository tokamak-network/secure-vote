# MACI + Fraud Proof 설계

## 목표

- **Trustless bribery-free**: Briber가 온체인에서 투표 검증 불가
- **저비용**: ZKP 생성/검증을 challenge 시에만
- **ZKP 없이 계산 가능**: 평상시 proof 생성 불필요

---

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────┐
│                        Happy Path                           │
│                                                             │
│  Voter ──→ Encrypted Vote ──→ Coordinator ──→ State Root   │
│                (온체인)         (처리)        (온체인)       │
│                                                             │
│                    ※ ZKP 생성/검증 없음                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      Challenge Path                         │
│                                                             │
│  Challenger ──→ "틀렸어" + Bond                             │
│       ↓                                                     │
│  Coordinator ──→ ZKP 생성 ──→ ZKP 검증                      │
│       ↓                                                     │
│  Valid: Challenger bond 슬래싱                              │
│  Invalid: Coordinator bond 슬래싱                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase별 상세 설계

### Phase 1: Setup

```
1. Committee가 threshold keypair 생성
   - Public key: pk (온체인 공개)
   - Secret key shares: sk_1, ..., sk_n (각자 보관)

2. Coordinator 등록
   - Coordinator bond 예치
   - Coordinator가 pk로 암호화된 투표 처리 담당
```

### Phase 2: 투표 (Commit)

```
Voter:
1. 투표 v 결정
2. 키 쌍 생성: (voter_sk, voter_pk)
3. 메시지 암호화: encrypted_msg = Encrypt(v, pk)
4. 온체인 제출: submitVote(voter_pk, encrypted_msg)

특징:
- Voter는 언제든 새 키로 투표 덮어쓰기 가능 (MACI 핵심)
- Briber가 첫 투표 봐도, voter가 나중에 키 변경하면 무효
```

### Phase 3: 처리 (Process)

```
Coordinator (off-chain):
1. 모든 encrypted_msg 수집
2. Threshold 복호화로 메시지 해독
3. 최신 키로 제출된 투표만 유효 처리
4. 새 state root 계산: new_root = hash(processed_state)

Coordinator (on-chain):
5. submitStateRoot(new_root, batch_index)
   - proof 제출 없음!
   - coordinator bond가 담보

※ ZKP 생성 없이 그냥 계산만 함
```

### Phase 4: Challenge Period

```
기간: 7일 (조정 가능)

아무나:
1. challengeStateRoot(batch_index) + challenger_bond
2. "이 state root가 잘못됐다"고 주장

Coordinator 대응:
3. 7일 내 ZKP 제출
4. proof = prove(old_state, messages, new_state)
   - "old_state에서 messages 처리하면 new_state 맞음"

결과:
- ZKP valid → challenger bond 슬래싱
- ZKP invalid/미제출 → coordinator bond 슬래싱, state revert
```

### Phase 5: 집계 (Tally)

```
Coordinator (off-chain):
1. 최종 state에서 투표 집계
2. Committee threshold 복호화로 결과 도출
3. tally_result = {yes: X, no: Y}

Coordinator (on-chain):
4. submitTally(tally_result)
   - proof 없음!

Challenge 가능:
5. challengeTally() + bond
6. Coordinator가 ZKP 제출
   - "암호화된 투표들의 합이 이 결과와 일치"
```

### Phase 6: Finalization

```
Challenge period 종료 후:
1. finalize() 호출
2. 결과 확정
3. Bond 반환
```

---

## Bribery Resistance 분석

### Pre-vote Bribery 방어

```
Briber: "찬성 투표하면 돈 줄게"
Voter: 찬성 투표 제출
Voter: (나중에) 새 키로 반대 투표 제출
Briber: 최종 투표가 뭔지 알 수 없음

핵심: 키 변경으로 이전 투표 무효화 가능
```

### Post-vote Bribery 방어

```
Briber: "투표 증명해"
Voter: "내 키는 X, 투표는 Y"
Briber: 검증하려면...
  - Coordinator가 처리한 최종 state 필요
  - 하지만 개별 투표는 aggregate되어 있음
  - 키 변경 여부도 확인 불가

핵심: Coordinator만 최종 state 알고, 개별 투표 공개 안 함
```

### Coordinator 공모 시나리오

```
위험: Coordinator가 briber에게 개별 투표 정보 판매

완화책:
1. Coordinator도 키 변경 후 최종 투표만 봄
2. 키 변경은 voter가 언제든 가능
3. Coordinator가 "X가 찬성 투표함" 알려줘도
   → Voter가 나중에 키 변경했으면 틀린 정보

한계: Coordinator가 마감 직전 상태 판매 시 위험
추가 완화: 다중 Coordinator, TEE, threshold coordinator
```

---

## 비용 분석

### 현재 MACI

| 항목 | 비용 |
|------|------|
| 투표당 proof 생성 | ~30초 CPU |
| 투표당 proof 검증 | ~300k gas |
| Batch proof 생성 | ~수분 CPU |
| Batch proof 검증 | ~500k gas |

### MACI + Fraud Proof

| 항목 | Happy Path | Challenge Path |
|------|-----------|----------------|
| 투표 제출 | ~50k gas | 동일 |
| State root 제출 | ~30k gas | 동일 |
| Proof 생성 | **없음** | ~수분 CPU |
| Proof 검증 | **없음** | ~500k gas |
| Challenge bond | - | ~1 ETH |

**예상 절감: 90%+ (challenge가 드물다면)**

---

## 구현 요소

### Smart Contracts

```solidity
contract MACIFraudProof {
    // State
    mapping(uint => bytes32) public stateRoots;
    mapping(uint => uint) public challengeDeadlines;
    mapping(uint => bool) public finalized;

    // Bonds
    uint public coordinatorBond;
    uint public challengeBond;

    // Submit state root (no proof)
    function submitStateRoot(
        uint batchIndex,
        bytes32 newRoot
    ) external onlyCoordinator {
        stateRoots[batchIndex] = newRoot;
        challengeDeadlines[batchIndex] = block.timestamp + 7 days;
    }

    // Challenge
    function challenge(uint batchIndex) external payable {
        require(msg.value >= challengeBond);
        require(block.timestamp < challengeDeadlines[batchIndex]);
        // Start dispute
    }

    // Respond to challenge with proof
    function respondWithProof(
        uint batchIndex,
        bytes calldata proof
    ) external onlyCoordinator {
        require(verifyProof(proof, stateRoots[batchIndex]));
        // Slash challenger
    }

    // Finalize after challenge period
    function finalize(uint batchIndex) external {
        require(block.timestamp >= challengeDeadlines[batchIndex]);
        require(!challenged[batchIndex]);
        finalized[batchIndex] = true;
    }
}
```

### Off-chain Components

```typescript
// Coordinator service
class Coordinator {
    // Process messages (no proof generation)
    processMessages(messages: EncryptedMessage[]): State {
        // Decrypt, validate, update state
        // NO ZKP here!
    }

    // Generate proof only when challenged
    generateProof(
        oldState: State,
        messages: EncryptedMessage[],
        newState: State
    ): Proof {
        // Heavy computation, only on challenge
        return snark.prove(circuit, {oldState, messages, newState});
    }
}
```

### ZKP Circuit (재사용)

```
기존 MACI circuit 그대로 사용:
- MessageProcessor circuit
- TallyVotes circuit

변경점:
- 평소에 prove() 호출 안 함
- Challenge 시에만 prove() 호출
```

---

## 트레이드오프

| 장점 | 단점 |
|------|------|
| 비용 90%+ 절감 | Finality 7일 지연 |
| 기존 MACI 암호화 재사용 | Coordinator bond 필요 |
| Bribery resistance 유지 | Challenge 시 ZKP 필요 (circuit 개발) |
| Proof 생성 평소 불필요 | 악의적 challenge 가능 (bond로 완화) |

---

## 현재 구현과의 비교

| 항목 | 현재 (Silent Setup) | MACI + Fraud Proof |
|------|--------------------|--------------------|
| Threshold | n-of-n | k-of-n 가능 |
| 키 변경 | 없음 | 있음 (핵심!) |
| Bribery resistance | Merkle로 증명 가능 | 키 변경으로 방어 |
| ZKP | 없음 | Challenge시만 |
| Coordinator | Committee가 담당 | 별도 역할 |
| 비용 | 낮음 | 더 낮음 (happy path) |

---

## 구현 로드맵

### Phase 1: 핵심 구조 (2-3주)
- [ ] MACI 스타일 메시지/키 구조
- [ ] Coordinator 처리 로직 (without proof)
- [ ] State root 제출 컨트랙트

### Phase 2: Challenge 메커니즘 (2주)
- [ ] Challenge/response 컨트랙트
- [ ] Bond 관리
- [ ] Timeout 처리

### Phase 3: ZKP Circuit (3-4주)
- [ ] MACI circuit 분석/재사용
- [ ] Fraud proof용 circuit 수정
- [ ] Verifier 컨트랙트

### Phase 4: 통합 테스트 (2주)
- [ ] Happy path 테스트
- [ ] Challenge 시나리오 테스트
- [ ] Bribery resistance 검증

---

## 참고 자료

- [MACI Documentation](https://maci.pse.dev/)
- [MACI GitHub](https://github.com/privacy-scaling-explorations/maci)
- [Optimistic Rollup Design](https://ethereum.org/en/developers/docs/scaling/optimistic-rollups/)
- [PSE Technical Report on MACI](https://github.com/privacy-scaling-explorations/technical-reports/blob/main/reports/Applied_ZKP_Primitives/MACI/MACI.md)
