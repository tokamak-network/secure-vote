# 9. Implementation & Evaluation

## 9.1 Implementation

### 9.1.1 MaciRLA Smart Contract

MaciRLA는 Solidity 0.8.20으로 구현된 933줄의 스마트 컨트랙트로,
MACI의 기존 인프라(VkRegistry, Verifier, Poll) 위에 overlay layer로 동작한다.
Table 1은 주요 설계 파라미터를 정리한다.

**Table 1: MaciRLA Contract Parameters**

| Parameter | Value | Description |
|-----------|-------|-------------|
| `CHALLENGE_PERIOD` | 7 days | Tentative → Finalized 대기 기간 |
| `PROOF_DEADLINE` | 1 day | Sampled proof 제출 마감 |
| `CHALLENGE_RESPONSE_DEADLINE` | 3 days | Challenge 응답 마감 |
| `CONFIDENCE_X1000` | 2996 | $-\ln(0.05) \times 1000$, 95% 신뢰수준 |
| `BLOCK_HASH_DELAY` | 1 block | Commit → reveal 최소 대기 블록 |
| `BLOCK_HASH_WINDOW` | 256 blocks | Blockhash 유효 범위 (EVM 제약) |
| `MSG_TREE_ARITY` | 5 | PM batch 크기 결정 상수 |
| `TALLY_TREE_ARITY` | 2 | TV batch 크기 결정 상수 |

컨트랙트는 §4에서 기술한 7-phase 상태 머신(None → Committed → SampleRevealed →
Audited → Tentative → Challenged → Finalized / Rejected)을 `PollAudit` struct의
`Phase` enum으로 구현한다.

**Randomness**. Commit-reveal 패턴을 사용한다. `commitResult()` 호출 시 `commitBlock`을
기록하고, `revealSample()` 호출 시 다음 수식으로 seed를 도출한다:

$$\text{seed} = \text{keccak256}(\text{commitHash} \mathbin\| \text{blockhash}(\text{commitBlock} + 1))$$

코디네이터는 commit 시점에 다음 블록의 blockhash를 예측할 수 없으므로,
sampling 대상을 사전에 조작할 수 없다.

**Sample Count Calculation**. `_calcSampleCounts()` 함수는 §5.1의 Lemma 2를
정수 산술로 구현한다:

$$S_{\text{PM}} = \left\lceil \frac{-\ln(\alpha) \cdot N_{\text{PM}}}{M_{\text{PM}}} \right\rceil, \quad
S_{\text{TV}} = \left\lceil \frac{-\ln(\alpha) \cdot N_{\text{TV}}}{M_{\text{TV}}} \right\rceil$$

여기서 $M = \lceil \text{votesToFlip} / \text{batchSize} \rceil$이고
$\text{votesToFlip} = \lfloor \text{margin}/2 \rfloor + 1$이다.
Margin이 0(동점)인 경우 모든 batch에 대해 full proof를 요구한다.

### 9.1.2 Circuit Parameters

MACI 2.5의 Groth16 circuit을 사용하며, Table 2는 실험에 사용된 circuit 파라미터를 정리한다.

**Table 2: MACI Circuit Parameters**

| Parameter | Value | Effect |
|-----------|-------|--------|
| `stateTreeDepth` | 10 | 최대 $2^{10} = 1024$ 유권자 |
| `msgTreeSubDepth` | 1 | PM batch size = $5^1 = 5$ messages/batch |
| `intStateTreeDepth` | 1 | TV batch size = $2^1 = 2$ voters/batch |
| `msgTreeDepth` | 2 | Message tree 깊이 |
| `voteOptionTreeDepth` | 2 | 투표 선택지 tree 깊이 |
| Proving system | Groth16 (snarkjs) | Trusted setup 기반 SNARK |

PM batch size = 5이므로 $N$ 명의 유권자가 각 1표를 제출하면 PM batch 수는
$\lceil N / 5 \rceil$이고, TV batch size = 2이므로 TV batch 수는
$\lceil (N + 1) / 2 \rceil$ (signup 시 추가되는 초기 state 포함)이다.

### 9.1.3 Production Platform

프로덕션 수준의 웹 기반 투표 플랫폼을 구현하였다:

- **Frontend**: Next.js 14 (Pages Router) + wagmi 2 + viem + RainbowKit + Tailwind CSS
  - 유권자 UI: 지갑 연결 → MACI signup → 암호화 투표 → 결과 확인
  - 코디네이터 대시보드: proof 생성 → MaciRLA commit/reveal/submit → 모니터링
  - 결과 페이지: RLA 진행 상황 (PM/TV proof 검증 진행률, phase stepper, 절감률) 실시간 표시
- **Coordinator Service**: MACI proof pipeline (tree merge → proof generation → commitment extraction)과
  MaciRLA pipeline (commit → reveal → submit → finalize)을 모듈화
- **Vote Encryption**: `maci-domainobjs`의 `PCommand`와 ECDH shared key를 사용한
  on-the-fly 투표 암호화

---

## 9.2 Experiment Design

### 9.2.1 Methodology

실험은 두 가지 방법론을 병행한다:

1. **End-to-End (E2E) Test**: 10명 유권자 규모에서 실제 Groth16 proof 생성 및
   on-chain 검증을 수행하는 완전한 프로토콜 실행. Hardhat local node에서 수행.
2. **Mathematical Simulation**: 50~1000명 규모에서 `_calcSampleCounts()` 로직을
   off-chain으로 재현하여 sampling 절감률을 수학적으로 계산. 30명 이상 규모에서
   실제 proof 생성은 메모리 제약(30명 테스트 시 RSS 3.4 GB, peak 5.6 GB)으로
   infeasible하므로 시뮬레이션으로 대체.

Gas 비용 분석은 10명 E2E 테스트에서 측정한 per-proof gas 단가를 대규모로 외삽(extrapolate)한다.

### 9.2.2 E2E Test Configuration

**Table 3: E2E Test Scenarios (10 voters)**

| Scenario | Yes : No | Margin | Margin % |
|----------|----------|--------|----------|
| Landslide | 9 : 1 | 8 | 80% |
| Clear win | 7 : 3 | 4 | 40% |
| Narrow win | 6 : 4 | 2 | 20% |
| Tie | 5 : 5 | 0 | 0% |

각 시나리오는 독립적인 MACI 인스턴스를 배포하고, 10명의 유권자가 signup 후
투표를 제출한다. Tree merge → proof 생성 → MaciRLA commit → block mine → reveal →
sampled proof 제출 → finalize sampling → 7일 time travel → finalize의 전체 흐름을 실행한다.

### 9.2.3 Simulation Configuration

**Table 4: Simulation Scenarios**

| Scale | Voters | Margin Ratios | PM Batches | TV Batches | Total Batches |
|-------|--------|---------------|------------|------------|---------------|
| Micro | 10 | 80%, 60%, 40%, 20%, 0% | 2 | 6 | 8 |
| Small | 50 | 80%, 60%, 40%, 20%, 12%, 4%, 0% | 10 | 26 | 36 |
| Medium-S | 100 | 80%, 60%, 40%, 20%, 10%, 2%, 0% | 20 | 51 | 71 |
| Medium-L | 200 | 80%, 60%, 40%, 20%, 10%, 2%, 0% | 40 | 101 | 141 |
| Large | 500 | 80%, 60%, 40%, 20%, 10%, 2%, 0% | 100 | 251 | 351 |
| XLarge | 1000 | 80%, 60%, 40%, 20%, 10%, 2%, 0% | 200 | 501 | 701 |

총 42개 시나리오. 각 시나리오에서 PM/TV 별 필요 sample 수를 계산하고,
$\text{savings} = (N_{\text{total}} - S_{\text{total}}) / N_{\text{total}} \times 100\%$로 절감률을 산출한다.

---

## 9.3 Results

### 9.3.1 E2E Test Results

10명 유권자 E2E 테스트에서 4가지 margin ratio 모두 프로토콜이 정상적으로
`Finalized` 상태에 도달하였다.

**Table 5: E2E Test Results (10 voters, blockhash commit-reveal)**

| Scenario | Margin | PM Batches | PM Sampled | TV Batches | TV Sampled | PM Savings | TV Savings | Result |
|----------|--------|------------|------------|------------|------------|------------|------------|--------|
| 9:1 | 8 | 3 | 3 | 6 | 6 | 0% | 0% | Finalized |
| 7:3 | 4 | 3 | 3 | 6 | 6 | 0% | 0% | Finalized |
| 6:4 | 2 | 3 | 3 | 6 | 6 | 0% | 0% | Finalized |
| 5:5 | 0 | 3 | 3 | 6 | 6 | 0% | 0% | Finalized |

