#!/usr/bin/env python3
import re
import sys
from pathlib import Path
from collections import defaultdict, Counter
from datetime import datetime

import pandas as pd
import matplotlib.pyplot as plt


# ---------- Heuristics for common Istio/Envoy access log formats ----------
# We try multiple regex patterns because access log formats vary a lot.
PATTERNS = [
    # Example-ish:
    # [2025-12-28T12:34:56.789Z] "POST /nf/service-request HTTP/1.1" 200 - ... 12 34 56 78 "host" "ua" "..." "..." "..." 15
    re.compile(
        r'^\[(?P<ts>[^\]]+)\]\s+"(?P<meth>[A-Z]+)\s+(?P<path>\S+)\s+[^"]+"\s+(?P<code>\d{3})\s+.*?\s(?P<dur>\d+)\s*$'
    ),
    # Another common format might not include brackets at start:
    # 2025-12-28T12:34:56Z POST /path 200 ... duration=15ms
    re.compile(
        r'^(?P<ts>\d{4}-\d{2}-\d{2}T[^ ]+)\s+(?P<meth>[A-Z]+)\s+(?P<path>\S+)\s+(?P<code>\d{3}).*?(?:dur|duration|request_duration|time)=?(?P<dur>\d+)'
    ),
    # Fallback: method/path/code anywhere
    re.compile(
        r'(?P<meth>GET|POST|PUT|DELETE|PATCH)\s+(?P<path>/\S+).*?\s(?P<code>\d{3})\b'
    ),
]

# Timestamp parsing (best-effort)
TS_PARSERS = [
    # 2025-12-28T12:34:56.789Z
    ("%Y-%m-%dT%H:%M:%S.%fZ", True),
    ("%Y-%m-%dT%H:%M:%SZ", True),
    # Envoy sometimes: 2025-12-28T12:34:56.789+00:00
    ("%Y-%m-%dT%H:%M:%S.%f%z", False),
    ("%Y-%m-%dT%H:%M:%S%z", False),
]

def parse_ts(s: str):
    s = s.strip()
    for fmt, naive in TS_PARSERS:
        try:
            dt = datetime.strptime(s, fmt)
            if naive:
                return dt  # naive UTC-ish
            return dt.replace(tzinfo=None)
        except ValueError:
            continue
    return None

