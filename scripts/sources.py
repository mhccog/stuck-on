"""Gather open problems from public sources that allow reuse.

Every record keeps a link back to where it was written down, plus the licence
of that source. Nothing here is invented: when a source fails, it is recorded
in the status file and the page says so.
"""
import json, os, re, time, hashlib, html as htmlmod
import urllib.parse, urllib.request
from bs4 import BeautifulSoup
import yaml

UA = "stuck-on-atlas/0.1 (+https://github.com/mhccog/stuck-on; open-data prototype)"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "cache", "raw")
os.makedirs(RAW, exist_ok=True)


def get(url, headers=None, cache_hours=None, timeout=60):
    """HTTP GET with an optional on-disk cache (raw cache is not committed)."""
    key = hashlib.sha1(url.encode()).hexdigest()
    path = os.path.join(RAW, key)
    if cache_hours and os.path.exists(path) and time.time() - os.path.getmtime(path) < cache_hours * 3600:
        return open(path, "rb").read().decode("utf-8", "replace")
    h = {"User-Agent": UA}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    if cache_hours:
        open(path, "wb").write(body)
    return body.decode("utf-8", "replace")


def pid(*parts):
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:12]


def clean(t):
    t = re.sub(r"\[\s*(\d+|[a-z]|citation needed|note \d+)\s*\]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\(\s+", "(", t)
    t = re.sub(r"\s+([),.;:?])", r"\1", t)
    return t


# ---------------------------------------------------------------- families
FAMILIES = [
    "Mathematics", "Computing & information", "Physics & the cosmos",
    "Life", "Health & medicine", "Chemistry & materials", "Earth & climate",
    "Society & economics", "Mind & philosophy", "Engineering & energy",
]


def family_for(text):
    t = (text or "").lower()
    rules = [
        ("Mathematics", ["mathemat", "number theory", "combinator", "geometry", "algebra", "analysis", "topology", "graph theory", "group theory", "logic", "probability", "pdes", "fair division", "loop theory"]),
        ("Computing & information", ["computer", "computing", "information", "theoretical_computer", "artificial intelligence", "ai ", "software", "cryptograph", "statistic", "data"]),
        ("Physics & the cosmos", ["physic", "astronom", "cosmo", "quantum", "space", "particle"]),
        ("Health & medicine", ["medic", "health", "disease", "clinical", "immun", "pharma", "nursing", "dentist"]),
        ("Mind & philosophy", ["neuro", "philosoph", "psycholog", "cognit", "conscious", "linguist"]),
        ("Life", ["biolog", "genetic", "ecolog", "evolution", "agricultur", "veterinar", "life science", "biochem"]),
        ("Chemistry & materials", ["chemi", "material"]),
        ("Earth & climate", ["geo", "earth", "climate", "environment", "planetary", "ocean"]),
        ("Society & economics", ["econom", "social", "business", "decision", "politic", "law", "governance", "education", "arts", "humanit", "finance", "sociolog"]),
        ("Engineering & energy", ["engineer", "energy", "manufactur", "robot", "electron", "semiconductor", "infrastructure", "transport"]),
    ]
    for fam, keys in rules:
        if any(k in t for k in keys):
            return fam
    return None


# ---------------------------------------------------------------- Wikipedia
WP_LISTS = [
    ("astronomy", "Physics & the cosmos"), ("biology", "Life"), ("chemistry", "Chemistry & materials"),
    ("geoscience", "Earth & climate"), ("neuroscience", "Mind & philosophy"), ("physics", "Physics & the cosmos"),
    ("mathematics", "Mathematics"), ("economics", "Society & economics"), ("fair division", "Mathematics"),
    ("statistics", "Computing & information"), ("computer science", "Computing & information"),
    ("information theory", "Computing & information"), ("medicine", "Health & medicine"),
]
SKIP_HEAD = re.compile(r"(?<!un)solved|resolved|see also|references|^notes|further reading|external links|bibliography|^sources|disproved|(?<!dis)proved|notable lists|mathematical lists|notebooks|^lists|books", re.I)


def _math_text(el):
    for m in el.select(".mwe-math-element"):
        alt = ""
        mt = m.find("math")
        if mt and mt.get("alttext"):
            alt = mt["alttext"].replace("{\\displaystyle", "").strip()
            alt = re.sub(r"^\{?|\}$", "", alt).strip()
        m.replace_with(alt)
    for s in el.select("sup.reference, .mw-editsection, style, .noprint"):
        s.decompose()