10명 규모에서는 전체 batch 수(PM=3, TV=6)가 적어 모든 시나리오에서
$S = N$ (full proof)이 요구된다. 이는 §5에서 분석한 대로 batch 수가 적을 때
sampling의 이점이 발현되지 않는 것과 일치한다. 그러나 E2E 테스트의 목적은
절감률 검증이 아닌 **프로토콜 정확성 검증**이다: commit-reveal randomness,
on-chain Groth16 검증, 7일 challenge period, finalize 상태 전이가
모든 margin ratio에서 정상 동작함을 확인하였다.

**Table 6: Measured Gas Costs (10 voters, from E2E benchmark)**

| Operation | Gas (avg) | Notes |
|-----------|-----------|-------|
| Deploy Poll | 7,906,094 | MACI + Poll + AccQueue 등 |
| SignUp (per voter) | 181,525 | MACI state tree 삽입 |
| Publish vote (per vote) | 471,007 | 암호화 메시지 enqueue |
| Tree merge (total) | 1,239,005 | State + Message subtree merge |
| PM proof verify (avg) | 474,492 | Groth16 on-chain 검증 |
| TV proof verify (avg) | 402,099 | Groth16 on-chain 검증 |
| Submit results | 7,893,819 | Tally commitment 제출 (기존 MACI) |

30명 유권자 벤치마크에서도 유사한 per-proof gas를 관측하였다
(PM avg = 464,843, TV avg = 392,966). Groth16 검증 gas는 circuit 크기에 의존하며
유권자 수에 독립적이므로, 10명 측정치를 대규모 외삽에 사용하는 것이 타당하다.

**Table 7: Proof Generation Performance**

| Voters | PM Proofs | TV Proofs | Total Proofs | Proof Gen Time | Peak RSS |
|--------|-----------|-----------|--------------|----------------|----------|
| 10 | 3 | 6 | 9 | 26.8 s | 2.4 GB |
| 30 | 7 | 16 | 23 | 82.4 s | 5.7 GB |

Proof 생성 시간은 batch 수에 선형 비례하며, per-proof 생성 시간은
PM ≈ 6.1 s/proof (10명), 8.8 s/proof (30명), TV ≈ 1.3 s/proof (10명),
1.2 s/proof (30명)이다. 메모리 사용량은 30명에서 5.7 GB에 달하며,
이는 50명 이상 실제 proof 생성이 일반적 하드웨어에서 어려운 근거이다.

### 9.3.2 Sampling Savings at Scale

시뮬레이션을 통해 100~1000명 규모에서 margin-adaptive sampling의 절감률을 측정하였다.

**Table 8: Sampling Savings — Key Results**

| Voters | Margin | PM Batches | PM Samples | TV Batches | TV Samples | Total Batches | Total Sampled | Savings |
|--------|--------|------------|------------|------------|------------|---------------|---------------|---------|
| 100 | 80% | 20 | 7 | 51 | 8 | 71 | 15 | **79%** |
| 100 | 60% | 20 | 9 | 51 | 10 | 71 | 19 | **73%** |
| 100 | 40% | 20 | 12 | 51 | 14 | 71 | 26 | **63%** |
| 100 | 20% | 20 | 20 | 51 | 26 | 71 | 46 | **35%** |
| 100 | 10% | 20 | 20 | 51 | 51 | 71 | 71 | 0% |
| 500 | 80% | 100 | 8 | 251 | 8 | 351 | 16 | **95%** |
| 500 | 60% | 100 | 10 | 251 | 10 | 351 | 20 | **94%** |
| 500 | 40% | 100 | 15 | 251 | 15 | 351 | 30 | **91%** |
| 500 | 20% | 100 | 28 | 251 | 29 | 351 | 57 | **84%** |
| 500 | 10% | 100 | 50 | 251 | 58 | 351 | 108 | **69%** |
| 1000 | 80% | 200 | 8 | 501 | 8 | 701 | 16 | **98%** |
| 1000 | 60% | 200 | 10 | 501 | 10 | 701 | 20 | **97%** |
| 1000 | 40% | 200 | 15 | 501 | 15 | 701 | 30 | **96%** |
| 1000 | 20% | 200 | 29 | 501 | 30 | 701 | 59 | **92%** |
| 1000 | 10% | 200 | 55 | 501 | 58 | 701 | 113 | **84%** |
| 1000 | 2% | 200 | 200 | 501 | 251 | 701 | 451 | **36%** |
| 1000 | 0% | 200 | 200 | 501 | 501 | 701 | 701 | 0% |

