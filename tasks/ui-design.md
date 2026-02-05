# MACI + Fraud Proof UI 설계

## 사용자 역할

| 역할 | 설명 | 기능 |
|------|------|------|
| **Voter** | 일반 투표자 | 키 생성, 투표, 키 변경 |
| **Coordinator** | 메시지 처리자 | State root 제출 (proof 없이) |
| **Committee** | 복호화 위원회 | 최종 집계 복호화 |
| **Challenger** | 검증자 (누구나) | 잘못된 state root challenge |

---

## 페이지 구조

```
/                       # 메인 - 제안 목록
/vote/[id]              # 투표 페이지 (키 관리 포함)
/coordinator            # Coordinator 대시보드 (신규)
/committee              # Committee 대시보드 (수정)
/results/[id]           # 결과 페이지
```

---

## 상세 UI 플로우

### 1. 메인 페이지 (`/`)

**변경 없음** - 기존과 동일
- 제안 목록 표시
- Setup Demo 버튼
- 투표 상태 표시

---

### 2. 투표 페이지 (`/vote/[id]`) - 대폭 수정

#### 2.1 첫 투표 시 (키 없음)

```
┌─────────────────────────────────────────┐
│  📋 Proposal: "Should we upgrade?"      │
│                                         │
│  ⚠️ First time voting?                  │
│  Generate your voter key to participate │
│                                         │
│  [🔑 Generate Voter Key]                │
│                                         │
│  Your key is stored locally and used    │
│  to encrypt your vote. Keep it safe!    │
└─────────────────────────────────────────┘
```

#### 2.2 키 생성 후 투표

```
┌─────────────────────────────────────────┐
│  📋 Proposal: "Should we upgrade?"      │
│                                         │
│  🔑 Your Voter Key: 0x1234...abcd       │
│  Status: Active (nonce: 0)              │
│                                         │
│  Cast your vote:                        │
│  ┌─────────┐  ┌─────────┐               │
│  │   Yes   │  │   No    │               │
│  └─────────┘  └─────────┘               │
│                                         │
│  ─────────────────────────────────────  │
│  🔄 Change Key (Advanced)               │
│  Use this if you suspect your key is    │
│  compromised or want to change vote.    │
│  [Change Key & Revote]                  │
└─────────────────────────────────────────┘
```

#### 2.3 키 변경 플로우 (bribery 방어 핵심)

```
┌─────────────────────────────────────────┐
│  🔄 Change Your Voter Key               │
│                                         │
│  Current Key: 0x1234...abcd (nonce: 0)  │
│                                         │
│  ⚠️ Why change your key?                │
│  • Your previous vote will be invalid   │
│  • Use if someone pressured you to vote │
│  • Your new vote will be the only valid │
│                                         │
│  New vote:                              │
│  ○ Yes  ○ No                            │
│                                         │
│  [🔑 Generate New Key & Vote]           │
│                                         │
│  This will:                             │
│  1. Generate a new key pair             │
│  2. Invalidate your old key             │
│  3. Submit your new vote                │
└─────────────────────────────────────────┘
```

#### 2.4 투표 완료 후

```
┌─────────────────────────────────────────┐
│  ✅ Vote Submitted!                     │
│                                         │
│  Your encrypted vote has been recorded. │
│                                         │
│  Key: 0x5678...efgh (nonce: 1)          │
│  Voted: [Hidden until tally]            │
│                                         │
│  💡 Remember:                           │
│  • You can change your vote anytime     │
│    before the deadline by changing key  │
│  • Only your LAST vote counts           │
│  • No one can prove how you voted       │
│                                         │
│  [Change Vote] [Back to Home]           │
└─────────────────────────────────────────┘
```

---

### 3. Coordinator 페이지 (`/coordinator`) - 신규

```
┌─────────────────────────────────────────┐
│  🎛️ Coordinator Dashboard               │
│                                         │
│  Your Role: Process encrypted messages  │
│  and submit state roots to blockchain.  │
│                                         │
│  ─────────────────────────────────────  │
│  📊 Proposal #1: "Should we upgrade?"   │
│  Status: Voting Closed                  │
│  Messages: 42 pending                   │
│                                         │
│  [Process Messages]                     │
│                                         │
│  ─────────────────────────────────────  │
│  📊 Proposal #0: "Previous proposal"    │
│  Status: State Root Submitted           │
│  State Root: 0xabcd...1234              │
│  Challenge Period: 6 days remaining     │
│                                         │
│  [View Details]                         │
└─────────────────────────────────────────┘
```

#### 3.1 Process Messages 결과