def wikipedia():
    out = []
    for topic, fam in WP_LISTS:
        page = "List of unsolved problems in " + topic
        url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
            {"action": "parse", "page": page, "prop": "text|revid", "format": "json", "formatversion": 2, "redirects": 1})
        d = json.loads(get(url, cache_hours=20))
        if "parse" not in d:
            continue
        revid = d["parse"].get("revid")
        page = d["parse"].get("title") or page
        soup = BeautifulSoup(d["parse"]["text"], "html.parser")
        body = soup.select_one(".mw-parser-output") or soup
        heads = []
        skipping = False
        for el in body.find_all(["h2", "h3", "h4", "li"]):
            if el.name in ("h2", "h3", "h4"):
                lvl = int(el.name[1])
                txt = clean(el.get_text(" "))
                heads = [h for h in heads if h[0] < lvl] + [(lvl, txt)]
                skipping = any(SKIP_HEAD.search(h[1]) for h in heads)
                continue
            if skipping or not heads:
                continue
            if el.find_parent(["table", "nav"]) or el.find_parent(class_=re.compile("navbox|reflist|toc|references|sidebar|hatnote|thumb|gallery")):
                continue
            if el.find_parent("li"):
                continue  # nested sub-item; keep the parent only
            li = BeautifulSoup(str(el), "html.parser").li
            for sub in li.find_all(["ul", "ol", "dl"]):
                sub.decompose()
            _math_text(li)
            text = clean(li.get_text(" "))
            text = re.sub(r"\s+([,.;:?)])", r"\1", text).replace("( ", "(")
            if len(text) < 6 or re.search(r"[{}\\]|displaystyle", text):
                continue
            name, link = None, None
            b = li.find("b")
            first_a = li.find("a", href=re.compile(r"^/wiki/[^:]+$"))
            if b and text.startswith(clean(b.get_text(" "))[:10]):
                name = clean(b.get_text(" ")).rstrip(".:")
                a = b.find("a", href=re.compile(r"^/wiki/"))
                link = a["href"] if a else None
            elif first_a:
                at = clean(first_a.get_text(" "))
                lead = re.sub(r"^(The|A|An)\s+", "", text)
                if lead.lower().startswith(at.lower()) and len(at) > 3:
                    name = at
                    link = first_a["href"]
            if text.endswith(":"):
                continue
            if not name:
                for a in li.find_all("a", href=re.compile(r"^/wiki/[^:]+$")):
                    at = clean(a.get_text(" "))
                    if re.search(r"(conjecture|problem|hypothesis|constant|numbers|paradox|theorem|question)s?$", at, re.I) and len(at) <= 70:
                        qname = at
                        break
                else:
                    qname = None
            else:
                qname = None
            if name:
                name = name.strip()
            title = name or (text if len(text) <= 160 else text[:157].rsplit(" ", 1)[0] + "…")
            if title.lower() in ("main article", "see also"):
                continue
            sub = heads[-1][1] if heads else topic
            out.append({
                "id": pid("wp", topic, title),
                "title": title[:200],
                "statement": text[:600],
                "query": (name if name and 4 <= len(name) <= 70 and not name.endswith("?") else None) or qname,
                "family": fam,
                "subfield": sub[:80],
                "source": "wikipedia",
                "sourceName": "Wikipedia · " + page,
                "sourceUrl": "https://en.wikipedia.org/wiki/" + page.replace(" ", "_") + (f"?oldid={revid}" if revid else ""),
                "articleUrl": ("https://en.wikipedia.org" + link) if link else None,
                "confidence": "Listed as unsolved on Wikipedia; list editors may lag the literature.",
            })
    # de-duplicate titles within the same list
    seen, uniq = set(), []
    for r in out:
        if r["id"] in seen:
            continue
        seen.add(r["id"]); uniq.append(r)
    return uniq


# ---------------------------------------------------------------- Gap Map (MIT)
def gapmap():
    d = json.loads(get("https://www.gap-map.org/data/gapmap-data.json", cache_hours=20))
    caps = {c["id"]: c for c in d["capabilities"]}
    res = {r["id"]: r for r in d["resources"]}
    out = []
    for g in d["gaps"]:
        fname = (g.get("field") or {}).get("name", "")
        fam = family_for(fname) or "Engineering & energy"
        attempts, people = [], []
        for cid in g.get("foundationalCapabilities", []):
            c = caps.get(cid)
            if not c:
                continue
            attempts.append({"title": c["name"], "url": f"https://www.gap-map.org/capabilities/{c['slug']}/" if c.get("slug") else None})
            for rid in c.get("resources", [])[:6]:
                r = res.get(rid)
                if r and r.get("url"):
                    people.append({"name": r["title"], "url": r["url"], "kind": ", ".join(r.get("types") or []) or "Resource"})
        # de-dup resources
        seen, ppl = set(), []
        for p in people:
            if p["url"] in seen:
                continue
            seen.add(p["url"]); ppl.append(p)
        out.append({
            "id": pid("gap", g["id"]),
            "title": g["name"],
            "statement": clean(g.get("description") or "")[:700],
            "query": None,
            "family": fam,
            "subfield": fname,
            "source": "gapmap",
            "sourceName": "Convergent Research · Gap Map",
            "sourceUrl": f"https://www.gap-map.org/gaps/{g['slug']}/",
            "confidence": "A curated R&D gap (export " + d["metadata"].get("exportDate", "")[:10] + ").",
            "gapmap": {"capabilities": attempts, "resources": ppl[:12], "nResources": len(ppl)},
        })
    return out


