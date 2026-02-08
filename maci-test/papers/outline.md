# ETA: Efficient Tally Auditing for ZKP-Based Elections

## Abstract

MACI 기반 프라이버시 투표에서 결과 검증은 모든 batch proof의 on-chain 검증을 요구하며,
비용이 투표 수에 선형 비례한다. 본 연구는 선거 margin을 활용한 adaptive sampling과
경제적 challenge 메커니즘을 결합한 이중 방어 프로토콜 MaciRLA를 제안한다.
Sampling이 확률적 탐지(Pillar 1)를, stake/bond 기반 challenge가 경제적 억제(Pillar 2)를
각각 담당하며, 합산 soundness가 full proof 대비 검증 비용을 대폭 절감하면서도
조작 성공 확률의 상한을 보장함을 증명한다.

---

## 1. Introduction

### 1.1 Problem: MACI 검증 비용

- MACI (Minimum Anti-Collusion Infrastructure) 개요
  - ZKP 기반 프라이버시 투표 프로토콜
  - 코디네이터가 off-chain에서 proof 생성, on-chain에서 검증
- 현행 검증: 모든 ProcessMessages + TallyVotes batch proof를 on-chain 검증
  - 비용 = O(N) where N = total batches
  - 100표 → 수십 proofs, 1000표 → 수백 proofs

### 1.2 Observation: Margin과 검증 강도

- 9:1로 이긴 선거 vs 5:5 선거 — 같은 검증 비용을 쓸 이유가 없다
- 넓은 margin → 결과를 뒤집으려면 더 많은 batch를 조작해야 함 → 탐지가 쉬움
- Risk-Limiting Audit (RLA): 선거 감사 분야의 기존 개념을 ZKP 투표에 적용

### 1.3 Approach: 이중 방어

- **Pillar 1**: Margin-adaptive sampling — 확률적 탐지
- **Pillar 2**: Stake + Challenge — 경제적 억제

### 1.4 Contributions

1. Margin-adaptive RLA 프로토콜 MaciRLA 설계 및 구현
2. 두 방어선의 독립적 보안 분석 (Inspection Game + Challenge Bayesian Game)
3. 합산 Soundness 증명 및 최적 파라미터 closed-form 도출
4. 프로덕션 레벨 투표 플랫폼 구현 + 100~1000 voter 규모 실험 결과

---

## 2. Related Work

### 2.1 Risk-Limiting Audits in Elections

- Lindeman & Stark (2012): ballot-level comparison RLA — margin 기반 sample size 결정의 원조
- BRAVO (Lindeman et al., 2012): ballot-polling RLA, 개별 투표지 열람 없이 통계적 감사
- Minerva (Zagórski et al., 2021): round-by-round 최적화된 RLA
- SHANGRLA (Stark, 2020): 다양한 사회선택함수에 대한 통합 RLA 프레임워크
- **본 연구와의 관계**: RLA의 margin-adaptive sample sizing을 이론적 기반으로 차용.
  핵심 차이는 감사 대상 — 종이 투표지가 아닌 ZKP batch proof.
  또한 RLA는 순수 통계적 감사이나, 본 연구는 경제적 인센티브(stake/challenge)를
  추가하여 이중 방어 구조를 형성

### 2.2 Sampling-Based Verification Protocols

- **Proof of Sampling (PoSP)** (Zhang et al., 2024, arXiv:2405.00295):
  Nash Equilibrium 기반 sampling 검증 프로토콜. 탈중앙 ML inference(spML)에 적용.
  정직 행동이 pure strategy NE가 되도록 경제적 인센티브 설계.
  고정 확률 sampling + 경제적 페널티로 검증 비용 절감
- **본 연구와의 관계**: 가장 가까운 선행 연구. 공유하는 인사이트는
  "sampling + economic penalty = full verification 없이도 보안 보장".
  핵심 차이는 (1) 우리는 **margin-adaptive** sampling — 선거 도메인 지식으로
  sample count를 동적 조절, PoSP는 고정 확률, (2) 도메인이 ML inference vs
  ZKP election verification, (3) 우리는 Groth16 proof의 on-chain 검증이라는
  구체적 비용 구조에 최적화

