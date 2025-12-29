#!/usr/bin/env python3
"""
Thesis chart generator (reproducible, no synthetic fallback by default).

Generates:
- Gateway visibility: V1 vs V4a matrix, trust boundary diagram (conceptual but derived from your model)
- Performance: latency bar+err, latency boxplot, handshake overhead stacked, handshake breakdown, payload sizes, latency CDF

Expected CSVs (in --data-dir):
- p2-e2e-latency.csv        columns: iteration,type,latency_ms   where type in {baseline,vp_first,vp_subsequent}
- p1-handshake-latency.csv  columns: iteration,handshake_ms,total_request_ms
- p3-payload-sizes.csv      columns: type,size_bytes,description  (type includes: plain_json, didcomm_request, didcomm_message)
Optional:
- p4-payload-sizes.csv      columns: label,size_bytes

Usage:
  python3 generate_charts.py --data-dir ./performance-results --out-dir ./charts
"""

from __future__ import annotations

import argparse
import csv
import os
from dataclasses import dataclass
from typing import List, Dict, Tuple

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch


# -------------------------
# Styling (thesis-friendly)
# -------------------------
def apply_style():
    # Avoid seaborn dependency; keep consistent and printable.
    plt.rcParams.update({
        "figure.dpi": 150,
        "savefig.dpi": 300,
        "font.size": 11,
        "axes.titlesize": 14,
        "axes.labelsize": 13,
        "legend.fontsize": 10,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.figsize": (11, 7),
    })


COLORS = {
    # Performance modes
    "baseline": "#2E7D32",     # darker green (prints better)
    "vp_first": "#C62828",     # darker red
    "vp_cached": "#1565C0",    # darker blue

    # Visibility statuses
    "visible": "#C62828",
    "partial": "#EF6C00",
    "protected": "#2E7D32",

    # Breakdown components
    "did_resolution": "#6A1B9A",
    "vp_exchange": "#C62828",
    "crypto_ops": "#EF6C00",
    "pex_eval": "#00897B",
    "didcomm_pack": "#1565C0",
    "network": "#546E7A",
}


# -------------------------
# IO helpers
# -------------------------
def read_csv(path: str) -> List[Dict[str, str]]:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing CSV: {path}")
    with open(path, "r", newline="") as f:
        return list(csv.DictReader(f))


def ensure_outdir(out_dir: str):
    os.makedirs(out_dir, exist_ok=True)


def save_fig(out_dir: str, name: str):
    png = os.path.join(out_dir, f"{name}.png")
    pdf = os.path.join(out_dir, f"{name}.pdf")
    plt.savefig(png, bbox_inches="tight")
    plt.savefig(pdf, bbox_inches="tight")
    print(f"Created: {png}")
    plt.close()


# -------------------------
# Performance charts
# -------------------------
def chart_latency_bar(latency_rows: List[Dict[str, str]], out_dir: str):
    """Bar chart: Baseline vs VP-First vs VP-Cached (mean + std)."""
    def vals(t: str) -> List[int]:
        return [int(r["latency_ms"]) for r in latency_rows if r["type"] == t]

    baseline = vals("baseline")
    vp_first = vals("vp_first")
    vp_cached = vals("vp_subsequent")

    for arr, name in [(baseline, "baseline"), (vp_first, "vp_first"), (vp_cached, "vp_subsequent")]:
        if len(arr) < 5:
            raise ValueError(f"Not enough samples for {name}: n={len(arr)} (need >=5)")

    means = [np.mean(baseline), np.mean(vp_first), np.mean(vp_cached)]
    stds  = [np.std(baseline),  np.std(vp_first),  np.std(vp_cached)]

    labels = ["Baseline\n(mTLS only)", "VP-Auth\n(First Request)", "VP-Auth\n(Session Cached)"]
    colors = [COLORS["baseline"], COLORS["vp_first"], COLORS["vp_cached"]]

    fig, ax = plt.subplots(figsize=(10, 6))
    bars = ax.bar(labels, means, yerr=stds, capsize=6, color=colors, edgecolor="black", linewidth=1.0)

    for b, m in zip(bars, means):
        ax.annotate(f"{m:.0f} ms", (b.get_x() + b.get_width()/2, b.get_height()),
                    textcoords="offset points", xytext=(0, 5), ha="center", fontweight="bold")

    overhead = means[1] - means[0]
    ax.annotate(f"Overhead: +{overhead:.0f} ms\n(+{(overhead/means[0])*100:.0f}%)",
                xy=(1, means[1]), xytext=(1.25, means[1] + max(stds)*1.2 + 40),
                arrowprops=dict(arrowstyle="->", lw=1.2, color=COLORS["vp_first"]),
                bbox=dict(boxstyle="round", facecolor="white", edgecolor=COLORS["vp_first"]),
                color=COLORS["vp_first"], fontweight="bold")

    ax.set_ylabel("Latency (ms)")
    ax.set_title("E2E Request Latency: Baseline vs VP Authentication")
    ax.set_ylim(0, max(means) * 1.35)

    legend = [
        mpatches.Patch(facecolor=COLORS["baseline"], edgecolor="black", label="Baseline (direct HTTP)"),
        mpatches.Patch(facecolor=COLORS["vp_first"], edgecolor="black", label="VP-Auth (incl. handshake)"),
        mpatches.Patch(facecolor=COLORS["vp_cached"], edgecolor="black", label="VP-Auth (session reuse)"),
    ]
    ax.legend(handles=legend, loc="upper right")
    plt.tight_layout()
    save_fig(out_dir, "p2-latency-comparison")


