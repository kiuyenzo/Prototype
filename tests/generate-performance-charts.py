#!/usr/bin/env python3

import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
import os
from glob import glob

COLORS = {
    'baseline': '#10B981',
    'signed': '#3B82F6',
    'encrypted': '#F59E0B',
    'handshake': '#C8CDD4',
    'nfa': '#06B6D4',
    'nfb': '#14B8A6',
    'bg': '#F8FAFC',
    'grid': '#E2E8F0',
    'text': '#1E293B',
    'accent': '#6366F1'
}

plt.style.use('seaborn-v0_8-whitegrid')
plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.sans-serif': ['Helvetica Neue', 'Arial', 'DejaVu Sans'],
    'font.size': 11,
    'axes.labelsize': 12,
    'axes.titlesize': 14,
    'axes.titleweight': 'bold',
    'axes.labelweight': 'medium',
    'axes.spines.top': False,
    'axes.spines.right': False,
    'axes.facecolor': COLORS['bg'],
    'axes.edgecolor': COLORS['grid'],
    'axes.linewidth': 1.5,
    'xtick.labelsize': 10,
    'ytick.labelsize': 10,
    'legend.fontsize': 10,
    'legend.framealpha': 0.9,
    'legend.edgecolor': COLORS['grid'],
    'figure.facecolor': 'white',
    'figure.dpi': 150,
    'savefig.dpi': 300,
    'savefig.bbox': 'tight',
    'savefig.facecolor': 'white',
    'grid.color': COLORS['grid'],
    'grid.linewidth': 0.8,
    'grid.alpha': 0.7
})

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RESULTS_ROOT = os.path.join(SCRIPT_DIR, 'results')
CHARTS_DIR = os.path.join(SCRIPT_DIR, 'results', 'charts')
os.makedirs(CHARTS_DIR, exist_ok=True)

run_dirs = sorted([d for d in glob(os.path.join(RESULTS_ROOT, "performance_*")) +
                       glob(os.path.join(RESULTS_ROOT, "202*"))
                   if os.path.isdir(d)])
if run_dirs:
    RESULTS_DIR = run_dirs[-1]
elif os.path.exists(os.path.join(RESULTS_ROOT, 'latency-metrics.csv')):
    RESULTS_DIR = RESULTS_ROOT
else:
    RESULTS_DIR = RESULTS_ROOT

def create_p1_percentile():
    df = pd.read_csv(f'{RESULTS_DIR}/latency-metrics.csv', comment='#')
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors='coerce')

    if 'HS_None_ms' not in df.columns:
        return

    fig, ax = plt.subplots(figsize=(14, 5))
    colors_p1 = [COLORS['handshake'], COLORS['nfb'], COLORS['nfa']]

    percentiles = [50, 75, 90, 95, 99]
    x = np.arange(len(percentiles))
    width = 0.25

    all_vals = []
    for i, (col, label, color) in enumerate([
        ('HS_None_ms', 'Baseline', colors_p1[0]),
        ('HS_JWS_ms', 'Signed', colors_p1[1]),
        ('HS_JWE_ms', 'Encrypted', colors_p1[2])
    ]):
        if col in df.columns:
            data = df[col].dropna()
            if len(data) > 0:
                vals = [np.percentile(data, p) for p in percentiles]
                all_vals.extend(vals)
                bars = ax.bar(x + i*width, vals, width, label=label, color=color,
                             alpha=0.85, edgecolor='white', linewidth=2)

    ax.set_xticks(x + width)
    ax.set_xticklabels([f'P{p}' for p in percentiles])
    ax.set_ylabel('Latency (ms)', fontweight='bold')
    ax.set_title('P1: Handshake Latency Percentiles', fontsize=14, pad=10)
    ax.legend(loc='upper left', frameon=True, fancybox=True)
    ax.set_ylim(0, max(all_vals) * 1.3 if all_vals else 100)
    y_max = ax.get_ylim()[1]
    ax.set_yticks(np.arange(0, y_max + 200, 200))

    plt.tight_layout()
    plt.savefig(f'{CHARTS_DIR}/p1-percentile.png')
    print("Created: p1-percentile.png")
    plt.close()