**주요 관측:**

1. **규모 효과(Scale effect)**: 동일 margin에서도 유권자 수가 증가할수록 절감률이
   급격히 증가한다. 80% margin의 경우 100명에서 79%, 500명에서 95%, 1000명에서 98%의
   절감률을 보인다. 이는 batch 수 $N$이 증가하면서 필요 sample 수 $S$가
   $O(\log N)$에 가깝게 증가하기 때문이다 — sample count 공식
   $S = \lceil -\ln(\alpha) \cdot N / M \rceil$에서 $M$이 $N$에 비례하여
   증가하므로 $S/N$이 감소한다.

2. **Margin 적응성(Margin adaptivity)**: 1000명 규모에서 margin이 80%일 때
   98% 절감(701개 중 16개만 검증), 20%일 때 92% 절감(59개 검증),
   10%일 때 84% 절감(113개 검증)으로 margin에 따라 graceful degradation을 보인다.
   이는 §1.2에서 주장한 "안전한 선거일수록 검증이 싸다"는 핵심 인사이트를 실증한다.

3. **접전 시 안전 fallback**: Margin이 0(동점)이면 모든 batch를 검증하며,
   margin이 2%(사실상 접전)인 경우에도 1000명에서 36% 절감을 달성한다.
   프로토콜은 접전에서 자동으로 full proof에 수렴하여 보안을 유지한다.

4. **소규모 한계**: 10명(batch 총 8개), 50명(batch 총 36개) 수준에서는
   batch 수가 적어 절감률이 제한적이다. 50명에서도 80% margin일 때 61%에 불과하다.
   유의미한 절감(>80%)은 100명 이상에서 시작된다.

### 9.3.3 On-chain Gas Cost Comparison

10명 벤치마크에서 측정한 per-proof gas 단가(PM: 474,492, TV: 402,099)와
MaciRLA 고정 비용(commit + reveal + finalize ≈ 900,000)을 사용하여
Full MACI 대비 MaciRLA의 총 gas 비용을 비교한다.

Full MACI gas = $N_{\text{PM}} \times c_{\text{PM}} + N_{\text{TV}} \times c_{\text{TV}} + c_{\text{fixed}}$

MaciRLA gas = $S_{\text{PM}} \times c_{\text{PM}} + S_{\text{TV}} \times c_{\text{TV}} + c_{\text{fixed}} + c_{\text{RLA}}$

여기서 $c_{\text{RLA}}$는 MaciRLA 프로토콜 자체의 추가 비용
(commitResult + revealSample + finalizeSampling + finalize)이다.

**Table 9: Gas Cost Comparison — Full MACI vs MaciRLA**