def chart_latency_boxplot(latency_rows: List[Dict[str, str]], out_dir: str):
    """Boxplot distribution for the same three modes."""
    def vals(t: str) -> List[int]:
        return [int(r["latency_ms"]) for r in latency_rows if r["type"] == t]

    baseline = vals("baseline")
    vp_first = vals("vp_first")
    vp_cached = vals("vp_subsequent")

    data = [baseline, vp_first, vp_cached]
    labels = ["Baseline\n(mTLS only)", "VP-Auth\n(First Request)", "VP-Auth\n(Session Cached)"]
    colors = [COLORS["baseline"], COLORS["vp_first"], COLORS["vp_cached"]]

    fig, ax = plt.subplots(figsize=(10, 7))
    bp = ax.boxplot(data, widths=0.55, patch_artist=True, showfliers=True)

    for patch, c in zip(bp["boxes"], colors):
        patch.set_facecolor(c)
        patch.set_alpha(0.75)

    for med in bp["medians"]:
        med.set_color("black")
        med.set_linewidth(2)

    means = [np.mean(d) for d in data]
    ax.scatter([1,2,3], means, marker="D", s=55, facecolor="white", edgecolor="black", zorder=5, label="Mean")

    ax.set_xticklabels(labels, fontsize=12)
    ax.set_ylabel("Latency (ms)")
    ax.set_title("E2E Latency Distribution")
    ax.legend(loc="upper right")
    ax.set_ylim(0, max(max(vp_first), max(vp_cached)) * 1.3)

    plt.tight_layout()
    save_fig(out_dir, "p1-latency-boxplot")


def chart_handshake_overhead(handshake_rows: List[Dict[str, str]], out_dir: str):
    """Stacked bar: service time + handshake time per iteration."""
    it = [int(r["iteration"]) for r in handshake_rows]
    handshake = [int(r["handshake_ms"]) for r in handshake_rows]
    total = [int(r["total_request_ms"]) for r in handshake_rows]
    service = [t - h for t, h in zip(total, handshake)]

    fig, ax = plt.subplots(figsize=(10, 6))
    x = np.arange(len(it))

    ax.bar(x, service, width=0.6, color=COLORS["vp_cached"], edgecolor="black", label="Service Request")
    ax.bar(x, handshake, width=0.6, bottom=service, color=COLORS["vp_first"], edgecolor="black", label="VP Handshake")

    for i, t in enumerate(total):
        ax.annotate(f"{t} ms", (x[i], t), textcoords="offset points", xytext=(0, 5), ha="center", fontweight="bold")
        if handshake[i] > 0:
            ax.annotate(f"{handshake[i]} ms", (x[i], service[i] + handshake[i]/2),
                        ha="center", va="center", color="white", fontweight="bold", fontsize=9)

    ax.set_xticks(x)
    ax.set_xticklabels([f"Request {k}" for k in it])
    ax.set_ylabel("Latency (ms)")
    ax.set_title("VP Handshake Overhead per Request")
    ax.legend(loc="upper right")
    ax.set_ylim(0, max(total) * 1.2)

    plt.tight_layout()
    save_fig(out_dir, "p1-handshake-overhead")