# ---------------------------------------------------------------- Erdős problems (Apache-2.0)
OPEN_STATES = {"open", "falsifiable", "verifiable", "decidable", "not provable", "not disprovable"}


def erdos():
    y = yaml.safe_load(get("https://raw.githubusercontent.com/teorth/erdosproblems/main/data/problems.yaml", cache_hours=20))
    out = []
    for p in y:
        st = ((p.get("status") or {}).get("state") or "").strip()
        if st not in OPEN_STATES:
            continue
        n = str(p["number"])
        tags = p.get("tags") or []
        comment = (p.get("comments") or "").strip() if isinstance(p.get("comments"), str) else ""
        name = comment if comment and len(comment) < 60 else None
        title = f"Erdős problem #{n}" + (f" · {name}" if name else "")
        out.append({
            "id": pid("erdos", n),
            "title": title,
            "statement": ("Tags: " + ", ".join(tags) + ". ") if tags else "",
            "query": name if name and re.search(r"(conjecture|problem|theorem|numbers|primes|sets?)$", name, re.I) else None,
            "family": "Mathematics",
            "subfield": (tags[0] if tags else "Erdős problems").capitalize(),
            "source": "erdos",
            "sourceName": "Erdős problems database (teorth/erdosproblems)",
            "sourceUrl": f"https://www.erdosproblems.com/{n}",
            "confidence": f"Status '{st}' in the community database, last updated {(p.get('status') or {}).get('last_update', 'unknown')}. erdosproblems.com no longer displays statuses itself.",
            "erdos": {
                "number": n, "state": st, "prize": p.get("prize"), "tags": tags,
                "lastUpdate": (p.get("status") or {}).get("last_update"),
                "formalized": ((p.get("formalized") or {}).get("state") == "yes"),
                "leanUrl": f"https://github.com/google-deepmind/formal-conjectures/blob/main/FormalConjectures/ErdosProblems/{n}.lean" if (p.get("formalized") or {}).get("state") == "yes" else None,
                "oeis": [o for o in (p.get("oeis") or []) if re.match(r"^A\d+$", str(o))],
            },
        })
    return out


# ---------------------------------------------------------------- Open Problem Garden (GFDL)
OPG_CATS = ["algebra", "analysis", "combinatorics", "geometry", "graph_theory", "group_theory", "logic",
            "number_theory_0", "pdes", "probability", "theoretical_computer_science", "topology"]


OPG_SPAM = re.compile(r"cheat|generator|v-bucks|\bapk\b|\bhack|no survey|verification|free!|\b20[2-3]\d\b|coins|gems|diamonds|unlimited|dragon ball|guide|^hello$", re.I)


