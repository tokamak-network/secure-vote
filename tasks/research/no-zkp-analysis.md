# ZKP 없이 Trustless Bribery 불가능 만들기

## 목표
- ZKP 사용 안함 (비용 문제)
- Trustless bribery attack 불가능
- 즉, 뇌물 제공자가 온체인에서 투표 검증 불가능

---

## 핵심 인사이트

### Bribery가 가능한 이유
```
1. Voter가 ciphertext C = (g^r, g^v · pk^r) 제출
2. Voter가 r, v를 briber에게 공개
3. Briber가 온체인 C와 대조하여 검증
→ Trustless bribery 성공
```

### Vote Overwrite만으로 부족한 이유
```
Briber: "마지막 투표의 r을 알려줘"
Voter: 마지막 r 공개
Briber: 온체인 최종 ciphertext와 검증
→ 여전히 검증 가능
```

---

## 해결책: Rerandomization

### 원리
ElGamal은 **rerandomizable**:
```
원본: C = (g^r, g^v · pk^r)
재랜덤화: C' = (g^(r+r'), g^v · pk^(r+r'))
         = (C₁ · g^r', C₂ · pk^r')
```

- 같은 메시지 v를 암호화
- 하지만 randomness가 (r + r')로 변경
- r'을 모르면 voter는 증명 불가!

### 프로토콜

```
1. Setup
   - Committee generates threshold keypair (sk, pk)
   - sk는 k-of-n threshold로 분산

2. Vote Submission
   - Voter: C = Encrypt(v, pk, r)  // r은 voter만 알음
   - Submit C to contract

3. Rerandomization (핵심!)
   - Rerandomizer picks random r'
   - C' = Rerandomize(C, r')
   - 원본 C 삭제, C'만 저장

4. Aggregation (on-chain)
   - Agg = C'₁ * C'₂ * ... * C'ₙ  // homomorphic multiplication
   - 개별 ciphertext가 아닌 aggregate만 유지

5. Decryption
   - Committee threshold-decrypts Agg
   - 결과: v₁ + v₂ + ... + vₙ (합계만)
```

### Bribery 불가능 증명

```
Briber: "투표 증명해"
Voter: "내 randomness는 r이었어"
Briber: 검증 시도...
  - 원본 C = (g^r, g^v · pk^r) 계산
  - 온체인에서 C 찾기... 없음! (삭제됨)
  - C'만 있는데 r'을 모르니 검증 불가
→ Trustless bribery 실패!
```

---

## 구현 옵션 비교

### Option A: Committee Rerandomization

```
Voter → Contract → Committee rerandomizes → Aggregate
```

**장점:**
- 구현 간단
- Committee가 이미 존재

**단점:**
- Committee가 원본 C를 봄
- Committee + Briber 공모 시 검증 가능

**보안 가정:** Committee 중 1명이라도 정직하면 r' 비밀 유지

### Option B: Threshold Rerandomization

```
Voter → Contract → k-of-n rerandomize → Aggregate
```

**작동 방식:**
```
r' = r'₁ + r'₂ + ... + r'ₙ  (각 committee member가 기여)
C' = C · (g^r'₁, pk^r'₁) · (g^r'₂, pk^r'₂) · ...
```

**장점:**
- 모든 member가 공모해야 r' 알 수 있음
- 더 강한 보안

**단점:**
- 더 많은 통신 라운드
- 구현 복잡

**보안 가정:** n명 중 1명이라도 정직

### Option C: On-chain Immediate Aggregation (No Rerandomization)

```
Voter → Contract (immediately aggregates) → Committee decrypts sum
```

**작동 방식:**
```solidity
// 개별 ciphertext 저장 안함, 바로 aggregate에 곱함
function vote(bytes c1, bytes c2) {
    aggregate_c1 = aggregate_c1 * c1;
    aggregate_c2 = aggregate_c2 * c2;
    // 개별 (c1, c2) 저장 안함!
}
```

**장점:**
- Rerandomizer 불필요
- 가장 간단한 구현
- Gas 효율적 (저장 최소화)

**단점:**
- Transaction log에 개별 ciphertext 남음
- Briber가 log에서 추출하여 검증 가능
- **Trustless bribery 방지 안됨!**

### Option D: Commit-then-Rerandomize

```
Phase 1: Voter commits hash(C)
Phase 2: Voter reveals C (without r)
Phase 3: Committee rerandomizes C → C'
Phase 4: C' aggregated
```

**장점:**
- Voter가 reveal할 때 r 안보내도 됨
- Committee가 C만 보고 rerandomize

**문제:**
- Voter가 나중에 r 공개하면?
- 여전히 C와 매칭 가능

**결론:** Rerandomization 후 **원본 C 삭제**가 핵심

---

## 최종 권장: Option A + 즉시 삭제

### 프로토콜

```
1. Voter submits C to contract
2. Contract stores C temporarily (or emits event only)
3. Committee member picks up C, rerandomizes to C'
4. Committee submits C' to aggregate
5. Original C reference deleted from contract state

Key: C는 event log에만 남고, state에서는 C'만 존재
```

### Event Log 문제 해결

Event log에 C가 남는 문제:
- **해결책 1:** Voter가 dummy votes도 제출 (which is real?)
- **해결책 2:** Encrypted channel로 C 전송 (off-chain)
- **해결책 3:** Commit-reveal with blinding

**실용적 해결책 (해결책 2):**
```
1. Voter encrypts C with committee's encryption key
2. Submits encrypted_C on-chain (commitment)
3. Committee decrypts off-chain, rerandomizes
4. Committee submits C' aggregate on-chain
```

이 경우 on-chain에는 encrypted_C만 있고, 이것만으로는 검증 불가.

---

## 구현 복잡도 비교

| 옵션 | Gas 비용 | 구현 난이도 | Trustless Bribery 방지 |
|------|---------|------------|----------------------|
| A. Committee rerand | 중간 | 낮음 | O (1명 정직 가정) |
| B. Threshold rerand | 높음 | 높음 | O (1명 정직 가정) |
| C. Immediate agg | 낮음 | 매우 낮음 | **X** (log 노출) |
| D. Commit-reveal | 중간 | 중간 | O (삭제 필요) |

---

## 보안 가정 정리

### ZKP 없이 달성 가능한 것
- ✅ Ballot secrecy (개별 투표 비공개)
- ✅ Receipt-freeness (투표 증명 불가)
- ✅ Trustless bribery resistance

### ZKP 없이 달성 불가능한 것
- ❌ Vote validity verification (0 or 1 검증)
- ❌ Correct decryption verification
- ❌ Universal verifiability

### 필수 신뢰 가정
- Committee 중 1명 이상 정직 (rerandomization 비밀 유지)
- Committee majority 정직 (threshold decryption)

---

## 현재 구현과의 차이

| 현재 | 필요한 변경 |
|------|------------|
| Silent Setup (n-of-n) | k-of-n도 OK |
| 개별 ciphertext 저장 | Aggregate만 저장 |
| Merkle root로 dispute | Merkle 제거 (개별 투표 증명 불가) |
| Committee가 개별 투표 봄 | Rerandomize 후 aggregate만 |

### 핵심 변경사항
1. **Rerandomization 추가** - 가장 중요!
2. **Homomorphic aggregation** - 온체인 또는 오프체인
3. **원본 ciphertext 삭제** - state에서 제거
4. **Merkle proof 제거** - 개별 투표 증명 경로 차단

---

## 결론

**ZKP 없이 trustless bribery 방지의 핵심:**

```
Rerandomization + Homomorphic Aggregation + 원본 삭제
```

**Trade-off:**
- 장점: ZKP 비용 없음, 구현 간단
- 단점: 투표 유효성 검증 불가 (악의적 투표 가능)

**악의적 투표 문제 완화:**
- 투표 weight 제한 (최대 영향 제한)
- Economic penalty (잘못된 투표 시 슬래싱)
- 사후 감사 (dispute 기간)

---

## References

- [Receipt-Free K-out-of-L Voting Based on ElGamal Encryption](https://crypto.ethz.ch/publications/files/Hirt10.pdf)
- [Homomorphic Tallying for Estonian Internet Voting](https://eprint.iacr.org/2016/776.pdf)
- [ElGamal Homomorphic Addition](https://medium.com/@pellabeuf/homomorphic-encryptions-hidden-potential-elgamal-addition-a9c5d79bc9e7)
- [Providing Receipt-Freeness in Mixnet-Based Voting](https://www.researchgate.net/profile/Byoungcheon-Lee/publication/27482075_Providing_Receipt-Freeness_In_Mixnet-Based_Voting_Protocols)