def create_p2_percentile():
    df = pd.read_csv(f'{RESULTS_DIR}/latency-metrics.csv', comment='#')
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors='coerce')

    fig, ax = plt.subplots(figsize=(14, 5))
    colors_p2 = [COLORS['handshake'], COLORS['nfb'], COLORS['nfa']]

    percentiles = [50, 75, 90, 95, 99]
    x = np.arange(len(percentiles))
    width = 0.25

    all_vals = []
    for i, (col, label, color) in enumerate([
        ('Baseline_ms', 'Baseline', colors_p2[0]),
        ('Signed_ms', 'Signed', colors_p2[1]),
        ('Encrypted_ms', 'Encrypted', colors_p2[2])
    ]):
        if col in df.columns:
            data = df[col].dropna()
            if len(data) > 0:
                vals = [np.percentile(data, p) for p in percentiles]
                all_vals.extend(vals)
                bars = ax.bar(x + i*width, vals, width, label=label, color=color,
                             alpha=0.85, edgecolor='white', linewidth=2)

    ax.set_xticks(x + width)
    ax.set_xticklabels([f'P{p}' for p in percentiles])
    ax.set_ylabel('Latency (ms)', fontweight='bold')
    ax.set_title('P2: E2E Request Latency Percentiles', fontsize=14, pad=10)
    ax.legend(loc='upper left', frameon=True, fancybox=True)
    y_max_raw = max(all_vals) * 1.3 if all_vals else 100
    y_max = int(np.ceil(y_max_raw / 200) * 200)
    ax.set_ylim(0, y_max)
    ax.set_yticks(np.arange(0, y_max + 1, 200))

    plt.tight_layout()
    plt.savefig(f'{CHARTS_DIR}/p2-percentile.png')
    print("Created: p2-percentile.png")
    plt.close()

def create_payload_chart():
    df = pd.read_csv(f'{RESULTS_DIR}/payload-size-metrics.csv', comment='#')
    df['Size_Bytes'] = pd.to_numeric(df['Size_Bytes'], errors='coerce')
    df = df.dropna(subset=['Size_Bytes'])

    if len(df) < 1:
        print("Warning: No valid payload size data for chart")
        return

    fig, ax = plt.subplots(figsize=(10, 5))

    formats = df['Format'].tolist()
    sizes = df['Size_Bytes'].tolist()
    label_map = {'Plain': 'Baseline', 'JWS': 'Signed', 'JWE': 'Encrypted'}
    display_labels = [label_map.get(f, f) for f in formats]
    color_map = {'Plain': COLORS['handshake'], 'JWS': COLORS['nfb'], 'JWE': COLORS['nfa']}
    colors = [color_map.get(f, COLORS['nfa']) for f in formats]

    baseline_size = sizes[formats.index('Plain')] if 'Plain' in formats else sizes[0]
    overhead_labels = [f'{int(s)}\n(+{((s/baseline_size)-1)*100:.0f}%)' if s != baseline_size else str(int(s)) for s in sizes]

    x = np.arange(len(formats)) * 0.65
    width = 0.35

    bars = ax.bar(x, sizes, width, color=colors, alpha=0.85, edgecolor='white', linewidth=2)
    ax.set_ylabel('Payload Size (bytes)', fontweight='bold')
    ax.set_title('Overhead Analysis', fontsize=14, pad=10)
    ax.set_xticks(x)
    ax.set_xticklabels(display_labels)
    ax.set_ylim(0, max(sizes) * 1.4)

    from matplotlib.patches import Patch
    legend_elements = [Patch(facecolor=colors[i], alpha=0.85, label=display_labels[i]) for i in range(len(formats))]
    ax.legend(handles=legend_elements, loc='upper left', frameon=True, fancybox=True)

    plt.suptitle('DIDComm Payload Size Overhead', fontsize=16, fontweight='bold', y=1.02)
    plt.tight_layout()
    plt.savefig(f'{CHARTS_DIR}/p3-payload-size.png')
    print("Created: p3-payload-size.png")
    plt.close()

