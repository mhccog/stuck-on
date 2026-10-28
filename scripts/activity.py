"""Live activity signals: who is visibly working on a problem right now.

Signals (all over the last 24 months, all public):
  papers  - arXiv (maths, computing, physics), Europe PMC (life, health, chemistry, earth)
            or OpenAlex (society, mind, everything else, within the free keyless budget)
  repos   - GitHub repositories pushed recently whose name/description/readme mention it
  hn      - Hacker News stories and comments mentioning it (Algolia API)
Results are cached in data-cache/activity.json so each run only refreshes stale entries.
"""
import json, os, re, time, urllib.parse, urllib.request, xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data-cache", "activity.json")
UA = "stuck-on-atlas/0.1 (+https://github.com/mhccog/stuck-on)"
WINDOW_DAYS = 730
MAX_AGE = 21 * 86400  # refresh each signal at most every 3 weeks


class Budget:
    """OpenAlex keyless credits we allow ourselves per run (searches cost 10)."""
    def __init__(self, credits):
        self.left = credits
    def take(self, n):
        if self.left >= n:
            self.left -= n
            return True
        return False


def load():
    try:
        return json.load(open(CACHE))
    except Exception:
        return {}


def save(c):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    tmp = CACHE + ".tmp"
    json.dump(c, open(tmp, "w"), separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, CACHE)


def _get(url, headers=None, timeout=60):
    h = {"User-Agent": UA}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.read().decode("utf-8", "replace"), dict(r.headers)


def since_ts():
    return int(time.time()) - WINDOW_DAYS * 86400


def arxiv(q):
    a = time.strftime("%Y%m%d0000", time.gmtime(since_ts()))
    b = time.strftime("%Y%m%d2359", time.gmtime())
    phrase = q.replace('"', "")
    sq = f'(abs:"{phrase}" OR ti:"{phrase}") AND submittedDate:[{a} TO {b}]'
    url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode({"search_query": sq, "max_results": 3, "sortBy": "submittedDate", "sortOrder": "descending"})
    body, _ = _get(url, timeout=90)
    ns = {"a": "http://www.w3.org/2005/Atom", "o": "http://a9.com/-/spec/opensearch/1.1/"}
    root = ET.fromstring(body)
    total = int(root.find("o:totalResults", ns).text)
    items = []
    for e in root.findall("a:entry", ns):
        items.append({"title": re.sub(r"\s+", " ", e.find("a:title", ns).text or "").strip(),
                      "url": e.find("a:id", ns).text.replace("http://", "https://"),
                      "date": (e.find("a:published", ns).text or "")[:10],
                      "who": [x.find("a:name", ns).text for x in e.findall("a:author", ns)][:4]})
    return {"n": total, "items": items, "via": "arXiv"}


def europepmc(q):
    a = time.strftime("%Y-%m-%d", time.gmtime(since_ts()))
    b = time.strftime("%Y-%m-%d", time.gmtime())
    p = q.replace('"', "")
    query = f'(TITLE:"{p}" OR ABSTRACT:"{p}") AND FIRST_PDATE:[{a} TO {b}]'
    url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" + urllib.parse.urlencode({"query": query, "format": "json", "pageSize": 3, "resultType": "lite", "sort": "P_PDATE_D desc"})
    d = json.loads(_get(url)[0])
    items = []
    for r in d.get("resultList", {}).get("result", []):
        link = f"https://doi.org/{r['doi']}" if r.get("doi") else f"https://europepmc.org/article/{r.get('source')}/{r.get('id')}"
        items.append({"title": re.sub(r"<[^>]+>", "", r.get("title", "")), "url": link, "date": r.get("firstPublicationDate", "")[:10],
                      "who": [x.strip() for x in (r.get("authorString") or "").rstrip(".").split(",")][:4]})
    return {"n": int(d.get("hitCount", 0)), "items": items, "via": "Europe PMC"}


def openalex(q, budget):
    if not budget.take(10):
        return None
    a = time.strftime("%Y-%m-%d", time.gmtime(since_ts()))
    url = "https://api.openalex.org/works?" + urllib.parse.urlencode({
        "filter": f'title_and_abstract.search:"{q.replace(chr(34), "")}",from_publication_date:{a}',
        "per_page": 3, "sort": "publication_date:desc", "select": "id,doi,title,publication_date,authorships"})
    d = json.loads(_get(url)[0])
    items = [{"title": w.get("title") or "", "url": w.get("doi") or w["id"], "date": w.get("publication_date"),
              "who": [x["author"]["display_name"] for x in w.get("authorships", [])[:4]]} for w in d.get("results", [])]
    return {"n": d["meta"]["count"], "items": items, "via": "OpenAlex"}


