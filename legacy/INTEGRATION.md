# Integration Guide

온체인(Solidity) ↔ 오프체인(TypeScript) 통합 가이드

## 구조

```
온체인 (Solidity)          오프체인 (TypeScript)
├── SecureVoting.sol    ←→  ├── crypto/elgamal.ts (암호화)
├── MerkleProof.sol     ←→  ├── crypto/dkg.ts (threshold)
└── 투표 저장소             └── aggregator.ts (Merkle)
```

## 통합된 기능

### 1. Merkle Proof 검증 (신규 추가)

**온체인 (SecureVoting.sol):**
```solidity
function verifyVoteProof(
    uint256 proposalId,
    uint256 voteIndex,
    address voter,
    uint256 vote,
    uint256 timestamp,
    bytes32[] calldata proof
) external view returns (bool)
```

**오프체인 (aggregator.ts):**
```typescript
// Merkle proof 생성
const proof = aggregator.generateMerkleProof(votes, voteIndex);

// Solidity와 동일한 형식으로 leaf 생성 (abi.encode)
const leaf = keccak256(
  abiCoder.encode(
    ['uint256', 'address', 'uint256', 'uint256'],
    [voteIndex, voter, vote, timestamp]
  )
);
```

**핵심:** 온체인과 오프체인이 **동일한 인코딩 방식** 사용 (abi.encode)

---

## 전체 플로우

### Step 1: 위원회 키 생성 (오프체인)

```typescript
const { publicKey, shares } = generateThresholdKey(5, 3);
// publicKey는 온체인 배포 시 사용
```

### Step 2: 투표자 투표 (브라우저 → 온체인)

```typescript
// 브라우저에서 암호화
const ciphertext = encrypt(vote, publicKey);
const serialized = serializeCiphertext(ciphertext);

// 온체인 제출
await voting.commitVote(proposalId, `0x${serialized}`);
```

### Step 3: 위원회 복호화 (오프체인)

```typescript
// k명의 위원이 shares 교환
const sharesMap = createAllDecryptionShares(votes, secretShares);

// 복호화
const decryptedVotes = aggregator.decryptVotes(sharesMap);

// 집계 + Merkle root
const result = aggregator.tallyVotes(decryptedVotes);
// result.votesRoot = "0x..."
```

### Step 4: 집계 제출 (오프체인 → 온체인)

```typescript
await voting.submitTally(
  proposalId,
  result.yesVotes,
  result.noVotes,
  result.votesRoot  // Merkle root
);
```

### Step 5: Dispute 시 검증 (온체인)

```typescript
// Merkle proof 생성 (오프체인)
const proof = aggregator.generateMerkleProof(votes, voteIndex);

// 온체인 검증
const isValid = await voting.verifyVoteProof(
  proposalId,
  voteIndex,
  voter,
  vote,
  timestamp,
  proof
);
```

---

## 로컬 테스트 실행

### 방법 1: 자동 스크립트

```bash
# 전체 통합 테스트 (anvil 자동 시작/종료)
./scripts/test-integration.sh
```

이 스크립트는:
1. `anvil` 시작 (로컬 Foundry 네트워크)
2. 컨트랙 배포
3. 통합 테스트 실행
4. 자동 정리

### 방법 2: 수동 실행

**Terminal 1: Anvil 시작**
```bash
anvil
```

**Terminal 2: 컨트랙 배포**
```bash
forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

배포된 주소 복사 (예: `0x5FbDB2315678afecb367f032d93F642f64180aa3`)

**Terminal 3: 통합 테스트**
```bash
cd offchain
export CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
npm run integration
```

---

## 데이터 형식 호환성

### Merkle Leaf 생성

**오프체인 (TypeScript):**
```typescript
import { AbiCoder, keccak256 } from 'ethers';

const abiCoder = AbiCoder.defaultAbiCoder();
const leaf = keccak256(
  abiCoder.encode(
    ['uint256', 'address', 'uint256', 'uint256'],
    [voteIndex, voter, vote, timestamp]
  )
);
```

**온체인 (Solidity):**
```solidity
bytes32 leaf = keccak256(
  abi.encode(voteIndex, voter, vote, timestamp)
);
```

**중요:** `abi.encode` 사용 (NOT `abi.encodePacked`)

### Ciphertext 저장

- 오프체인: `serializeCiphertext()` → hex string
- 온체인: `bytes` 타입으로 저장
- 형식: `C1 (64 bytes) || C2 (64 bytes)` = 128 bytes

---

## 주요 변경사항

### 온체인 (SecureVoting.sol)

**추가:**
- `import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol"`
- `function verifyVoteProof(...)` - Merkle proof 검증
- OpenZeppelin remapping: `@openzeppelin/=lib/openzeppelin-contracts/`

### 오프체인 (aggregator.ts)

**변경:**
- `import { AbiCoder }` from ethers 추가
- Merkle leaf 생성 시 `abi.encode` 사용 (JSON.stringify → abi.encode)
- 모든 Merkle 관련 함수가 Solidity와 호환되는 형식 사용

---

## 트러블슈팅

### 1. Merkle proof 검증 실패

**원인:** 오프체인과 온체인의 leaf 인코딩 불일치

**해결:**
```typescript
// ✗ 잘못된 방식
keccak256(JSON.stringify({...}))

// ✓ 올바른 방식
keccak256(abiCoder.encode([...], [...]))
```

### 2. 컨트랙 주소를 못 찾음

**해결:**
```bash
# 배포 로그에서 주소 찾기
forge script ... 2>&1 | grep "deployed at"
```

### 3. viem 설치 오류

**해결:**
```bash
cd offchain
npm install --save-dev viem
```

---

## 다음 단계

### Phase 2: 프로덕션 준비
- [ ] 실제 DKG 프로토콜 (Pedersen DKG)
- [ ] Dispute 해결 메커니즘 완성
- [ ] Gas 최적화
- [ ] 감사

### Phase 3: 프론트엔드
- [ ] React/Next.js UI
- [ ] Wallet 연동 (MetaMask, WalletConnect)
- [ ] 실시간 투표 현황 표시

---

## 참고

- Foundry 문서: https://book.getfoundry.sh/
- Viem 문서: https://viem.sh/
- OpenZeppelin: https://docs.openzeppelin.com/