### 2.3 Optimistic Verification & Verification Games

- **Optimistic Rollups** (Arbitrum, Optimism):
  Fraud proof 기반 optimistic 검증. 7일 challenge period 후 finalize.
  단일 fraud proof로 전체 state transition 무효화 가능
- **TrueBit** (Teutsch & Reitwießner, 2017) +
  **Predictable Incentive Mechanism** (Koch & Reitwießner, 2018, arXiv:1806.11476):
  범용 off-chain 계산의 interactive verification game.
  Verifier's Dilemma 해결을 위해 forced error + jackpot 메커니즘 도입
- **본 연구와의 관계**: challenge/response 패턴을 공유.
  핵심 차이는 (1) Optimistic Rollup은 단일 fraud proof로 충분하나,
  우리는 다수 batch 중 subset을 sampling — 탐지가 확률적,
  (2) TrueBit는 binary search 기반 interactive dispute이나,
  우리는 Groth16 non-interactive proof의 직접 검증,
  (3) 두 프로토콜 모두 margin-adaptive 개념 없음

### 2.4 MACI and Private Voting on Blockchain

- **MACI** (Minimum Anti-Collusion Infrastructure, Ethereum Foundation PSE):
  ZKP 기반 프라이버시 투표. 코디네이터가 ProcessMessages + TallyVotes
  batch proof를 생성하고, on-chain에서 **전수 검증**.
  Anti-collusion이 주 목표이며 검증 효율성은 다루지 않음
- **zkVoting** (ePrint 2024/1003):
  ZKP 기반 강압 저항성(coercion-resistant) 투표. E2E 검증 가능.
  마찬가지로 모든 proof를 검증 — sampling 메커니즘 없음
- **본 연구와의 관계**: MACI를 base layer로 사용하되, 전수 검증을
  margin-adaptive partial 검증으로 대체. MACI의 보안 모델을 유지하면서
  검증 비용만 절감하는 상위 레이어

### 2.5 Game Theory in Blockchain Mechanism Design

- Verifier's Dilemma (Luu et al., 2015): 검증자에게 인센티브가 없으면
  검증을 생략하는 문제. TrueBit의 forced error가 대표적 해법
- Incentive compatibility in consensus (Eyal & Sirer, 2014): selfish mining
- Challenge/response games: Plasma exit game, state channel disputes
- **본 연구와의 관계**: Verifier's Dilemma를 sampling으로 우회 —
  전수 검증 대신 소수 proof만 검증하므로 검증 비용 자체가 낮아짐.
  Challenge 메커니즘은 Plasma/Rollup 패턴을 차용하되,
  bond 크기를 잔여 미검증 batch 수에 비례하도록 설계

### 2.6 Positioning

```
                    도메인 특화 (election margin)
                           │
            RLA ───────────┼─────────── ETA (본 연구)
         (Stark et al.)    │           ╱           ╲
          종이 투표 감사    │    ZKP batch proof   Game-theoretic
                           │     sampling         challenge
                           │         │                │
                           │     PoSP (Zhang)    TrueBit / Rollups
                           │     ML inference     범용 계산 검증
                           │
                     고정 확률 sampling
```

본 연구의 고유한 위치: **RLA의 margin-adaptive 통계 + PoSP의 game-theoretic
인센티브 + Rollup의 challenge 패턴**을 ZKP 투표 검증이라는 구체적 도메인에
결합한 최초의 프로토콜

---

## 3. System Model

### 3.1 Players

