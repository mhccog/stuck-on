# Everything we're stuck on

A calm, slowly turning sky of humanity's open problems, gathered automatically from
where they are written down. Problems that nobody is visibly working on glow softly;
busy ones are small and steady.

**Live:** https://mhccog.github.io/stuck-on/

Pillar 4 of "The foundation: five ways to connect the world": *which problems have no attempts at all?*

## Where the problems come from

| Source | What we take | Licence / terms |
| --- | --- | --- |
| Wikipedia "List of unsolved problems in …" (13 lists) | Each list item under an unsolved section, with its heading and link | CC BY-SA 4.0; text shown with a link to the exact revision |
| Open Problem Garden | Unsolved-problem tables per category: title, who posed it, importance stars. Crawled at its robots.txt crawl delay (10 s) | GNU FDL |
| Erdős problems database (teorth/erdosproblems) | Problems whose status is open (or falsifiable / verifiable / decidable), tags, prize, Lean and OEIS links | Apache-2.0 |
| Convergent Research Gap Map | R&D gaps, their foundational capabilities and the resources listed against them | MIT |
| OpenAlex | Sentences in recent (last 300 days) abstracts saying something "remains an open question", "remains poorly understood"… quoted and linked to the paper | CC0 metadata |

**Skipped:** the UIA Encyclopedia of World Problems. Its public API sits behind a bot checkpoint and
UIA's data-extraction terms forbid re-packaging and redistribution, so it is not used.

## How "quiet" is measured

For problems with a short searchable name we count public signs of work over the last 24 months:

* papers: arXiv API (maths, computing, physics), Europe PMC (life, health, chemistry, earth), OpenAlex (everything else, within the free keyless budget)
* GitHub repositories pushed in that window whose name, description or README mention it
* Hacker News stories and comments mentioning it (Algolia API)

Brightness is the percentile **within each source**, because sources measure differently:
Gap Map gaps use Gap Map's own capability/resource lists, paper statements use the paper's
citations, and Erdős problems without a common name use only the community database
(formalisation, OEIS links, recency of status updates). Problems without a short name are drawn
as rings: not measured.

## For other sites (merging)

* **Data:** `docs/data/atlas.json` → https://mhccog.github.io/stuck-on/data/atlas.json, schema `stuck-on/atlas@1`,
  documented in [`docs/data/SCHEMA.md`](docs/data/SCHEMA.md). Renderer-independent; ids and fields are stable.
* **Renderer:** `docs/js/sky.js` exposes `StuckSky.create(canvas, problems, opts)`; the page UI lives in
  `docs/app.js` and only talks to the renderer through that object.
* **Pipeline:** `scripts/sources.py` (fetchers), `scripts/activity.py` (signals), `scripts/build.py` (scoring + export).

## Rebuilding

```
pip install beautifulsoup4 pyyaml
GITHUB_TOKEN=... python scripts/build.py --minutes 40 --openalex-credits 300
```

`.github/workflows/rebuild.yml` runs daily, refreshes stale signals (each is refreshed at most
every three weeks) and commits `docs/data/problems.json`. It uses only keyless public APIs plus the
workflow's own `GITHUB_TOKEN` for GitHub search. OpenAlex use is capped well under the free
keyless daily budget; nothing here can incur a charge.

## Honest limits

* "Open" is only as good as the list it came from; some problems may already be solved.
* Name matching is literal, English only.
* Public work only: no contact details, no messaging, no tracking.

Code: MIT. Problem text keeps the licence of its source (see table).
