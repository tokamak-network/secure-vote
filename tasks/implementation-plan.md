# MACI + Fraud Proof 구현 계획

## 목표

- Trustless bribery-free 투표 시스템
- ZKP는 challenge 시에만 사용 (비용 절감)
- MACI 키 변경 메커니즘으로 bribery 방어

---

## 구현 단계

### Step 1: 기존 코드 정리

**작업:**
- [ ] 기존 Silent Setup 코드 → `offchain/src/crypto/legacy/`로 이동
- [ ] 기존 테스트 유지 (regression 방지)
- [ ] 새 구조를 위한 디렉토리 생성

**파일 구조:**
```
offchain/src/
├── crypto/
│   ├── legacy/           # 기존 코드 보관
│   │   ├── elgamal.ts
│   │   ├── silent-setup.ts
│   │   └── dkg.ts
│   └── maci/             # 새 MACI 구현
│       ├── keys.ts       # 키 생성/변경
│       ├── encryption.ts # 메시지 암호화
│       └── index.ts
├── coordinator/          # Coordinator 로직
│   ├── processor.ts      # 메시지 처리
│   ├── state.ts          # State 관리
│   └── index.ts
└── index.ts
```

---

### Step 2: MACI 키 구조 구현

**작업:**
- [ ] Voter 키 쌍 생성 (voter_sk, voter_pk)
- [ ] 키 변경 메커니즘
- [ ] 메시지 암호화 (vote + nonce + new_key)

**인터페이스:**
```typescript
// offchain/src/crypto/maci/keys.ts

interface VoterKeyPair {
  privateKey: Scalar;
  publicKey: G1Point;
  nonce: number;  // 키 변경 횟수 추적
}

interface EncryptedMessage {
  voterPubKey: G1Point;      // 현재 voter public key
  encryptedData: Ciphertext; // Encrypt(vote, newKey?, nonce)
  timestamp: number;
}

function generateVoterKeyPair(): VoterKeyPair;
function changeKey(oldKey: VoterKeyPair): VoterKeyPair;
function encryptMessage(
  vote: 0 | 1,
  voterKey: VoterKeyPair,
  coordinatorPubKey: G1Point,
  newKey?: VoterKeyPair  // 키 변경 시
): EncryptedMessage;
```

---

### Step 3: Coordinator 처리 로직

**작업:**
- [ ] 메시지 복호화 (threshold)
- [ ] 키 변경 추적 및 최신 투표만 유효 처리
- [ ] State tree 관리
- [ ] State root 계산

**인터페이스:**
```typescript
// offchain/src/coordinator/processor.ts

interface VoterState {
  pubKey: G1Point;
  vote: 0 | 1 | null;
  nonce: number;
}

interface ProcessorState {
  voters: Map<string, VoterState>;  // pubKeyHash -> state
  stateRoot: string;
}

class MessageProcessor {
  private state: ProcessorState;
  private thresholdKey: ThresholdSecretKey;

  // 메시지 처리 (ZKP 없이)
  processMessage(msg: EncryptedMessage): void;

  // 최종 상태
  getStateRoot(): string;

  // 집계 (ZKP 없이)
  tally(): { yes: number; no: number };
}
```

---

### Step 4: Smart Contract 수정

**작업:**
- [ ] 기존 `SecureVoting.sol` → `SecureVotingLegacy.sol`
- [ ] 새 `MACIVoting.sol` 작성
- [ ] Challenge/Response 메커니즘
- [ ] Bond 관리

**컨트랙트 구조:**
```solidity
// src/MACIVoting.sol

contract MACIVoting {
    // === State ===
    bytes32 public coordinatorPubKey;
    uint256 public coordinatorBond;

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => bytes32) public stateRoots;
    mapping(uint256 => Challenge) public challenges;

    // === 투표 제출 ===
    function submitMessage(
        uint256 proposalId,
        bytes calldata encryptedMessage
    ) external;

    // === State Root 제출 (proof 없음) ===
    function submitStateRoot(
        uint256 proposalId,
        bytes32 newRoot
    ) external onlyCoordinator;

    // === Challenge ===
    function challenge(uint256 proposalId) external payable;

    function respondToChallenge(
        uint256 proposalId,
        bytes calldata proof
    ) external onlyCoordinator;

    // === Finalization ===
    function finalize(uint256 proposalId) external;
}
```