| Player | Role | 비고 |
|--------|------|------|
| Voter (V_i) | MACI에 signup + 암호화 투표 제출 | 투표 후 프로토콜에 직접 관여하지 않음 |
| Coordinator (C) | 투표 복호화, proof 생성, 결과 제출, stake 예치 | strategic player |
| Challenger (Ch) | 결과 검증 요구, bond 예치 | 누구나 가능 (voter 포함) |
| Verifier Contract | on-chain Groth16 proof 검증 | deterministic, trustless |

- **Voter ≠ Verifier**: Voter는 투표를 제출하는 참여자. 검증은 Verifier Contract가
  자동 수행하며, Challenger가 검증을 트리거한다.
- Voter는 투표 제출 후 Challenger 역할을 겸할 수 있으나, 별도의 경제적 행위(bond 예치)가 필요

### 3.2 Election Parameters

- N_pm, N_tv: PM/TV batch 수
- y, n: yes/no 투표 수
- margin = |y - n|
- M = ceil((margin/2 + 1) / batchSize): 결과 뒤집기 위한 최소 조작 batch 수

### 3.3 Economic Parameters

- stake: 코디네이터 예치금
- bond: 챌린저 보증금
- V_corr: 조작 성공 시 코디네이터 이득
- c_proof: proof 1개 on-chain 검증 비용

### 3.4 Assumptions

- **A1**: 코디네이터는 rational agent (기대 보수 최대화)
- **A2**: 최소 1명의 rational challenger가 존재할 수 있음
- **A3**: Sampling seed는 commit 이후에 결정되며, 코디네이터가 예측·조작 불가
  (구현에서는 blockhash를 사용; 랜덤 오라클의 이론적 보안 분석은 본 연구의 범위 밖이며,
   대규모 환경에서는 threshold cryptography 기반 분산 랜덤성으로 대체 가능)

### 3.5 Threat Model

- 코디네이터가 K개 batch proof를 위조 (결과 변경에는 K ≥ M 필요)
- 코디네이터는 commit 이후 sampling seed에 영향을 줄 수 없음 (A3에 의해)

---

## 4. Protocol Design: MaciRLA

### 4.1 Overview

7-phase 상태 전이:

```
None → Committed → SampleRevealed → Tentative → Finalized
                                   → Challenged → Finalized / Rejected
```

### 4.2 Phase 1: Commit

- 코디네이터가 stake 예치 + 중간 commitment 배열 + 투표 결과 제출
- commitHash = keccak256(pmCommitments, tvCommitments, yesVotes, noVotes)
- commitBlock 기록
- Sample count 계산: S = f(margin, N, batchSize)

### 4.3 Phase 2: Reveal Sample

- BLOCK_DELAY 블록 대기 후 호출
- seed = keccak256(commitHash, blockhash(commitBlock + BLOCK_DELAY))
- seed로부터 batch 인덱스 결정론적 도출

### 4.4 Phase 3: Submit Sampled Proofs

- 선택된 batch에 대해 Groth16 proof 제출
- on-chain 검증 (VkRegistry + Verifier Contract)

### 4.5 Phase 4: Finalize Sampling

- 모든 sampled proof 검증 완료 → Tentative 상태
- 7일 challenge 기간 시작

### 4.6 Phase 5-6: Challenge & Response

- 챌린저: bond 예치 + full proof 요구
- 코디네이터: 3일 내 나머지 모든 batch proof 제출
- 실패 시 stake slashing

### 4.7 Phase 7: Finalize

- Challenge 없이 7일 경과 → Finalized, stake 반환
- Challenge 성공 응답 → Finalized, stake + bond 반환

---

## 5. Pillar 1: Probabilistic Verification

> 목표: sampling만으로 조작이 경제적으로 손해임을 증명

### 5.1 Detection Probability

**Lemma 1** (정확한 탐지 확률):
```
P_detect(N, K, S) = 1 - C(N-K, S) / C(N, S)    [초기하분포]
```

**Lemma 2** (근사 공식의 보수성):
```
S = ceil(-ln(α) × N / K) 일 때, P_detect ≥ 1 - α
```
- 증명: Bernoulli 근사 (1-K/N)^S ≤ α 는 비복원 추출보다 항상 보수적