def iter_access_rows(log_path: Path, mode: str, cluster: str):
    with log_path.open("r", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            data = None
            for pat in PATTERNS:
                m = pat.search(line)
                if m:
                    gd = m.groupdict()
                    data = {
                        "mode": mode,
                        "cluster": cluster,
                        "method": gd.get("meth"),
                        "path": gd.get("path"),
                        "code": int(gd.get("code")) if gd.get("code") else None,
                        "duration_ms": int(gd.get("dur")) if gd.get("dur") else None,
                        "ts_raw": gd.get("ts"),
                        "raw": line,
                    }
                    break
            if data:
                dt = parse_ts(data["ts_raw"]) if data.get("ts_raw") else None
                data["ts"] = dt
                yield data

def load_all(base_dir: Path):
    rows = []
    for mode_dir in sorted(base_dir.glob("*")):
        if not mode_dir.is_dir():
            continue
        mode = mode_dir.name
        # you save g1-gw-a-istio-proxy.log and g1-gw-b-istio-proxy.log
        a = mode_dir / "g1-gw-a-istio-proxy.log"
        b = mode_dir / "g1-gw-b-istio-proxy.log"
        if a.exists():
            rows.extend(list(iter_access_rows(a, mode, "A")))
        if b.exists():
            rows.extend(list(iter_access_rows(b, mode, "B")))
    return pd.DataFrame(rows)

def save_status_by_mode(df: pd.DataFrame, outdir: Path):
    if df.empty or df["code"].isna().all():
        print("[WARN] No status codes parsed -> skipping status_by_mode plot")
        return

    # bucketize
    def bucket(code):
        if code is None:
            return "unknown"
        if 200 <= code <= 299: return "2xx"
        if 300 <= code <= 399: return "3xx"
        if 400 <= code <= 499: return "4xx"
        if 500 <= code <= 599: return "5xx"
        return "other"

    df2 = df.dropna(subset=["code"]).copy()
    df2["bucket"] = df2["code"].apply(bucket)

    pivot = (
        df2.groupby(["mode", "bucket"])
        .size()
        .reset_index(name="count")
        .pivot(index="mode", columns="bucket", values="count")
        .fillna(0)
    )

    ax = pivot.plot(kind="bar")
    ax.set_title("IngressGateway: Status buckets per MODE")
    ax.set_xlabel("MODE")
    ax.set_ylabel("Count")
    plt.tight_layout()
    plt.savefig(outdir / "status_by_mode.png", dpi=200)
    plt.close()

    pivot.to_csv(outdir / "status_by_mode.csv")
    print("[OK] status_by_mode.png + CSV written")

def save_latency_by_mode(df: pd.DataFrame, outdir: Path):
    df2 = df.dropna(subset=["duration_ms"]).copy()
    if df2.empty:
        print("[WARN] No durations parsed -> skipping latency_by_mode plot")
        return

    # cap insane outliers for readability (still keep raw csv)
    df2["duration_ms_capped"] = df2["duration_ms"].clip(upper=df2["duration_ms"].quantile(0.99))

    ax = df2.boxplot(column="duration_ms_capped", by="mode")
    plt.suptitle("")
    plt.title("IngressGateway: Request duration by MODE (capped at p99)")
    plt.xlabel("MODE")
    plt.ylabel("Duration (ms)")
    plt.tight_layout()
    plt.savefig(outdir / "latency_by_mode.png", dpi=200)
    plt.close()

    df2[["mode","cluster","method","path","code","duration_ms","ts_raw"]].to_csv(outdir / "latency_raw.csv", index=False)
    print("[OK] latency_by_mode.png + latency_raw.csv written")

def save_rps_over_time(df: pd.DataFrame, outdir: Path):
    df2 = df.dropna(subset=["ts"]).copy()
    if df2.empty:
        print("[WARN] No timestamps parsed -> skipping rps_over_time plot")
        return

    # 1-second bins
    df2["ts_sec"] = df2["ts"].dt.floor("S")
    series = df2.groupby(["mode", "ts_sec"]).size().reset_index(name="count")

    # plot each mode
    plt.figure()
    for mode, grp in series.groupby("mode"):
        grp = grp.sort_values("ts_sec")
        plt.plot(grp["ts_sec"], grp["count"], label=mode)

    plt.title("IngressGateway: Requests per second (RPS) over time")
    plt.xlabel("Time")
    plt.ylabel("Requests/sec")
    plt.legend()
    plt.tight_layout()
    plt.savefig(outdir / "rps_over_time.png", dpi=200)
    plt.close()

    series.to_csv(outdir / "rps_over_time.csv", index=False)
    print("[OK] rps_over_time.png + CSV written")

def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <base_dir>\nExample: {sys.argv[0]} ./out/gateway-analysis/20251228-120000")
        sys.exit(2)

    base_dir = Path(sys.argv[1]).resolve()
    if not base_dir.exists():
        print(f"[ERROR] base_dir not found: {base_dir}")
        sys.exit(1)

    outdir = base_dir / "plots"
    outdir.mkdir(parents=True, exist_ok=True)

    df = load_all(base_dir)
    if df.empty:
        print("[ERROR] No log data parsed. Check that g1-gw-*-istio-proxy.log exists in MODE subfolders.")
        sys.exit(1)

    # Save a unified raw table for appendix
    df.to_csv(outdir / "accesslog_parsed_raw.csv", index=False)
    print(f"[OK] Parsed rows: {len(df)} -> {outdir / 'accesslog_parsed_raw.csv'}")

    save_status_by_mode(df, outdir)
    save_latency_by_mode(df, outdir)
    save_rps_over_time(df, outdir)

    print(f"[DONE] Plots written to: {outdir}")

if __name__ == "__main__":
    main()


# #!/usr/bin/env bash
# set -euo pipefail

# BASE_DIR="${1:-}"
# if [[ -z "$BASE_DIR" ]]; then
#   echo "Usage: $0 ./out/gateway-analysis/<timestamp>"
#   exit 2
# fi

# python3 make_gateway_plots.py "$BASE_DIR"

# echo ""
# echo "Generated:"
# ls -1 "$BASE_DIR/plots" | sed 's/^/  - /'

# MODE=B   ./tests/gateway_test.sh
# MODE=V4a ./tests/gateway_test.sh
# MODE=V1  ./tests/gateway_test.sh