def chart_handshake_breakdown(out_dir: str):
    """
    Stacked bars baseline vs V1 vs V4a.
    IMPORTANT: Use measured/derived numbers (from your logs) — not random.
    If you have a CSV for components, wire it here.
    """
    fig, ax = plt.subplots(figsize=(12, 7))

    components = [
        ("DID Resolution", COLORS["did_resolution"]),
        ("VP Exchange", COLORS["vp_exchange"]),
        ("Crypto Ops", COLORS["crypto_ops"]),
        ("PEX Eval", COLORS["pex_eval"]),
        ("DIDComm Pack", COLORS["didcomm_pack"]),
        ("Network", COLORS["network"]),
    ]

    # Replace these with your measured breakdown.
    baseline = [0, 0, 0, 0, 0, 165]
    v1 =       [800, 600, 150, 50, 300, 300]   # ~2200 if you include everything; adjust to your measurement model
    v4a =      [800, 600, 100, 50,  50, 250]

    modes = ["Baseline\n(mTLS only)", "V1\n(E2E Encrypted)", "V4a\n(mTLS + DIDComm)"]
    series = [baseline, v1, v4a]

    x = np.arange(3)
    bottom = np.zeros(3)

    for idx, (name, color) in enumerate(components):
        vals = [s[idx] for s in series]
        ax.bar(x, vals, bottom=bottom, color=color, edgecolor="white", linewidth=1, label=name)
        bottom += np.array(vals)

    totals = bottom.tolist()
    for i, t in enumerate(totals):
        ax.annotate(f"{int(t)} ms", (i, t), textcoords="offset points", xytext=(0, 6), ha="center", fontweight="bold")

    ax.set_xticks(x)
    ax.set_xticklabels(modes, fontsize=12)
    ax.set_ylabel("Time (ms)")
    ax.set_title("Handshake Time Breakdown (First Request)")
    ax.legend(loc="upper right", fontsize=10)
    ax.set_ylim(0, max(totals) * 1.15)

    plt.tight_layout()
    save_fig(out_dir, "p2-handshake-breakdown")


def chart_payload_sizes(p3_rows: List[Dict[str, str]], out_dir: str):
    """Bar chart: plain vs didcomm request vs didcomm with session."""
    # Map by type
    m = {r["type"]: int(r["size_bytes"]) for r in p3_rows}

    plain = m.get("plain_json")
    req = m.get("didcomm_request")
    msg = m.get("didcomm_message")

    if plain is None or req is None or msg is None:
        raise ValueError("p3-payload-sizes.csv must include types: plain_json, didcomm_request, didcomm_message")

    labels = ["Plain JSON\n(Unencrypted)", "DIDComm JWE\n(Request)", "DIDComm JWE\n(With Session)"]
    vals = [plain, req, msg]

    fig, ax = plt.subplots(figsize=(10, 6))
    bars = ax.bar(labels, vals, color=["#9E9E9E", "#6A1B9A", "#6A1B9A"], edgecolor="black")

    for b, v in zip(bars, vals):
        ax.annotate(f"{v} B\n({v/plain:.1f}x)", (b.get_x()+b.get_width()/2, v),
                    textcoords="offset points", xytext=(0, 5), ha="center", fontweight="bold")

    ax.set_ylabel("Payload Size (Bytes)")
    ax.set_title("Payload Size: Plain JSON vs DIDComm JWE")
    ax.set_ylim(0, max(vals) * 1.3)

    plt.tight_layout()
    save_fig(out_dir, "p3-payload-sizes")


def chart_latency_cdf(latency_rows: List[Dict[str, str]], out_dir: str):
    """CDF from real samples."""
    def vals(t: str) -> np.ndarray:
        return np.array([int(r["latency_ms"]) for r in latency_rows if r["type"] == t], dtype=float)

    baseline = vals("baseline")
    vp_first = vals("vp_first")
    vp_cached = vals("vp_subsequent")

    fig, ax = plt.subplots(figsize=(11, 7))

    for data, label, color, ls in [
        (baseline, "Baseline (mTLS only)", COLORS["baseline"], "-"),
        (vp_first, "VP-Auth (First Request)", COLORS["vp_first"], "--"),
        (vp_cached, "VP-Auth (Session Cached)", COLORS["vp_cached"], "-"),
    ]:
        s = np.sort(data)
        cdf = np.arange(1, len(s)+1) / len(s)
        ax.plot(s, cdf*100, label=label, color=color, linewidth=2.5, linestyle=ls)

    for pct in [50, 95, 99]:
        ax.axhline(pct, color="gray", linestyle=":", alpha=0.5)
        ax.text(ax.get_xlim()[1]*0.98, pct+1, f"p{pct}", color="gray", ha="right", fontsize=9)

    ax.set_xlabel("Latency (ms)")
    ax.set_ylabel("Cumulative Percentage (%)")
    ax.set_title('Latency Distribution (CDF): "X% complete within Y ms"')
    ax.set_ylim(0, 102)
    ax.legend(loc="lower right")
    ax.grid(True, alpha=0.3)

    plt.tight_layout()
    save_fig(out_dir, "p3-latency-cdf")


