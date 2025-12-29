#!/usr/bin/env python3
"""
Performance Charts for Thesis

Creates latency comparison charts from test-performance.sh output:
- Boxplot: Latency distribution per mode
- Bar chart: Mean/P95 latency comparison
- First vs Reuse comparison for V4a/V1

Usage: python3 generate_performance_charts.py <base_dir>
"""

import csv
import sys
from pathlib import Path
from collections import defaultdict
import matplotlib.pyplot as plt
import numpy as np

COLORS = {
    'B': '#E74C3C',      # Red - Baseline
    'V4a': '#F39C12',    # Orange - JWS
    'V1': '#27AE60',     # Green - JWE
}

MODE_LABELS = {
    'B': 'Baseline B\n(no DIDComm)',
    'V4a': 'V4a\n(DIDComm JWS)',
    'V1': 'V1\n(DIDComm JWE)'
}


def load_latency_data(base_dir: Path) -> dict:
    """Load latency data from all mode directories."""
    data = {}

    # Check if mode directories exist directly under base_dir
    for mode in ['B', 'V4a', 'V1']:
        mode_dir = base_dir / mode
        csv_file = mode_dir / 'latency.csv'

        if csv_file.exists():
            latencies = defaultdict(list)
            with open(csv_file) as f:
                reader = csv.DictReader(f)
                for row in reader:
                    kind = row.get('kind', 'unknown')
                    latency = int(row.get('latency_ms', 0))
                    latencies[kind].append(latency)

            if latencies:
                data[mode] = dict(latencies)
                print(f"  Loaded {mode}: {sum(len(v) for v in latencies.values())} samples")

    # If not found, try timestamp subdirectories
    if not data:
        ts_dirs = sorted([d for d in base_dir.iterdir() if d.is_dir() and d.name not in ['plots', 'B', 'V4a', 'V1']], reverse=True)
        for ts_dir in ts_dirs:
            for mode in ['B', 'V4a', 'V1']:
                mode_dir = ts_dir / mode
                csv_file = mode_dir / 'latency.csv'

                if csv_file.exists():
                    latencies = defaultdict(list)
                    with open(csv_file) as f:
                        reader = csv.DictReader(f)
                        for row in reader:
                            kind = row.get('kind', 'unknown')
                            latency = int(row.get('latency_ms', 0))
                            latencies[kind].append(latency)

                    if latencies:
                        data[mode] = dict(latencies)
                        print(f"  Loaded {mode}: {sum(len(v) for v in latencies.values())} samples")

            if data:
                break

    return data


def calculate_stats(latencies: list) -> dict:
    """Calculate statistics for a list of latencies."""
    if not latencies:
        return {'mean': 0, 'median': 0, 'p95': 0, 'min': 0, 'max': 0, 'n': 0}

    sorted_lat = sorted(latencies)
    n = len(sorted_lat)
    p95_idx = int(round(0.95 * (n - 1)))

    return {
        'mean': np.mean(sorted_lat),
        'median': np.median(sorted_lat),
        'p95': sorted_lat[p95_idx] if n > 0 else 0,
        'min': sorted_lat[0] if n > 0 else 0,
        'max': sorted_lat[-1] if n > 0 else 0,
        'n': n
    }


def plot_latency_boxplot(data: dict, outdir: Path):
    """Create boxplot comparison of latency distributions."""
    fig, ax = plt.subplots(figsize=(12, 6))

    # Prepare data for boxplot
    plot_data = []
    labels = []
    colors = []

    for mode in ['B', 'V4a', 'V1']:
        if mode not in data:
            continue

        mode_data = data[mode]

        if mode == 'B':
            # Baseline has only one kind
            if 'baseline' in mode_data:
                plot_data.append(mode_data['baseline'])
                labels.append('B\n(baseline)')
                colors.append(COLORS['B'])
        else:
            # V4a/V1 have first and reuse
            if 'first' in mode_data:
                plot_data.append(mode_data['first'])
                labels.append(f'{mode}\n(first)')
                colors.append(COLORS[mode])
            if 'reuse' in mode_data:
                plot_data.append(mode_data['reuse'])
                labels.append(f'{mode}\n(reuse)')
                # Lighter color for reuse
                colors.append(COLORS[mode])

    if not plot_data:
        print("[WARN] No latency data to plot")
        return

    bp = ax.boxplot(plot_data, labels=labels, patch_artist=True)

    # Color the boxes
    for patch, color in zip(bp['boxes'], colors):
        patch.set_facecolor(color)
        patch.set_alpha(0.7)

    ax.set_ylabel('Latency (ms)', fontsize=11)
    ax.set_xlabel('Mode / Call Type', fontsize=11)
    ax.set_title('Request Latency Distribution by Mode\n(Lower is Better)', fontsize=12, fontweight='bold')
    ax.grid(axis='y', alpha=0.3)

    # Add stats annotation
    for i, (d, label) in enumerate(zip(plot_data, labels)):
        stats = calculate_stats(d)
        ax.annotate(f'μ={stats["mean"]:.0f}ms\np95={stats["p95"]:.0f}ms',
                   xy=(i+1, stats['max']),
                   xytext=(0, 10),
                   textcoords='offset points',
                   ha='center', fontsize=8,
                   bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))

    plt.tight_layout()
    plt.savefig(outdir / 'latency_boxplot.png', dpi=200, bbox_inches='tight')
    plt.close()
    print(f"[OK] latency_boxplot.png")