**Lemma 3** (단조성):
```
K₁ ≥ K₂ ≥ M  ⟹  P_detect(N, K₁, S) ≥ P_detect(N, K₂, S)
```
- 더 많이 조작할수록 더 잘 걸림
- 공격자에게 가장 유리한 K는 정확히 M

### 5.2 Inspection Game

**Definition** (코디네이터 기대 보수):
```
U_C(Honest)     = 0   (stake 예치 후 회수)
U_C(Corrupt(K)) = P_miss(K) × V_corr - P_detect(K) × stake
```

**Theorem 1** (Sampling Deterrence):
```
stake ≥ V_corr × (1 - M/N)^S / (1 - (1 - M/N)^S)
```
이면 모든 K ≥ M에 대해 U_C(Corrupt(K)) < U_C(Honest)

- 증명 스케치: Lemma 3으로 worst-case K=M, 부등식 정리
- **Corollary 1**: α=0.05이면 stake ≥ V_corr/19 로 충분

---

## 6. Pillar 2: Economic Deterrence

> 목표: sampling 통과 후에도 경제적 인센티브로 추가 방어

### 6.1 Bayesian Update

**Lemma 4** (사후 확률):
```
p = Pr(corrupt | sampling passed) = π × P_miss / (π × P_miss + (1-π))
```
- π = 사전 corruption 확률
- α=0.05, π=0.1 → p ≈ 0.005

### 6.2 Challenge Equilibrium

**Definition** (챌린저 기대 보수):
```
U_Ch(Challenge) = p × (bond + stake) - (1-p) × bond
U_Ch(Pass)      = 0
```

**Theorem 2** (Challenge Rationality Threshold):
```
Challenge rational ⟺ p > bond / (2 × bond + stake)
```

**Theorem 3** (Optimal Bond):
```
bond* = (3/2) × c_proof × (N - S)
```
- griefing cost > 코디네이터의 full proof 비용
- 조작 의심 충분 시 challenge는 rational

### 6.3 Griefing Resistance

**Lemma 5**:
```
griefing_factor = bond / c_coordinator_full_proof = 1.5
```
- 챌린저가 1.5배 손해를 감수해야 griefing 가능 → 비합리적

---

## 7. Unified Security Analysis

> 목표: 두 Pillar 합산하여 전체 보안 보장

### 7.1 Soundness Theorem

**Theorem 4** (Soundness):
```
P(false accept) = P(sampling miss) × P(no rational challenge)
```

Case 분석:
- K < M: 결과 불변 → false accept 아님
- K ≥ M: P(sampling miss) ≤ α, P(no challenge) ≤ 1 - I(p > p*)

**Corollary 2**:
- Rational challenger 부재 시: P(false accept) ≤ α
- Rational challenger 존재 시: P(false accept) ≪ α

### 7.2 Security Comparison Table

| Defense | P(false accept) | Verification Cost |
|---------|-----------------|-------------------|
| Full proof | 0 | N × c_proof |
| Sampling only | ≤ α | S × c_proof |
| **Sampling + Challenge** | **≤ α × (1-q)** | **S × c_proof** |

### 7.3 Liveness

- 정직한 코디네이터는 모든 경로에서 Finalized 도달
- Challenge에도 full proof 제출로 stake + bond 회수

### 7.4 Budget Balance

- 모든 phase 전이에서 자금 보존 증명
- 상태 전이 그래프 × 자금 흐름 추적

---

## 8. Optimal Parameter Selection

> 목표: 선거 규모/조작 가치에 맞는 (α*, stake*, bond*) 도출

### 8.1 Optimization Problem

```
minimize    S × c_proof                     (검증 비용)
subject to  P(false accept) ≤ ε             (보안)
            stake ≥ V_corr × f(α, M, N)     (Theorem 1)
            bond = 1.5 × c_proof × (N - S)  (Theorem 3)
            stake ≤ stake_max               (참여 제약)
```