def opg(delay=10):
    out = []
    base = "https://www.openproblemgarden.org"
    for cat in OPG_CATS:
        page = 0
        while page < 15:
            url = f"{base}/category/{cat}" + (f"?page={page}" if page else "") if cat != "topology" else f"{base}/topology" + (f"?page={page}" if page else "")
            cached = os.path.exists(os.path.join(RAW, hashlib.sha1(url.encode()).hexdigest()))
            try:
                h = get(url, cache_hours=24 * 6)
            except Exception as e:
                print("opg fail", url, e)
                break
            if not cached:
                time.sleep(delay)  # robots.txt Crawl-Delay: 10
            s = BeautifulSoup(h, "html.parser")
            rows = s.select("table tbody tr")
            for tr in rows:
                a = tr.select_one("td.view-field-node-title a")
                if not a:
                    continue
                authors = [clean(x.get_text()) for x in tr.select("td.view-field-node-data-field-last-names-field-last-names-value a")]
                stars = clean((tr.select_one("td.view-field-node-data-field-stars1-field-stars1-value") or BeautifulSoup("", "html.parser")).get_text()).count("✭")
                title = clean(a.get_text())
                authors = [x for x in authors if x]
                # the wiki has spam pages (game "cheat generators") filed under Algebra: real problems name who posed them
                if not authors or OPG_SPAM.search(title):
                    continue
                fam = "Computing & information" if cat == "theoretical_computer_science" else "Mathematics"
                out.append({
                    "id": pid("opg", a["href"]),
                    "title": title,
                    "statement": ("Posed by " + ", ".join(authors) + ". ") if authors else "",
                    "query": title if 5 <= len(title) <= 70 else None,
                    "family": fam,
                    "subfield": cat.replace("_0", "").replace("_", " ").capitalize(),
                    "source": "opg",
                    "sourceName": "Open Problem Garden",
                    "sourceUrl": base + a["href"],
                    "confidence": "Listed among unsolved problems on Open Problem Garden; the wiki is lightly maintained.",
                    "opg": {"authors": authors, "importance": stars},
                })
            if not s.select_one("a.pager-next, .pager-next a"):
                break
            page += 1
    seen, uniq = set(), []
    for r in out:
        if r["id"] in seen:
            continue
        seen.add(r["id"]); uniq.append(r)
    return uniq


# ---------------------------------------------------------------- OpenAlex statements (CC0 metadata)
OA_PHRASES = ["remains an open question", "remains an open problem", "remains poorly understood",
              "remains unknown whether", "remain unresolved", "is still poorly understood"]


def _abstract(inv):
    if not inv:
        return ""
    pos = {}
    for w, ps in inv.items():
        for p in ps:
            pos[p] = w
    return " ".join(pos[i] for i in sorted(pos))


def openalex_statements(budget):
    """Each OpenAlex search costs 10 credits; keyless budget is 1,000/day per IP. We use <= 6 here."""
    out = []
    since = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 300 * 86400))
    for ph in OA_PHRASES:
        if not budget.take(10):
            break
        url = "https://api.openalex.org/works?" + urllib.parse.urlencode({
            "filter": f'title_and_abstract.search:"{ph}",from_publication_date:{since},type:article|preprint,has_abstract:true',
            "per_page": 100, "sort": "cited_by_count:desc",
            "select": "id,doi,title,publication_date,abstract_inverted_index,primary_topic,authorships,cited_by_count,primary_location",
        })
        try:
            d = json.loads(get(url, cache_hours=20))
        except Exception as e:
            print("openalex fail", ph, e)
            continue
        for w in d.get("results", []):
            ab = _abstract(w.get("abstract_inverted_index"))
            sents = re.split(r"(?<=[.!?])\s+(?=[A-Z])", ab)
            hit = next((s for s in sents if ph.split()[0] in s.lower() and ph.split()[-1] in s.lower()), None)
            if not hit or len(hit) < 40 or len(hit) > 420:
                continue
            pt = w.get("primary_topic") or {}
            fam = (family_for((pt.get("field") or {}).get("display_name", "")) or family_for((pt.get("subfield") or {}).get("display_name", ""))
                   or family_for((pt.get("domain") or {}).get("display_name", "")) or "Society & economics")
            countries = sorted({c for a in w.get("authorships", []) for c in (a.get("countries") or [])})
            authors = [{"name": a["author"]["display_name"], "url": a["author"]["id"]}
                       for a in w.get("authorships", [])[:6] if (a.get("author") or {}).get("display_name") and (a.get("author") or {}).get("id")]
            venue = (((w.get("primary_location") or {}).get("source")) or {}).get("display_name")
            out.append({
                "id": pid("oa", w["id"]),
                "title": re.sub(r"^(Abstract|Background|Summary)\s*[:.]?\s+", "", clean(hit)),
                "statement": clean(hit),
                "query": None,
                "family": fam,
                "subfield": (pt.get("subfield") or {}).get("display_name") or (pt.get("field") or {}).get("display_name") or "",
                "source": "openalex",
                "sourceName": "Stated in a recent paper (via OpenAlex)",
                "sourceUrl": w.get("doi") or w["id"],
                "confidence": f"The authors described this as open in {w.get('publication_date', '')[:7]}.",
                "paper": {"title": clean(w.get("title") or ""), "date": w.get("publication_date"), "venue": venue,
                          "countries": countries, "authors": authors, "citedBy": w.get("cited_by_count", 0),
                          "openalex": w["id"], "phrase": ph},
            })
    seen, uniq = set(), []
    for r in out:
        if r["id"] in seen:
            continue
        seen.add(r["id"]); uniq.append(r)
    return uniq