---

### Step 5: Challenge용 ZKP Circuit (후순위)

**작업:**
- [ ] MACI circuit 분석
- [ ] 메시지 처리 circuit 설계
- [ ] Circom/Noir로 구현
- [ ] Verifier 컨트랙트 생성

**참고:** 이 단계는 MVP 이후 구현 가능.
Happy path는 ZKP 없이 동작.

---

### Step 6: 프론트엔드 연동

**작업:**
- [ ] 키 생성/변경 UI
- [ ] 메시지 암호화 및 제출
- [ ] 키 변경 기능
- [ ] 결과 조회

---

## 파일별 구현 순서

### Week 1: 핵심 암호화
```
1. offchain/src/crypto/maci/keys.ts
2. offchain/src/crypto/maci/encryption.ts
3. offchain/test/maci-keys.test.ts
```

### Week 2: Coordinator
```
4. offchain/src/coordinator/state.ts
5. offchain/src/coordinator/processor.ts
6. offchain/test/coordinator.test.ts
```

### Week 3: Smart Contract
```
7. src/MACIVoting.sol
8. test/MACIVoting.t.sol
9. script/DeployMACI.s.sol
```

### Week 4: 통합
```
10. offchain/src/integration/maci-contract.ts
11. offchain/test/integration.test.ts
12. 프론트엔드 연동
```

---

## 테스트 계획

### Unit Tests
```
- [ ] 키 생성/변경
- [ ] 메시지 암호화/복호화
- [ ] State 업데이트
- [ ] State root 계산
```

### Integration Tests
```
- [ ] 전체 투표 플로우 (happy path)
- [ ] 키 변경 후 투표
- [ ] 여러 voter 동시 투표
```

### Bribery Resistance Tests
```
- [ ] 키 변경 후 이전 투표 무효화 확인
- [ ] Coordinator가 개별 투표 증명 불가 확인
```

### Challenge Tests (ZKP 구현 후)
```
- [ ] 유효한 challenge → coordinator proof 제출
- [ ] 무효한 challenge → challenger slashing
- [ ] Timeout → coordinator slashing
```

---

## 의존성

### 기존 유지
- `@noble/curves` (BN254)
- `ethers` (컨트랙트 연동)

### 추가 필요
- 없음 (MVP 기준)

### ZKP 구현 시 추가
- `circom` 또는 `noir`
- `snarkjs`

---

## 마일스톤

| 마일스톤 | 목표 | 완료 기준 |
|---------|------|----------|
| M1 | 키 구조 | 키 생성/변경 테스트 통과 |
| M2 | 메시지 처리 | Coordinator 처리 테스트 통과 |
| M3 | 컨트랙트 | 온체인 투표 제출/finalize 동작 |
| M4 | 통합 | E2E 테스트 통과 |
| M5 | ZKP (선택) | Challenge 시나리오 동작 |

---

## 리스크 및 완화

| 리스크 | 영향 | 완화 |
|--------|------|------|
| ZKP circuit 복잡 | M5 지연 | MVP는 ZKP 없이 동작 |
| MACI 구조 이해 부족 | 전체 지연 | PSE 문서/코드 참고 |
| Gas 비용 예상 초과 | 비용 증가 | Calldata 최적화 |

---

## 시작점

**첫 번째 PR:**
1. 디렉토리 구조 생성
2. `keys.ts` 기본 구현
3. 키 생성 테스트

```bash
# 시작 명령
cd offchain
mkdir -p src/crypto/maci src/coordinator
touch src/crypto/maci/keys.ts
touch src/crypto/maci/encryption.ts
touch src/coordinator/processor.ts
```