def plot_latency_comparison(data: dict, outdir: Path):
    """Create bar chart comparing mean and P95 latencies."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    modes = [m for m in ['B', 'V4a', 'V1'] if m in data]

    # Calculate stats per mode
    stats_by_mode = {}
    for mode in modes:
        mode_data = data[mode]
        if mode == 'B':
            all_lat = mode_data.get('baseline', [])
            first_lat = all_lat
            reuse_lat = all_lat
        else:
            first_lat = mode_data.get('first', [])
            reuse_lat = mode_data.get('reuse', [])
            all_lat = first_lat + reuse_lat

        stats_by_mode[mode] = {
            'all': calculate_stats(all_lat),
            'first': calculate_stats(first_lat),
            'reuse': calculate_stats(reuse_lat)
        }

    # Left: Overall mean latency comparison
    ax1 = axes[0]
    x = np.arange(len(modes))
    means = [stats_by_mode[m]['all']['mean'] for m in modes]
    bars = ax1.bar(x, means, color=[COLORS[m] for m in modes], alpha=0.85)

    ax1.set_ylabel('Mean Latency (ms)', fontsize=11)
    ax1.set_title('Mean Request Latency by Mode', fontsize=12, fontweight='bold')
    ax1.set_xticks(x)
    ax1.set_xticklabels([MODE_LABELS[m] for m in modes], fontsize=9)

    for bar, val in zip(bars, means):
        ax1.annotate(f'{val:.0f}ms',
                    xy=(bar.get_x() + bar.get_width()/2, bar.get_height()),
                    xytext=(0, 5),
                    textcoords='offset points',
                    ha='center', fontsize=10, fontweight='bold')

    # Right: First vs Reuse comparison
    ax2 = axes[1]
    width = 0.35

    first_means = []
    reuse_means = []

    for mode in modes:
        first_means.append(stats_by_mode[mode]['first']['mean'])
        reuse_means.append(stats_by_mode[mode]['reuse']['mean'])

    bars1 = ax2.bar(x - width/2, first_means, width, label='First Request',
                    color=[COLORS[m] for m in modes], alpha=0.9)
    bars2 = ax2.bar(x + width/2, reuse_means, width, label='Subsequent (Reuse)',
                    color=[COLORS[m] for m in modes], alpha=0.5, hatch='//')

    ax2.set_ylabel('Mean Latency (ms)', fontsize=11)
    ax2.set_title('First vs Subsequent Request Latency\n(Session/Connection Reuse)', fontsize=12, fontweight='bold')
    ax2.set_xticks(x)
    ax2.set_xticklabels([MODE_LABELS[m] for m in modes], fontsize=9)
    ax2.legend()

    # Add value labels
    for bars in [bars1, bars2]:
        for bar in bars:
            height = bar.get_height()
            ax2.annotate(f'{height:.0f}',
                        xy=(bar.get_x() + bar.get_width()/2, height),
                        xytext=(0, 3),
                        textcoords='offset points',
                        ha='center', fontsize=9)

    plt.tight_layout()
    plt.savefig(outdir / 'latency_comparison.png', dpi=200, bbox_inches='tight')
    plt.close()
    print(f"[OK] latency_comparison.png")


def plot_overhead_analysis(data: dict, outdir: Path):
    """Analyze and visualize DIDComm overhead vs baseline."""
    fig, ax = plt.subplots(figsize=(10, 6))

    if 'B' not in data:
        print("[WARN] Baseline data missing, cannot calculate overhead")
        return

    baseline_mean = np.mean(data['B'].get('baseline', [1]))

    modes = ['V4a', 'V1']
    present_modes = [m for m in modes if m in data]

    if not present_modes:
        print("[WARN] No V4a/V1 data for overhead analysis")
        return

    x = np.arange(len(present_modes))
    width = 0.35

    first_overhead = []
    reuse_overhead = []

    for mode in present_modes:
        first_mean = np.mean(data[mode].get('first', [0]))
        reuse_mean = np.mean(data[mode].get('reuse', [0]))

        first_overhead.append(((first_mean - baseline_mean) / baseline_mean) * 100)
        reuse_overhead.append(((reuse_mean - baseline_mean) / baseline_mean) * 100)

    bars1 = ax.bar(x - width/2, first_overhead, width, label='First Request Overhead',
                   color=[COLORS[m] for m in present_modes], alpha=0.9)
    bars2 = ax.bar(x + width/2, reuse_overhead, width, label='Subsequent Request Overhead',
                   color=[COLORS[m] for m in present_modes], alpha=0.5, hatch='//')

    ax.set_ylabel('Overhead vs Baseline (%)', fontsize=11)
    ax.set_title(f'DIDComm Latency Overhead vs Baseline\n(Baseline mean: {baseline_mean:.0f}ms)',
                 fontsize=12, fontweight='bold')
    ax.set_xticks(x)
    ax.set_xticklabels([MODE_LABELS[m] for m in present_modes], fontsize=10)
    ax.legend()
    ax.axhline(y=0, color='gray', linestyle='--', alpha=0.5)

    # Value labels
    for bars in [bars1, bars2]:
        for bar in bars:
            height = bar.get_height()
            ax.annotate(f'{height:+.1f}%',
                       xy=(bar.get_x() + bar.get_width()/2, height),
                       xytext=(0, 5 if height >= 0 else -15),
                       textcoords='offset points',
                       ha='center', fontsize=10, fontweight='bold')

    plt.tight_layout()
    plt.savefig(outdir / 'overhead_analysis.png', dpi=200, bbox_inches='tight')
    plt.close()
    print(f"[OK] overhead_analysis.png")


def generate_stats_csv(data: dict, outdir: Path):
    """Generate CSV with statistics for all modes."""
    rows = []

    for mode in ['B', 'V4a', 'V1']:
        if mode not in data:
            continue

        mode_data = data[mode]

        for kind, latencies in mode_data.items():
            stats = calculate_stats(latencies)
            rows.append({
                'mode': mode,
                'kind': kind,
                'n': stats['n'],
                'mean_ms': round(stats['mean'], 1),
                'median_ms': round(stats['median'], 1),
                'p95_ms': stats['p95'],
                'min_ms': stats['min'],
                'max_ms': stats['max']
            })

    csv_path = outdir / 'latency_stats.csv'
    with open(csv_path, 'w', newline='') as f:
        if rows:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)

    print(f"[OK] latency_stats.csv")

    # Also print summary
    print("\nLatency Summary:")
    print("-" * 60)
    for row in rows:
        print(f"  {row['mode']:4} {row['kind']:8} n={row['n']:3} "
              f"mean={row['mean_ms']:6.1f}ms p95={row['p95_ms']:4}ms")


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <base_dir>")
        print(f"Example: {sys.argv[0]} ./out/perf/thesis-20251228")
        sys.exit(2)

    base_dir = Path(sys.argv[1]).resolve()
    if not base_dir.exists():
        print(f"[ERROR] Directory not found: {base_dir}")
        sys.exit(1)

    outdir = base_dir / "plots"
    outdir.mkdir(parents=True, exist_ok=True)

    print(f"Loading performance data from: {base_dir}")
    data = load_latency_data(base_dir)

    if not data:
        print("[ERROR] No latency data found!")
        print("Run the performance tests first:")
        print("  ./tests/cpgt_tests/run-performance-all-modes.sh")
        sys.exit(1)

    print(f"Found modes: {list(data.keys())}")

    # Generate charts
    plot_latency_boxplot(data, outdir)
    plot_latency_comparison(data, outdir)
    plot_overhead_analysis(data, outdir)
    generate_stats_csv(data, outdir)

    print(f"\n[DONE] Performance charts in: {outdir}")


if __name__ == "__main__":
    main()