### 8.2 Closed-Form Solution

**Theorem 5**:
```
α* = ε / (1 - q)
S* = ceil(-ln(α*) × N / M)
stake* = V_corr × α* / (1 - α*)
bond* = 1.5 × c_proof × (N - S*)
```

### 8.3 Regime Analysis

| Election Type | Margin | S*/N | Savings | Required Stake |
|---------------|--------|------|---------|----------------|
| Landslide (80%+) | large | very small | 80%+ | low |
| Clear win (60%) | medium | medium | 30-50% | medium |
| Close race (51%) | small | large | <10% | high |
| Tie (50%) | 0 | 100% | none | full proof |

### 8.4 Sensitivity Analysis

- α vs verification cost trade-off curve
- stake vs participation rate trade-off
- N (election size) scaling behavior

---

## 9. Implementation & Evaluation

### 9.1 Implementation

- 프로덕션 레벨 투표 플랫폼 (웹 기반)
  - 유권자 UI: 지갑 연결 → signup → 투표 → 결과 확인
  - 코디네이터 서비스: proof 생성 → MaciRLA 제출 → 모니터링
  - 결과 대시보드: RLA 진행 상황 실시간 표시
- MaciRLA.sol: Solidity 0.8.20
  - Blockhash 기반 commit-reveal randomness
  - 7-phase state machine with economic incentives
  - On-chain Groth16 verification

### 9.2 Experiment Design

실제 sampling 절감이 발생하는 규모에서 실험:

| Scale | Voters | Ratios | PM Batches (est.) | TV Batches (est.) | 목적 |
|-------|--------|--------|-------------------|-------------------|------|
| Small | 100 | 90:10, 70:30, 55:45, 50:50 | ~20 | ~50 | Sampling 절감 시작점 확인 |
| Medium | 500 | 동일 | ~100 | ~250 | 마진별 절감률 스케일링 |
| Large | 1000 | 동일 | ~200 | ~500 | 대규모 절감 효과 + gas 비용 |

### 9.3 Evaluation Metrics

- **Sampling savings**: S/N ratio per margin per scale
- **Gas cost**: commitResult + revealSample + submitProof + finalize 합산
- **Gas comparison**: Full MACI verification vs MaciRLA 총 gas
- **Detection probability**: 시뮬레이션으로 empirical P_detect 검증
- **Proof generation time**: scale별 off-chain proof 생성 비용

### 9.4 Expected Results

- 100+ voter에서 high-margin 시나리오에서 유의미한 sampling 절감 시작
- 1000 voter, 80% margin → PM/TV 각각 80%+ proof 절감 예상
- Gas 절감 = (N - S) × c_proof_onchain

---

## 10. Discussion & Limitations

- Randomness: blockhash 사용. 랜덤 오라클의 이론적 보안 분석은 본 연구의 범위 밖.
  대규모 환경에서는 threshold cryptography 기반 분산 랜덤성으로 강화 가능
- Rational agent 가정: irrational attacker는 모델 외
- 반복 선거에서의 평판 효과 미분석
- Batch 수가 적은 소규모 선거에서는 sampling 절감 미미
- Coordinator-Challenger 공모 시나리오의 심화 분석 필요

---

## 11. Conclusion

- Margin-adaptive sampling + economic challenge = 효율적이고 안전한 검증
- Landslide 선거에서 최대 80%+ 검증 비용 절감
- 접전에서도 full proof fallback으로 보안 유지
- 핵심 인사이트: "안전한 선거일수록 검증이 싸다"

---

## Appendix

### A. Proof of Theorem 1 (Sampling Deterrence)
### B. Proof of Theorem 4 (Soundness)
### C. Hypergeometric vs Bernoulli Approximation Bounds
### D. Full Protocol Specification (State Transition Table)
### E. Gas Cost Measurement Methodology