# -------------------------
# Gateway / Visibility charts
# -------------------------
def chart_visibility_matrix(out_dir: str):
    """Heatmap: V1 vs V4a payload visibility."""
    fig, axes = plt.subplots(1, 2, figsize=(16, 8))

    categories = ["HTTP\nMethod/Path", "DIDComm\nHeader", "DIDComm\nType",
                  "VP/VC\nMetadata", "VP/VC\nClaims", "Service\nPayload", "Crypto\nMaterial"]
    observers = ["NF-A App", "Envoy A", "Gateway", "Envoy B", "NF-B App", "Access Logs"]

    # 2=visible, 1=partial, 0=protected
    v1 = np.array([
        [2,2,2,2,2,2,0],
        [2,0,0,0,0,0,0],
        [2,0,0,0,0,0,0],
        [2,0,0,0,0,0,0],
        [2,2,2,2,2,2,0],
        [2,0,0,0,0,0,0],
    ])
    v4a = np.array([
        [2,2,2,2,2,2,0],
        [2,2,2,1,1,1,0],
        [2,2,2,1,1,1,0],
        [2,2,2,1,1,1,0],
        [2,2,2,2,2,2,0],
        [2,1,1,0,0,0,0],
    ])

    # Custom colormap: 0=protected (red-ish), 1=partial (orange), 2=visible (green)
    from matplotlib.colors import ListedColormap
    cmap = ListedColormap([COLORS["visible"], COLORS["partial"], COLORS["protected"]])

    for ax, data, title in [
        (axes[0], v1, "V1: E2E DIDComm Encrypted (JWE)"),
        (axes[1], v4a, "V4a: DIDComm over mTLS (Unencrypted)"),
    ]:
        im = ax.imshow(data, cmap=cmap, aspect="auto", vmin=0, vmax=2)

        ax.set_xticks(np.arange(len(categories)))
        ax.set_yticks(np.arange(len(observers)))
        ax.set_xticklabels(categories, fontsize=10)
        ax.set_yticklabels(observers, fontsize=11)
        plt.setp(ax.get_xticklabels(), rotation=45, ha="right")

        for i in range(data.shape[0]):
            for j in range(data.shape[1]):
                val = data[i, j]
                txt = "V" if val == 2 else ("P" if val == 1 else "X")
                ax.text(j, i, txt, ha="center", va="center", color="white", fontweight="bold", fontsize=12)

        # white grid
        ax.set_xticks(np.arange(len(categories)+1)-.5, minor=True)
        ax.set_yticks(np.arange(len(observers)+1)-.5, minor=True)
        ax.grid(which="minor", color="white", linewidth=2)
        ax.tick_params(which="minor", bottom=False, left=False)

        ax.set_title(title, fontweight="bold", pad=14)

    legend = [
        mpatches.Patch(facecolor=COLORS["protected"], label="V = Visible (Full Access)"),
        mpatches.Patch(facecolor=COLORS["partial"], label="P = Partial (Metadata Only)"),
        mpatches.Patch(facecolor=COLORS["visible"], label="X = Protected (Encrypted)"),
    ]
    fig.legend(handles=legend, loc="lower center", ncol=3, frameon=True, bbox_to_anchor=(0.5, 0.02))
    plt.suptitle("Payload Visibility Matrix: Gateway Trust Boundaries", fontsize=16, fontweight="bold", y=0.98)
    plt.tight_layout(rect=[0, 0.08, 1, 0.95])
    save_fig(out_dir, "g1-visibility-matrix")


