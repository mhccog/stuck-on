# stuck-on data files

Both files are rebuilt daily by `.github/workflows/rebuild.yml` and served by GitHub Pages.

| File | URL | Use |
| --- | --- | --- |
| `docs/data/atlas.json` | https://mhccog.github.io/stuck-on/data/atlas.json | **Stable export for other sites** (schema `stuck-on/atlas@1`, below) |
| `docs/data/problems.json` | https://mhccog.github.io/stuck-on/data/problems.json | Full data the page itself renders (adds the "who's working" item lists); may change shape |

Raw repo paths: `https://raw.githubusercontent.com/mhccog/stuck-on/main/docs/data/atlas.json`.

## `atlas.json` (schema `stuck-on/atlas@1`)

```jsonc
{
  "schema": "stuck-on/atlas@1",
  "generated": "2026-10-28T01:40:00Z",        // UTC
  "windowDays": 730,                            // activity window
  "families": ["Mathematics", ...],             // the 10 field families
  "sources": { "wikipedia": { "ok": true, "count": 796, "fetched": "...", "error"?: "...", "note"?: "..." }, ... },
  "count": 2765,
  "problems": [{
    "id": "16701e3642d0",                       // stable: hash of source + source key
    "title": "Novikov conjecture",
    "statement": "...",                         // string or null
    "field": "Mathematics",                     // one of families
    "subfield": "Algebraic topology",           // string or null (section heading / tag / OpenAlex subfield)
    "source": "wikipedia",                      // wikipedia | opg | erdos | gapmap | openalex
    "sourceName": "Wikipedia · List of unsolved problems in mathematics",
    "sourceUrl": "https://...",                 // where it was written down (Wikipedia links pin the revision)
    "articleUrl": "https://..." ,               // or null
    "statedIn": null | { "paperTitle", "date", "venue", "countries": ["GB","US"], "citedBy": 3 },  // openalex only
    "location": null,                           // no source provides coordinates; use statedIn.countries
    "confidence": "Listed as unsolved on Wikipedia; ...",   // how sure we are it is still open
    "searchedAs": "Novikov conjecture",         // exact phrase used for activity search, or null
    "activity": null | {
      "papers": { "count": 12, "via": "arXiv" | "Europe PMC" | "OpenAlex", "checkedAt": "ISO UTC" },
      "repos":  { "count": 3, "checkedAt": "..." },   // GitHub repos pushed in window mentioning it
      "hn":     { "count": 0, "checkedAt": "..." }    // Hacker News stories + comments in window
    },
    "activityScore": 2.41,                      // log-weighted signal sum, comparable only within a source; null = unmeasured
    "neglect": 0.93,                            // 0 busy .. 1 neglected; mid-rank percentile within its source; null = unmeasured
    "busierShare": 0.88,                        // share of same-source problems with strictly more activity
    "measuredBy": "Mentions in the last 24 months: ...",
    "url": "https://mhccog.github.io/stuck-on/#p=16701e3642d0"   // deep link
  }]
}
```

Licences: problem text keeps its source's licence (Wikipedia CC BY-SA 4.0, Open Problem Garden GNU FDL,
Erdős database Apache-2.0, Gap Map MIT, OpenAlex CC0). Keep `sourceUrl` attribution when reusing.