```
┌─────────────────────────────────────────┐
│  ✅ Messages Processed                  │
│                                         │
│  Proposal #1                            │
│  • Total messages: 42                   │
│  • Valid votes: 38                      │
│  • Key changes: 4                       │
│  • Invalid (old keys): 4               │
│                                         │
│  New State Root: 0xdef0...5678          │
│                                         │
│  [Submit State Root]                    │
│                                         │
│  ⚠️ No ZKP required for submission.     │
│  Challenge period: 7 days after submit. │
└─────────────────────────────────────────┘
```

---

### 4. Committee 페이지 (`/committee`) - 수정

```
┌─────────────────────────────────────────┐
│  🔐 Committee Dashboard                 │
│                                         │
│  Your Role: Decrypt final tally after   │
│  challenge period ends.                 │
│                                         │
│  ─────────────────────────────────────  │
│  📊 Proposal #1: "Should we upgrade?"   │
│  State Root: 0xdef0...5678              │
│  Challenge Period: ✅ Ended             │
│                                         │
│  [Decrypt & Finalize]                   │
│                                         │
│  ─────────────────────────────────────  │
│  📊 Proposal #0: "Previous proposal"    │
│  Status: ✅ Finalized                   │
│  Result: Yes 25 / No 13                 │
│                                         │
│  [View Details]                         │
└─────────────────────────────────────────┘
```

---

### 5. Challenge UI (누구나 접근 가능)

제안 상세 페이지에 추가:

```
┌─────────────────────────────────────────┐
│  ⚠️ Challenge Period Active             │
│  Ends: 2024-02-12 15:00 (6 days)        │
│                                         │
│  State Root: 0xdef0...5678              │
│  Submitted by: 0xCoord...               │
│                                         │
│  Think this is wrong?                   │
│  [Challenge State Root]                 │
│                                         │
│  Requires: 1 ETH bond                   │
│  If correct: You lose bond              │
│  If incorrect: Coordinator slashed      │
└─────────────────────────────────────────┘
```

---

## 로컬 스토리지 구조

```typescript
// Voter keys stored in localStorage
interface VoterKeyStorage {
  [proposalId: string]: {
    currentKey: {
      publicKey: string;   // hex
      privateKey: string;  // hex (encrypted with password?)
      nonce: number;
    };
    keyHistory: {
      publicKey: string;
      nonce: number;
      createdAt: number;
      revokedAt?: number;
    }[];
  };
}

// localStorage key: 'secure-vote-keys'
```

---

## API 엔드포인트 변경

### 기존 유지
- `GET /api/public-key` - Coordinator 공개키
- `POST /api/skip-time` - 데모용 시간 이동

### 수정
- `POST /api/encrypt-vote` → `POST /api/submit-message`
  - Input: `{ proposalId, voterPubKey, vote, newKey? }`
  - Output: `{ success, messageHash }`

- `POST /api/decrypt-tally` → `POST /api/finalize-tally`
  - Challenge period 후에만 호출 가능

### 신규
- `POST /api/generate-voter-key`
  - Output: `{ publicKey, privateKey }`

- `POST /api/process-messages` (Coordinator용)
  - Input: `{ proposalId }`
  - Output: `{ stateRoot, stats }`

- `POST /api/submit-state-root` (Coordinator용)
  - Input: `{ proposalId, stateRoot }`

- `POST /api/challenge` (누구나)
  - Input: `{ proposalId }`
  - Requires: Bond payment

---

## 사용자 플로우 요약

### Voter 플로우
```
1. 첫 방문 → 키 생성 (자동 또는 수동)
2. 투표 (암호화된 메시지 제출)
3. (선택) 키 변경하여 재투표
4. 결과 확인 (challenge period 후)
```

### Coordinator 플로우
```
1. 투표 마감 후 메시지 처리
2. State root 계산 및 제출
3. Challenge 대응 (필요시 ZKP 제출)
```

### Committee 플로우
```
1. Challenge period 종료 확인
2. 최종 집계 복호화
3. 결과 온체인 제출
```

---

## 구현 우선순위

### Phase 1: 핵심 기능
1. [ ] Voter 키 생성/저장 UI
2. [ ] 키 기반 투표 제출
3. [ ] Coordinator 메시지 처리

### Phase 2: 키 변경
4. [ ] 키 변경 UI
5. [ ] 키 변경 메시지 처리
6. [ ] 이전 투표 무효화 로직

### Phase 3: Challenge
7. [ ] State root 제출 UI
8. [ ] Challenge period 표시
9. [ ] Challenge 제출 UI

### Phase 4: 완성
10. [ ] Committee 복호화 수정
11. [ ] 결과 페이지 업데이트
12. [ ] 에러 처리 및 UX 개선
