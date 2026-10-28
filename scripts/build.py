"""Build site/data/problems.json from public sources.

Usage: python scripts/build.py [--minutes N] [--openalex-credits N] [--skip-measure]
Env:   GITHUB_TOKEN (optional, raises GitHub search limits; never written to disk)
"""
import argparse, json, math, os, sys, time, traceback
sys.path.insert(0, os.path.dirname(__file__))
import sources, activity

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data")
STORE = os.path.join(ROOT, "data-cache", "problems-raw.json")

ap = argparse.ArgumentParser()
ap.add_argument("--minutes", type=float, default=40)
ap.add_argument("--openalex-credits", type=int, default=600)
ap.add_argument("--skip-measure", action="store_true")
ap.add_argument("--only", default="")
args = ap.parse_args()

t0 = time.time()
budget = activity.Budget(args.openalex_credits)
status = {}
try:
    prev = {s: [] for s in ["wikipedia", "gapmap", "erdos", "opg", "openalex"]}
    prev.update(json.load(open(STORE)))
except Exception:
    pass

problems = []
for name, fn in [("wikipedia", sources.wikipedia), ("gapmap", sources.gapmap), ("erdos", sources.erdos),
                 ("opg", sources.opg), ("openalex", lambda: sources.openalex_statements(budget))]:
    if args.only and name not in args.only.split(","):
        rows = prev.get(name, [])
        status[name] = {"ok": bool(rows), "count": len(rows), "note": "kept from previous run"}
        problems += rows
        continue
    try:
        rows = fn()
        if not rows:
            raise RuntimeError("returned no rows")
        prev[name] = rows
        status[name] = {"ok": True, "count": len(rows), "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    except Exception as e:
        traceback.print_exc()
        rows = prev.get(name, [])
        status[name] = {"ok": False, "count": len(rows), "error": str(e)[:200],
                        "note": "fetch failed; showing the previous copy" if rows else "fetch failed; nothing shown from this source"}
    print(name, len(rows), flush=True)
    problems += rows

os.makedirs(os.path.dirname(STORE), exist_ok=True)
json.dump(prev, open(STORE, "w"), ensure_ascii=False)

token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
if args.skip_measure:
    cache = activity.load()
else:
    cache = activity.measure_all(problems, budget, token, t0 + args.minutes * 60)

# ---------------------------------------------------------------- scoring
def lg(x):
    return math.log1p(max(0, x or 0))

for p in problems:
    sig = {}
    e = cache.get((p.get("query") or "").lower(), {}) if p.get("query") else {}
    for k in ("papers", "repos", "hn"):
        if k in e:
            sig[k] = {kk: e[k][kk] for kk in ("n", "items", "via", "t") if kk in e[k]}
    p["signals"] = sig
    if p["source"] == "gapmap":
        g = p["gapmap"]
        p["activity"] = lg(g["nResources"]) * 1.4 + lg(len(g["capabilities"])) * 0.8
        p["measured"] = "Gap Map's own list of capabilities and resources"
    elif p["source"] == "openalex":
        p["activity"] = lg(p["paper"]["citedBy"]) * 1.2
        p["measured"] = "Citations of the paper that stated it (OpenAlex)"
    elif sig.get("papers") or sig.get("repos") or sig.get("hn"):
        p["activity"] = lg(sig.get("papers", {}).get("n")) * 1.0 + lg(sig.get("repos", {}).get("n")) * 0.6 + lg(sig.get("hn", {}).get("n")) * 0.5
        p["measured"] = "Mentions in the last 24 months: " + ", ".join(
            x for x in [sig.get("papers", {}).get("via") and f"papers ({sig['papers']['via']})", "repos" in sig and "GitHub repos", "hn" in sig and "Hacker News"] if x)
    elif p["source"] == "erdos":
        er = p["erdos"]
        # repo-derived attention only: formalisation, OEIS links, recency of last status update
        recent = 0
        try:
            recent = max(0, 1 - (time.time() - time.mktime(time.strptime(er["lastUpdate"], "%Y-%m-%d"))) / (400 * 86400))
        except Exception:
            pass
        p["activity"] = (0.7 if er["formalized"] else 0) + 0.25 * len(er["oeis"]) + 1.2 * recent
        p["measured"] = "Community database only: formalisation, OEIS links, last status update"
    else:
        p["activity"] = None
        p["measured"] = None

# neglect = 1 - percentile of activity within each source (sources measure differently)
from collections import defaultdict
by = defaultdict(list)
for p in problems:
    if p["activity"] is not None:
        by[p["source"]].append(p)
for src, ps in by.items():
    ps.sort(key=lambda p: p["activity"])
    n = len(ps)
    for i, p in enumerate(ps):
        # ties share the lowest rank so all-zero problems are equally neglected
        p["neglect"] = None
    vals = [p["activity"] for p in ps]
    import bisect
    for p in ps:
        rank = bisect.bisect_left(vals, p["activity"])
        p["neglect"] = round(1 - rank / max(1, n - 1), 3) if n > 1 else 0.5
for p in problems:
    p.setdefault("neglect", None)
    if p.get("activity") is not None:
        p["activity"] = round(p["activity"], 3)

# ---------------------------------------------------------------- write
meta = {
    "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "count": len(problems),
    "measured": sum(1 for p in problems if p["neglect"] is not None),
    "sources": status,
    "openalexCreditsUsed": args.openalex_credits - budget.left,
    "windowDays": activity.WINDOW_DAYS,
}
os.makedirs(OUT, exist_ok=True)
json.dump({"meta": meta, "families": sources.FAMILIES, "problems": problems}, open(os.path.join(OUT, "problems.json"), "w"),
          ensure_ascii=False, separators=(",", ":"))
print(json.dumps(meta, indent=1))