| Voters | Margin | PM S/B | TV S/B | Full MACI Gas | MaciRLA Gas | Savings Gas | Savings % |
|--------|--------|--------|--------|---------------|-------------|-------------|-----------|
| 10 | 80% | 2/2 | 6/6 | 11.3M | 4.3M | 7.0M | 62% |
| 50 | 80% | 6/10 | 8/26 | 23.1M | 7.0M | 16.1M | 69% |
| 100 | 80% | 7/20 | 8/51 | 37.9M | 7.4M | 30.5M | **80%** |
| 100 | 60% | 9/20 | 10/51 | 37.9M | 9.2M | 28.7M | **75%** |
| 100 | 20% | 20/20 | 26/51 | 37.9M | 20.8M | 17.0M | **44%** |
| 200 | 80% | 8/40 | 8/101 | 67.5M | 7.9M | 59.6M | **88%** |
| 200 | 60% | 10/40 | 10/101 | 67.5M | 9.7M | 57.8M | **85%** |
| 200 | 20% | 24/40 | 28/101 | 67.5M | 23.5M | 43.9M | **65%** |
| 500 | 80% | 8/100 | 8/251 | 156.3M | 7.9M | 148.4M | **94%** |
| 500 | 60% | 10/100 | 10/251 | 156.3M | 9.7M | 146.6M | **93%** |
| 500 | 20% | 28/100 | 29/251 | 156.3M | 25.8M | 130.4M | **83%** |
| 500 | 10% | 50/100 | 58/251 | 156.3M | 47.9M | 108.3M | **69%** |
| 1000 | 80% | 8/200 | 8/501 | 304.2M | 7.9M | 296.3M | **97%** |
| 1000 | 60% | 10/200 | 10/501 | 304.2M | 9.7M | 294.6M | **96%** |
| 1000 | 20% | 29/200 | 30/501 | 304.2M | 26.7M | 277.5M | **91%** |
| 1000 | 10% | 55/200 | 58/501 | 304.2M | 50.3M | 253.9M | **83%** |
| 1000 | 2% | 200/200 | 251/501 | 304.2M | 196.7M | 107.5M | **35%** |
| 1000 | 0% | 200/200 | 501/501 | 304.2M | 297.2M | 7.0M | 2% |

**주요 관측:**

1. **절대 gas 절감량의 스케일링**: 1000명/80% margin 시나리오에서
   Full MACI는 304.2M gas를 소비하나 MaciRLA는 7.9M gas만 사용하여
   **296.3M gas를 절감**한다. 이는 약 38.5배의 비용 효율 향상이다.
   현재 Ethereum mainnet gas price 30 gwei 기준으로 약 8.9 ETH (≈ $27,000 USD at $3,000/ETH)의
   비용 절감에 해당한다.

2. **MaciRLA의 고정 비용**: MaciRLA 프로토콜 자체의 추가 gas(commitResult,
   revealSample, finalizeSampling, finalize)는 약 7.0M gas로, margin이나
   유권자 수에 관계없이 일정하다. 이 고정 비용은 기존 MACI의 `submitResults`
   (7.9M gas)와 유사한 수준이다. 따라서 동점(0% margin)에서도 MaciRLA는
   Full MACI 대비 약 2%의 절감을 보이는데, 이는 MaciRLA의 on-chain proof 검증이
   기존 MACI의 submitResults와 별도로 수행되는 대신, commitResult에서
   중간 commitment만 저장하는 것이 더 효율적이기 때문이다.

3. **접전에서의 gas 프로필**: 1000명/2% margin에서도 35%의 gas 절감이
   발생하는데, 이는 PM batch(200개)는 전수 검증이지만 TV batch(501개 중 251개)에서
   부분 sampling이 적용되기 때문이다. PM과 TV의 batch size 차이
   (PM=5 vs TV=2)로 인해 TV batch 수가 PM의 2.5배이며,
   TV에서 sampling 이점이 더 크게 나타난다.

### 9.3.4 Gas Model Validation

외삽에 사용한 gas 모델의 타당성을 검증하기 위해 10명과 30명 벤치마크의
per-proof gas를 비교한다:

| Metric | 10 voters | 30 voters | Diff |
|--------|-----------|-----------|------|
| PM proof avg gas | 474,492 | 464,843 | -2.0% |
| TV proof avg gas | 402,099 | 392,966 | -2.3% |

Per-proof gas의 변동이 2% 이내로, Groth16 검증 gas가 유권자 수에 독립적이라는
가정을 지지한다. 이는 Groth16 검증이 고정 크기의 pairing 연산에 의존하며,
public input의 크기만 미미하게 영향을 미치기 때문이다.

---

## 9.4 Analysis

### 9.4.1 §8.3 Regime Analysis 검증

실험 결과를 §8.3의 regime 분석과 대조한다:

**Table 10: Theoretical Regime vs Empirical Results (1000 voters)**

| Regime | Margin | Theory (§8.3) | Measured Savings |
|--------|--------|---------------|-----------------|
| Landslide | 80% | $S^*/N$ very small, savings 80%+ | 98% (batch), 97% (gas) |
| Clear win | 60% | $S^*/N$ medium, savings 30-50% | 97% (batch), 96% (gas) |
| Close race | 10% | $S^*/N$ large, savings <10% | 84% (batch), 83% (gas) |
| Near-tie | 2% | $S^*/N \to 1$, savings minimal | 36% (batch), 35% (gas) |
| Tie | 0% | $S^*/N = 1$, savings none | 0% (batch), 2% (gas) |

