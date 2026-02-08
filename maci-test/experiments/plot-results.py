#!/usr/bin/env python3
"""
Generate charts from MACI-RLA simulation results.

Usage: python3 experiments/plot-results.py

Requires: pip install matplotlib
"""
import json
import os
import sys

try:
    import matplotlib.pyplot as plt
    import matplotlib
    matplotlib.use('Agg')  # Non-interactive backend
except ImportError:
    print("matplotlib not installed. Install with: pip install matplotlib")
    sys.exit(1)

RESULTS_DIR = os.path.join(os.path.dirname(__file__), 'results')
SIM_FILE = os.path.join(RESULTS_DIR, 'simulation-results.json')
GAS_FILE = os.path.join(RESULTS_DIR, 'gas-analysis-results.json')


def plot_savings_by_voters():
    """Plot sampling savings (%) vs voter count for different margins."""
    if not os.path.exists(SIM_FILE):
        print(f"Simulation results not found: {SIM_FILE}")
        print("Run: npx ts-node experiments/simulate.ts")
        return

    with open(SIM_FILE) as f:
        data = json.load(f)

    # Group by margin percentage
    margins = {}
    for r in data:
        key = r['marginPct']
        if key not in margins:
            margins[key] = {'voters': [], 'savings': []}
        margins[key]['voters'].append(r['voters'])
        margins[key]['savings'].append(r['savingsPct'])

    fig, ax = plt.subplots(figsize=(10, 6))

    for margin_pct in sorted(margins.keys(), reverse=True):
        if margin_pct == 0:
            continue  # Skip 50:50 (always 0% savings)
        m = margins[margin_pct]
        ax.plot(m['voters'], m['savings'], marker='o', label=f'{margin_pct}% margin')

    ax.set_xlabel('Number of Voters', fontsize=12)
    ax.set_ylabel('Sampling Savings (%)', fontsize=12)
    ax.set_title('MaciRLA Sampling Savings by Voter Count and Margin', fontsize=14)
    ax.legend(title='Margin')
    ax.set_ylim(0, 100)
    ax.grid(True, alpha=0.3)

    output = os.path.join(RESULTS_DIR, 'savings-by-voters.png')
    fig.savefig(output, dpi=150, bbox_inches='tight')
    print(f"Saved: {output}")
    plt.close()


def plot_gas_comparison():
    """Plot Full MACI vs MaciRLA gas cost."""
    if not os.path.exists(GAS_FILE):
        print(f"Gas analysis results not found: {GAS_FILE}")
        print("Run: npx ts-node experiments/gas-analysis.ts")
        return

    with open(GAS_FILE) as f:
        data = json.load(f)

    # Filter for 80% margin to show scaling
    margin_data = [r for r in data if r['marginPct'] == 80]

    voters = [r['voters'] for r in margin_data]
    full_gas = [int(r['fullMaciGas']) / 1e6 for r in margin_data]  # In millions
    rla_gas = [int(r['maciRlaGas']) / 1e6 for r in margin_data]

    fig, ax = plt.subplots(figsize=(10, 6))

    x = range(len(voters))
    width = 0.35

    bars1 = ax.bar([i - width/2 for i in x], full_gas, width, label='Full MACI', color='#ff6b6b')
    bars2 = ax.bar([i + width/2 for i in x], rla_gas, width, label='MaciRLA', color='#384aff')

    ax.set_xlabel('Number of Voters', fontsize=12)
    ax.set_ylabel('Gas (Millions)', fontsize=12)
    ax.set_title('On-Chain Verification Gas: Full MACI vs MaciRLA (80% margin)', fontsize=14)
    ax.set_xticks(x)
    ax.set_xticklabels(voters)
    ax.legend()
    ax.grid(True, alpha=0.3, axis='y')

    output = os.path.join(RESULTS_DIR, 'gas-comparison.png')
    fig.savefig(output, dpi=150, bbox_inches='tight')
    print(f"Saved: {output}")
    plt.close()


def plot_samples_heatmap():
    """Plot sample count as fraction of total batches."""
    if not os.path.exists(SIM_FILE):
        return

    with open(SIM_FILE) as f:
        data = json.load(f)

    voter_counts = sorted(set(r['voters'] for r in data))
    margin_pcts = sorted(set(r['marginPct'] for r in data), reverse=True)

    matrix = []
    for margin in margin_pcts:
        row = []
        for voters in voter_counts:
            match = [r for r in data if r['voters'] == voters and r['marginPct'] == margin]
            if match:
                row.append(match[0]['savingsPct'])
            else:
                row.append(0)
        matrix.append(row)

    fig, ax = plt.subplots(figsize=(10, 6))

    im = ax.imshow(matrix, cmap='YlGnBu', aspect='auto', vmin=0, vmax=100)

    ax.set_xticks(range(len(voter_counts)))
    ax.set_xticklabels(voter_counts)
    ax.set_yticks(range(len(margin_pcts)))
    ax.set_yticklabels([f'{m}%' for m in margin_pcts])
    ax.set_xlabel('Number of Voters', fontsize=12)
    ax.set_ylabel('Margin', fontsize=12)
    ax.set_title('MaciRLA Sampling Savings Heatmap (%)', fontsize=14)

    # Add text annotations
    for i in range(len(margin_pcts)):
        for j in range(len(voter_counts)):
            val = matrix[i][j]
            color = 'white' if val > 50 else 'black'
            ax.text(j, i, f'{val}%', ha='center', va='center', fontsize=9, color=color)

    fig.colorbar(im, label='Savings (%)')

    output = os.path.join(RESULTS_DIR, 'savings-heatmap.png')
    fig.savefig(output, dpi=150, bbox_inches='tight')
    print(f"Saved: {output}")
    plt.close()


if __name__ == '__main__':
    os.makedirs(RESULTS_DIR, exist_ok=True)
    plot_savings_by_voters()
    plot_gas_comparison()
    plot_samples_heatmap()
    print("\nDone. Charts saved to experiments/results/")