_gh_last = [0.0]


def github(q, token):
    # Search API: 30 requests/minute when authenticated -> space calls by 2.1 s
    wait = 2.1 - (time.time() - _gh_last[0])
    if wait > 0:
        time.sleep(wait)
    _gh_last[0] = time.time()
    since = time.strftime("%Y-%m-%d", time.gmtime(since_ts()))
    sq = f'"{q.replace(chr(34), "")}" in:name,description,readme pushed:>{since}'
    url = "https://api.github.com/search/repositories?" + urllib.parse.urlencode({"q": sq, "per_page": 3, "sort": "stars"})
    h = {"Accept": "application/vnd.github+json"}
    if token:
        h["Authorization"] = "Bearer " + token
    body, hd = _get(url, headers=h)
    d = json.loads(body)
    items = [{"title": r["full_name"], "url": r["html_url"], "stars": r["stargazers_count"], "desc": (r.get("description") or "")[:140],
              "pushed": (r.get("pushed_at") or "")[:10]} for r in d.get("items", [])]
    return {"n": d.get("total_count", 0), "items": items}


def hn(q):
    url = "https://hn.algolia.com/api/v1/search?" + urllib.parse.urlencode({"query": f'"{q.replace(chr(34), "")}"', "hitsPerPage": 3, "numericFilters": f"created_at_i>{since_ts()}", "tags": "(story,comment)"})
    d = json.loads(_get(url)[0])
    items = []
    for h in d.get("hits", []):
        t = h.get("title") or h.get("story_title") or ""
        items.append({"title": t, "url": f"https://news.ycombinator.com/item?id={h['objectID']}", "date": (h.get("created_at") or "")[:10]})
    return {"n": d.get("nbHits", 0), "items": items}


PAPER_SOURCE = {
    "Mathematics": "arxiv", "Computing & information": "arxiv", "Physics & the cosmos": "arxiv",
    "Life": "epmc", "Health & medicine": "epmc", "Chemistry & materials": "epmc", "Earth & climate": "epmc",
    "Society & economics": "openalex", "Mind & philosophy": "openalex", "Engineering & energy": "openalex",
}


def measure_all(problems, budget, token, deadline, log=print):
    """Refresh stale signals until the deadline. One worker per service, so each
    service sees at most one request at a time at its own polite pace."""
    import threading
    cache = load()
    lock = threading.Lock()
    now = time.time()
    seen, todo = set(), []
    for p in problems:
        q = p.get("query")
        if q and q.lower() not in seen:
            seen.add(q.lower()); todo.append(p)

    def stale(key, sig):
        return now - cache.get(key, {}).get(sig, {}).get("t", 0) >= MAX_AGE

    def worker(name, sig, pred, fn, pause):
        n = 0
        jobs = [p for p in todo if pred(p) and stale(p["query"].lower(), sig)]
        jobs.sort(key=lambda p: cache.get(p["query"].lower(), {}).get(sig, {}).get("t", 0))
        for p in jobs:
            if time.time() > deadline:
                break
            try:
                r = fn(p)
                if r is None:
                    break  # budget exhausted
                r["t"] = int(time.time())
                with lock:
                    cache.setdefault(p["query"].lower(), {})[sig] = r
                n += 1
                if n % 25 == 0:
                    with lock:
                        save(cache)
                    log(f"  {name}: {n}/{len(jobs)}")
            except Exception as ex:
                log(f"  {name} failed for {p['query']!r}: {str(ex)[:120]}")
                if "403" in str(ex) or "429" in str(ex) or "503" in str(ex):
                    time.sleep(30)
            time.sleep(pause)
        log(f"  {name}: done {n}/{len(jobs)}")

    fam = lambda src: (lambda p: PAPER_SOURCE.get(p["family"], "openalex") == src)
    threads = [
        threading.Thread(target=worker, args=("hn", "hn", lambda p: True, lambda p: hn(p["query"]), 0.25)),
        threading.Thread(target=worker, args=("github", "repos", lambda p: True, lambda p: github(p["query"], token), 0)),
        threading.Thread(target=worker, args=("arxiv", "papers", fam("arxiv"), lambda p: arxiv(p["query"]), 3.1)),
        threading.Thread(target=worker, args=("europepmc", "papers", fam("epmc"), lambda p: europepmc(p["query"]), 0.3)),
        threading.Thread(target=worker, args=("openalex", "papers", fam("openalex"), lambda p: openalex(p["query"], budget), 0.2)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    save(cache)
    return cache