def chart_trust_boundary_diagram(out_dir: str):
    """Two-panel conceptual diagram: encryption scope V1 vs V4a."""
    fig, axes = plt.subplots(1, 2, figsize=(16, 9))

    for ax, title, e2e in [
        (axes[0], "V1: End-to-End DIDComm Encryption", True),
        (axes[1], "V4a: DIDComm over mTLS (Unencrypted)", False),
    ]:
        ax.set_xlim(0, 10)
        ax.set_ylim(0, 10)
        ax.axis("off")

        comps = [(1,8,"NF-A\nApp"), (3,8,"Proxy\nA"), (5,8,"Gateway"), (7,8,"Proxy\nB"), (9,8,"NF-B\nApp")]
        for x,y,lbl in comps:
            box = FancyBboxPatch((x-0.6, y-0.5), 1.2, 1.0, boxstyle="round,pad=0.05",
                                 facecolor="#ECEFF1", edgecolor="#263238", linewidth=2)
            ax.add_patch(box)
            ax.text(x, y, lbl, ha="center", va="center", fontsize=10, fontweight="bold")

        # mTLS scope (always)
        mtls = FancyBboxPatch((2.2, 6.8), 5.6, 2.5, boxstyle="round,pad=0.1",
                              facecolor="none", edgecolor=COLORS["baseline"], linewidth=3, linestyle="--")
        ax.add_patch(mtls)
        ax.text(5, 9.35, "mTLS Encrypted (Istio)", ha="center", fontsize=11, color=COLORS["baseline"], fontweight="bold")

        # DIDComm E2E scope (only V1)
        if e2e:
            e2ebox = FancyBboxPatch((0.2, 6.5), 9.6, 3.0, boxstyle="round,pad=0.1",
                                    facecolor="none", edgecolor=COLORS["vp_first"], linewidth=3)
            ax.add_patch(e2ebox)
            ax.text(5, 9.65, "DIDComm JWE Encrypted (E2E)", ha="center", fontsize=11,
                    color=COLORS["vp_first"], fontweight="bold")

        # arrows
        y = 7.2
        for x1, x2 in [(1.4,2.6),(3.4,4.6),(5.4,6.6),(7.4,8.6)]:
            ax.annotate("", xy=(x2,y), xytext=(x1,y), arrowprops=dict(arrowstyle="->", lw=2, color="#263238"))

        # visibility notes
        msg = "Cannot read\nDIDComm payload" if e2e else "CAN read\nDIDComm payload"
        col = COLORS["protected"] if e2e else COLORS["visible"]
        for x in [3,5,7]:
            ax.text(x, 5.5, msg, ha="center", va="center", fontsize=9, fontweight="bold",
                    bbox=dict(boxstyle="round", facecolor="white", edgecolor=col, alpha=0.95),
                    color=col)

        ax.text(5, 3.5, "VP Exchange\n(Request → Presentation → Ack)", ha="center", fontsize=10, style="italic")

        insight = ("Gateway sees HTTP metadata only\nPayload content protected by JWE"
                   if e2e else "Gateway can inspect DIDComm content\nUseful for logging/auditing")
        insight_col = COLORS["protected"] if e2e else COLORS["visible"]
        ibox = FancyBboxPatch((1.5, 1.0), 7.0, 1.8, boxstyle="round,pad=0.1",
                              facecolor="#FFF8E1", edgecolor=insight_col, linewidth=2)
        ax.add_patch(ibox)
        ax.text(5, 1.9, insight, ha="center", va="center", fontsize=11, fontweight="bold")
        ax.set_title(title, fontsize=14, fontweight="bold")

    plt.suptitle("Trust Boundary Comparison: Encryption Scope", fontsize=16, fontweight="bold", y=0.98)
    plt.tight_layout(rect=[0, 0, 1, 0.95])
    save_fig(out_dir, "g2-trust-boundaries")


# -------------------------
# Main
# -------------------------
def main():
    apply_style()

    p = argparse.ArgumentParser()
    p.add_argument("--data-dir", required=True, help="Directory with performance CSV files")
    p.add_argument("--out-dir", required=True, help="Output directory for figures")
    p.add_argument("--include-cdf", action="store_true", help="Generate CDF plot (needs enough samples)")
    p.add_argument("--include-breakdown", action="store_true", help="Generate handshake breakdown (uses configured numbers)")
    args = p.parse_args()

    ensure_outdir(args.out_dir)

    # --- Load required CSVs (fail if missing) ---
    latency_csv = os.path.join(args.data_dir, "p2-e2e-latency.csv")
    handshake_csv = os.path.join(args.data_dir, "p1-handshake-latency.csv")
    payload_csv = os.path.join(args.data_dir, "p3-payload-sizes.csv")

    latency_rows = read_csv(latency_csv)
    handshake_rows = read_csv(handshake_csv)
    payload_rows = read_csv(payload_csv)

    # --- Gateway charts ---
    chart_visibility_matrix(args.out_dir)
    chart_trust_boundary_diagram(args.out_dir)

    # --- Performance charts ---
    chart_latency_bar(latency_rows, args.out_dir)
    chart_latency_boxplot(latency_rows, args.out_dir)
    chart_handshake_overhead(handshake_rows, args.out_dir)
    chart_payload_sizes(payload_rows, args.out_dir)

    if args.include_breakdown:
        chart_handshake_breakdown(args.out_dir)

    if args.include_cdf:
        chart_latency_cdf(latency_rows, args.out_dir)

    print("\n✅ Done.")


if __name__ == "__main__":
    main()
