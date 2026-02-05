# Voting System Options Comparison

**목표**: Trustless bribery resistance + 확장성(비용) + 최소 보안 가정

---

## 1. 옵션 비교 매트릭스

| 접근법 | 비용 (Gas) | 보안 가정 | Bribery Resistance | 성숙도 |
|--------|-----------|----------|-------------------|--------|
| **A. MACI (현재)** | 중간 | Coordinator 신뢰 | 부분적 (coordinator 공모 가능) | Production |
| **B. MACI + Threshold** | 중간 | k-of-n 위원회 | 높음 (k명 이상 공모 필요) | 개발중 (PSE) |
| **C. Homomorphic + ZK** | 높음 | 없음 (trustless) | 완전 | 연구단계 |
| **D. Time-lock Encryption** | 낮음 | 시간 가정 + VDF | 시간 제한적 | 초기 |
| **E. FROST + ZK Voting** | 중간 | k-of-n 서명자 | 높음 | 초기 |

---

## 2. 상세 분석

### A. MACI (Minimal Anti-Collusion Infrastructure)

**현재 상태**: [PSE에서 운영중](https://maci.pse.dev/)

**작동 방식**:
- Coordinator가 공개키 보유, 모든 투표 암호화
- 사용자가 키 변경 가능 → 뇌물 제공자가 최종 투표 확인 불가
- ZK proof로 집계 정확성 증명

**장점**:
- 실제 사용 가능 (Gitcoin, ETHDenver 등)
- 투표 덮어쓰기로 pre-tally bribery 방어

**단점**:
- **Coordinator가 cleartext 볼 수 있음** → 공모 가능
- 단일 실패점 (Single Point of Failure)

**Gas 비용**: ~200k per vote + 집계 ZK proof 검증

**참고**: [PSE Technical Report](https://github.com/privacy-scaling-explorations/technical-reports/blob/main/reports/Applied_ZKP_Primitives/MACI/MACI.md)

---

### B. MACI + Threshold Decryption (PSE 개발중)

**상태**: [2024-2025 로드맵에 포함](https://github.com/privacy-scaling-explorations/maci/discussions/859)

**작동 방식**:
- Coordinator → k-of-n 위원회로 분산
- ElGamal threshold encryption 사용
- 위원회가 부분 복호화 제공, 집계

**장점**:
- Coordinator 단일점 제거
- k명 이상 공모해야 투표 내용 노출

**단점**:
- 여전히 위원회 신뢰 필요 (k < n일 때)
- ElGamal 통합 작업 진행중 ([feat/elgamal branch](https://github.com/privacy-scaling-explorations/maci/tree/feat/elgamal))

**보안 가정**: k-of-n 위원회 중 최소 (n-k+1)명이 정직

---

### C. Fully Homomorphic Encryption (FHE) + ZK

**최신 연구**: [Fhenix](https://www.fhenix.io/), [zkVoting 2024](https://eprint.iacr.org/2024/1003.pdf)

**작동 방식**:
- 모든 투표를 FHE로 암호화
- 온체인에서 암호화된 상태로 집계 (homomorphic addition)
- ZK proof로 투표 유효성 증명
- 복호화 없이 결과 도출

**장점**:
- **완전 trustless** - 아무도 개별 투표 볼 수 없음
- 온체인 집계 가능 (투명성)

**단점**:
- **Gas 비용 매우 높음** (FHE 연산)
- 현재 기술로는 실용적이지 않음
- CoFHE 같은 coprocessor 필요 → 다시 신뢰 가정 도입

**Gas 비용**: 현재 ~1M+ gas per operation (개선중)

**참고**: [Chainlink FHE 설명](https://chain.link/education-hub/homomorphic-encryption)

---

### D. Time-lock Encryption (Shutter Network 방식)

**작동 방식**:
- 투표를 time-lock puzzle로 암호화
- 특정 시간이 지나야 복호화 가능
- VDF (Verifiable Delay Function) 사용

**장점**:
- 설정 간단
- 위원회 없이 시간만으로 보안

**단점**:
- **시간 기반 가정** - 충분한 연산력으로 조기 복호화 가능
- VDF 하드웨어 발전에 취약
- Bribery 계약이 시간 후 검증 가능 → post-tally bribery 방어 안됨

---

### E. FROST + ZK Voting

**최신 연구**: [RFC 9591](https://datatracker.ietf.org/doc/rfc9591/), [Safe FROST](https://safe.global/blog/frost-brings-secure-scalable-threshold-signatures-to-the-evm)

**작동 방식**:
- FROST로 k-of-n threshold 서명
- 투표 암호화 + ZK proof 조합
- 분산 coordinator 역할

**장점**:
- 2-round로 효율적
- Coordinator 없이 분산 가능
- 수백~수천 서명자 지원

**단점**:
- [Decentralized 환경에서 unidentifiability 이슈](https://www.certik.com/resources/blog/threshold-cryptography-ii-unidentifiability-in-decentralized-frost) (악의적 참여자가 정직한 참여자 모함 가능)
- 투표 전용 설계 아님 (서명 스킴)

---

## 3. Bribery Resistance 분석

### Bribery 유형

| 유형 | 설명 | 방어 메커니즘 |
|------|------|--------------|
| **Pre-vote** | 투표 전 뇌물로 특정 투표 유도 | 투표 덮어쓰기, 키 변경 |
| **Post-vote** | 투표 후 증명 제출로 보상 | 개별 투표 비공개, Merkle 없음 |
| **Coercion** | 강압으로 특정 투표 강제 | Receipt-freeness |

### 각 옵션의 Bribery Resistance

| 옵션 | Pre-vote | Post-vote | Coercion | Trustless? |
|------|----------|-----------|----------|------------|
| MACI | O (키 변경) | X (coordinator 공모) | X | **No** |
| MACI+Threshold | O | △ (k명 공모시) | △ | **Partial** |
| FHE+ZK | O | O | O | **Yes** |
| Time-lock | O | X (시간 후 공개) | X | **No** |
| FROST+ZK | O | △ | △ | **Partial** |

---

## 4. 권장 접근법

### 단기 (현실적): MACI + Threshold (옵션 B)

**이유**:
- PSE가 이미 개발중 → 재사용 가능
- 현재 구현(Silent Setup)과 유사한 구조
- k-of-n으로 현실적인 보안 제공

**필요 작업**:
1. Silent Setup → k-of-n threshold 확장
2. MACI 스타일 키 변경 메커니즘 추가
3. ZK proof로 집계 검증

**보안 가정**: 위원회의 과반수(또는 threshold)가 정직

---

### 장기 (이상적): Hybrid FHE + Threshold

**접근법**:
1. 투표는 additively homomorphic encryption (Paillier/ElGamal)
2. 온체인에서 암호화된 상태로 합산
3. Threshold decryption으로 최종 결과만 복호화
4. ZK proof로 투표 유효성 + 집계 정확성 증명

**장점**:
- 개별 투표 절대 노출 안됨 (trustless privacy)
- Post-tally bribery 불가능
- 위원회는 합계만 복호화 (개별 투표 못 봄)

**단점**:
- 구현 복잡도 높음
- Gas 비용 (Layer 2 필요)

---

## 5. 현재 구현과의 Gap 분석

| 현재 | 목표 | Gap |
|------|------|-----|
| n-of-n Silent Setup | k-of-n threshold | Lagrange interpolation 추가 |
| Merkle root 공개 | 개별 투표 비공개 | Merkle 제거 또는 ZK 대체 |
| 위원회가 투표 봄 | 위원회도 합계만 | Homomorphic 집계 필요 |
| 단순 집계 | ZK 검증 가능 집계 | ZK circuit 개발 |

---

## 6. 결론

### Trustless Bribery Resistance를 위한 핵심 요소

1. **키 변경 가능** → Pre-vote bribery 방어
2. **개별 투표 비공개** → Post-vote bribery 방어
3. **Homomorphic 집계** → 위원회도 개별 투표 못 봄
4. **ZK 검증** → Trustless 정확성 보장

### 추천 로드맵

```
Phase 1: k-of-n Threshold (현재 → 3개월)
├── Silent Setup 확장
├── Lagrange interpolation
└── 위원회 분산

Phase 2: MACI 스타일 키 변경 (3-6개월)
├── 키 변경 메커니즘
├── ZK proof 통합
└── Anti-collusion 강화

Phase 3: Homomorphic 집계 (6-12개월)
├── Additive HE (ElGamal/Paillier)
├── 온체인 암호화 집계
└── Threshold 결과 복호화만
```

---

## Sources

- [MACI Technical Report](https://github.com/privacy-scaling-explorations/technical-reports/blob/main/reports/Applied_ZKP_Primitives/MACI/MACI.md)
- [MACI 2024 Roadmap](https://github.com/privacy-scaling-explorations/maci/discussions/859)
- [zkVoting 2024](https://eprint.iacr.org/2024/1003.pdf)
- [FROST RFC 9591](https://datatracker.ietf.org/doc/rfc9591/)
- [Fhenix FHE](https://www.fhenix.io/)
- [CertiK FROST Analysis](https://www.certik.com/resources/blog/threshold-cryptography-ii-unidentifiability-in-decentralized-frost)
- [Penumbra Threshold Encryption](https://protocol.penumbra.zone/main/crypto/flow-encryption/threshold-encryption.html)