def create_cpu_memory_chart():
    df = pd.read_csv(f'{RESULTS_DIR}/cpu-metrics.csv', comment='#')
    df['CPU_Millicores'] = pd.to_numeric(df['CPU_Millicores'], errors='coerce')
    df['Memory_Mi'] = pd.to_numeric(df['Memory_Mi'], errors='coerce')
    df = df.dropna(subset=['CPU_Millicores', 'Memory_Mi'])

    if len(df) < 1:
        print("Warning: No valid CPU/Memory data for chart")
        return

    if 'Sample' in df.columns:
        df_agg = df.groupby(['Phase', 'Pod', 'Container']).agg({
            'CPU_Millicores': 'mean',
            'Memory_Mi': 'mean'
        }).reset_index()
    else:
        df_agg = df
        n_samples = 1

    idle = df_agg[df_agg['Phase'] == 'idle']
    nfa = idle[idle['Pod'].str.contains('nf-a')]
    nfb = idle[idle['Pod'].str.contains('nf-b')]

    all_containers = df_agg['Container'].unique().tolist()
    container_map = {
        'istio-proxy': 'Istio Proxy',
        'nf-service': 'NF Service',
        'veramo-sidecar': 'Veramo Sidecar'
    }
    containers = [c for c in ['istio-proxy', 'nf-service', 'veramo-sidecar'] if c in all_containers]
    container_labels = [container_map.get(c, c) for c in containers]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    x = np.arange(len(containers))
    width = 0.35

    def safe_get(df, container, column):
        filtered = df[df['Container'] == container]
        if len(filtered) > 0:
            return filtered[column].values[0]
        return 0

    cpu_nfa = [safe_get(nfa, c, 'CPU_Millicores') for c in containers]
    cpu_nfb = [safe_get(nfb, c, 'CPU_Millicores') for c in containers]

    bars1 = ax1.bar(x - width/2, cpu_nfa, width, label='NF-A (Initiator)',
                   color=COLORS['nfa'], alpha=0.85, edgecolor='white', linewidth=2)
    bars2 = ax1.bar(x + width/2, cpu_nfb, width, label='NF-B (Responder)',
                   color=COLORS['nfb'], alpha=0.85, edgecolor='white', linewidth=2)

    ax1.set_ylabel('CPU (millicores)', fontweight='bold')
    ax1.set_title('CPU Usage by Container', fontsize=14, pad=10)
    ax1.set_xticks(x)
    ax1.set_xticklabels(container_labels)
    ax1.legend(loc='upper left', frameon=True, fancybox=True)
    ax1.set_ylim(0, max(max(cpu_nfa), max(cpu_nfb)) * 1.3)

    mem_nfa = [safe_get(nfa, c, 'Memory_Mi') for c in containers]
    mem_nfb = [safe_get(nfb, c, 'Memory_Mi') for c in containers]

    bars3 = ax2.bar(x - width/2, mem_nfa, width, label='NF-A (Initiator)',
                   color=COLORS['nfa'], alpha=0.85, edgecolor='white', linewidth=2)
    bars4 = ax2.bar(x + width/2, mem_nfb, width, label='NF-B (Responder)',
                   color=COLORS['nfb'], alpha=0.85, edgecolor='white', linewidth=2)

    ax2.set_ylabel('Memory (MiB)', fontweight='bold')
    ax2.set_title('Memory Usage by Container', fontsize=14, pad=10)
    ax2.set_xticks(x)
    ax2.set_xticklabels(container_labels)
    ax2.legend(loc='upper left', frameon=True, fancybox=True)
    ax2.set_ylim(0, max(max(mem_nfa), max(mem_nfb)) * 1.3)

    plt.suptitle('Resource Footprint Analysis', fontsize=16, fontweight='bold', y=1.02)
    plt.tight_layout()
    plt.savefig(f'{CHARTS_DIR}/p4-cpu-memory.png')
    print("Created: p4-cpu-memory.png")
    plt.close()

if __name__ == '__main__':
    df_check = pd.read_csv(f'{RESULTS_DIR}/latency-metrics.csv', comment='#')
    has_p1_data = 'HS_None_ms' in df_check.columns or 'Handshake_ms' in df_check.columns

    if has_p1_data:
        create_p1_percentile()

    create_p2_percentile()
    create_payload_chart()
    create_cpu_memory_chart()

    print(f"Output: {CHARTS_DIR}")
