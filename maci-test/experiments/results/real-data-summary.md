# MaciRLA Real-Data Cost Analysis

Analysis of 238 UMA disputes and 114 Kleros disputes with MaciRLA sampling.

## Parameters
- Confidence: 95% (CONFIDENCE_X1000 = 2996)
- PM batch size: 5 (5^1)
- TV batch size: 2 (2^1)
- PM proof gas: 474,492
- TV proof gas: 402,099
- Gas price: 30 gwei, ETH: $3,000

## UMA (238 disputes)

### Voter Distribution
- Range: 27 – 88
- Mean: 56.1, Median: 56

### Margin Distribution
- Range: 31.3% – 100.0%
- Mean: 98.8%, Median: 100.0%

### Savings
- Per-dispute savings range: 28.0% – 64.5%
- Mean savings: 50.0%
- Median savings: 50.6%

### Aggregate Gas & Cost
- Full MACI total: 5,948,334,378 gas ($535,350.09)
- MaciRLA total:   2,933,888,167 gas ($264,049.94)
- Saved:           3,014,446,211 gas ($271,300.16)
- Aggregate savings: **50.7%**

### Sample Disputes (top 5 by voter count)

| Voters | Margin% | PM S/N | TV S/N | Full Gas | RLA Gas | Savings% | Savings USD |
|--------|---------|--------|--------|----------|---------|----------|-------------|
| 88 | 100.0% | 6/18 | 6/45 | 34,529,130 | 12,259,546 | 64.5% | $2,004.26 |
| 88 | 100.0% | 6/18 | 6/45 | 34,529,130 | 12,259,546 | 64.5% | $2,004.26 |
| 80 | 100.0% | 6/16 | 6/41 | 31,971,750 | 12,259,546 | 61.7% | $1,774.10 |
| 80 | 100.0% | 6/16 | 6/41 | 31,971,750 | 12,259,546 | 61.7% | $1,774.10 |
| 80 | 100.0% | 6/16 | 6/41 | 31,971,750 | 12,259,546 | 61.7% | $1,774.10 |

### Savings Distribution

| Range | Count | % |
|-------|-------|---|
| 0-20% | 0 | 0.0% |
| 20-40% | 15 | 6.3% |
| 40-60% | 218 | 91.6% |
| 60-80% | 5 | 2.1% |
| 80-100% | 0 | 0.0% |

## Kleros (114 disputes)

### Voter Distribution
- Range: 1 – 7
- Mean: 4.6, Median: 5

### Margin Distribution
- Range: 0.0% – 100.0%
- Mean: 91.4%, Median: 100.0%

### Savings
- Per-dispute savings range: 9.7% – 16.9%
- Mean savings: 14.6%
- Median savings: 14.1%

### Aggregate Gas & Cost
- Full MACI total: 1,116,363,816 gas ($100,472.74)
- MaciRLA total:   951,410,541 gas ($85,626.95)
- Saved:           164,953,275 gas ($14,845.79)
- Aggregate savings: **14.8%**

### Sample Disputes (top 5 by voter count)

| Voters | Margin% | PM S/N | TV S/N | Full Gas | RLA Gas | Savings% | Savings USD |
|--------|---------|--------|--------|----------|---------|----------|-------------|
| 7 | 100.0% | 1/2 | 3/4 | 10,451,199 | 8,680,789 | 16.9% | $159.34 |
| 7 | 100.0% | 1/2 | 3/4 | 10,451,199 | 8,680,789 | 16.9% | $159.34 |
| 7 | 100.0% | 1/2 | 3/4 | 10,451,199 | 8,680,789 | 16.9% | $159.34 |
| 7 | 100.0% | 1/2 | 3/4 | 10,451,199 | 8,680,789 | 16.9% | $159.34 |
| 7 | 100.0% | 1/2 | 3/4 | 10,451,199 | 8,680,789 | 16.9% | $159.34 |

### Savings Distribution

| Range | Count | % |
|-------|-------|---|
| 0-20% | 114 | 100.0% |
| 20-40% | 0 | 0.0% |
| 40-60% | 0 | 0.0% |
| 60-80% | 0 | 0.0% |
| 80-100% | 0 | 0.0% |

## Key Findings

1. **UMA** (avg 56.1 voters, median margin 100.0%): **50.7%** aggregate savings
2. **Kleros** (avg 4.6 voters, median margin 100.0%): **14.8%** aggregate savings
3. High consensus rates (UMA median=100%, Kleros median=100%) lead to large margins, enabling aggressive sampling
4. Even worst-case disputes with low margins achieve significant savings due to fixed gas overhead reduction