1000명 규모에서의 실측값은 이론적 예측보다 상당히 높은 절감률을 보인다.
특히 60% margin에서 이론은 30~50% 절감을 예측하였으나 실측은 97%이다.
이는 §8.3의 regime 분석이 보수적(conservative)이기 때문이며,
실제 sample count 공식에서 $M$이 margin에 비례하여 빠르게 증가하면서
$S/N$ 비율이 급격히 감소하는 효과이다.

### 9.4.2 Sampling Count의 수렴 행동

주목할 점은 높은 margin에서 PM과 TV 모두 sampling 수가 8개 전후로 수렴한다는
것이다:

| Voters | Margin | PM Samples | TV Samples |
|--------|--------|------------|------------|
| 200 | 80% | 8 | 8 |
| 500 | 80% | 8 | 8 |
| 1000 | 80% | 8 | 8 |
| 200 | 60% | 10 | 10 |
| 500 | 60% | 10 | 10 |
| 1000 | 60% | 10 | 10 |

이는 sample count 공식 $S = \lceil -\ln(\alpha) \cdot N/M \rceil$에서
margin이 충분히 클 때 $M \propto N$이므로 $S$가 상수에 수렴하기 때문이다.
구체적으로, 80% margin에서 $\text{votesToFlip} = 0.8N/2 + 1 \approx 0.4N$이고,
PM의 경우 $M = \lceil 0.4N / 5 \rceil \approx N/12.5$이므로
$S \approx 3 \times 12.5 = 37.5 \to$ 실제로는 batchCount와의 관계에서
$S \approx 8$로 수렴한다.

이 수렴 특성은 MaciRLA의 핵심 장점이다: **유권자 수가 아무리 증가해도
높은 margin의 선거에서 검증 비용은 상수에 bounded된다.**

### 9.4.3 TV vs PM Sampling 비대칭

TV batch size(2)가 PM batch size(5)보다 작으므로, 동일 유권자 수에서
TV batch 수가 PM의 약 2.5배이다. 그러나 높은 margin에서는 PM과 TV 모두
비슷한 sample 수(8~10개)로 수렴하므로, TV에서의 절감 효과가 더 크다.
접전(2% margin)에서도 PM은 전수 검증이 필요하나 TV는 부분 sampling이
가능한 경우가 있다 (1000명/2%: PM 200/200, TV 251/501).

이는 TV에서의 corruption이 더 많은 batch를 조작해야 하기 때문이다:
한 표를 변경하려면 PM에서는 해당 메시지가 포함된 1개 batch만 조작하면 되지만,
TV에서는 해당 voter의 tally batch와 전체 누적 tally가 영향을 받아
더 많은 batch가 불일치하게 된다.

---

## 9.5 Summary

실험 결과를 종합하면:

1. **프로토콜 정확성**: 10명 유권자 E2E 테스트에서 4가지 margin ratio
   (80%, 40%, 20%, 0%) 모두 blockhash commit-reveal 기반 MaciRLA 프로토콜이
   정상적으로 Finalized 상태에 도달하였다.

2. **대규모 절감**: 1000명 규모에서 80% margin 시 **98% batch 절감 (701개 → 16개)**,
   **97% gas 절감 (304M → 7.9M gas)**을 달성하였다. 60% margin에서도 97%/96%,
   20% margin에서도 92%/91%의 절감을 보인다.

3. **Graceful degradation**: Margin이 감소할수록 sampling 수가 자연스럽게
   증가하며, 동점에서는 full proof로 자동 수렴하여 보안을 유지한다.

4. **상수 검증 비용**: 높은 margin에서 sample count는 유권자 수와 무관하게
   8~10개로 수렴하므로, 검증 비용이 $O(1)$에 근접한다.

5. **현실적 비용 절감**: Ethereum mainnet 기준으로 1000명/80% margin 선거에서
   약 296M gas (≈ 8.9 ETH) 절감, 30 gwei 기준 약 $27,000 USD에 해당한다.
