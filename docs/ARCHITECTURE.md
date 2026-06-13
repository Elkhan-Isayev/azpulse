# Architecture

AzPulse is a **fully static** application: three files (`index.html`, `css/styles.css`, `js/app.js`) loaded
directly in the browser. There is no backend of our own — all data comes live from the open data portal.

## Data source

The portal at [opendata.az](https://opendata.az) is a **PortalJS** front-end over a **CKAN** backend hosted at
`https://admin.opendata.az`. CKAN exposes a JSON action API.

Two endpoints are used (both reachable from the browser because the portal returns
`Access-Control-Allow-Origin: *`):

| Purpose | Call |
|---|---|
| Discover datasets, facets, metadata | `GET /api/3/action/package_search` |
| Download a dataset's CSV | the resource `url` (302-redirects to a signed S3 object on `data-storage.opendata.az`) |

> Note: CKAN's `datastore_search` / `datastore_search_sql` endpoints are blocked (HTTP 403) by the portal's
> nginx, so AzPulse fetches the **CSV files directly** and parses them client-side instead.

## Request flow

```
Browser (GitHub Pages)
   │
   ├─ package_search (rows=0, facets) ─────────► KPIs, category chart, market signal
   │
   ├─ package_search (q / fq=groups:…) ────────► dataset explorer list
   │
   ├─ package_search (q="…məşğul…") ───────────► resolve employment dataset
   │        └─ fetch CSV ──► S3 (signed) ──────► economy demand analysis
   │
   └─ fetch CSV for an opened dataset ─────────► auto-chart + table
```

Everything runs on page load; "real-time" simply means each visit re-queries the portal.

## Modules in `js/app.js`

- **CKAN client** — `ckan(action, params)`: thin `fetch` wrapper that returns `result` or throws.
- **Overview** — `loadOverview()`: one faceted `package_search` powers all KPIs and the category chart.
- **Explorer** — `loadDatasets()` / `renderResults()`: search + category filter, sorted by last modified.
- **Dataset detail** — `openDataset()` → `renderDetail()`: fetches a CSV, parses with PapaParse, and charts it.
- **Column heuristics** — `analyzeColumns()`:
  - `isYearCol` — a column whose values are integers in 1900–2100 → used as the time axis (year-over-year).
  - `isNumericCol` / `isDateCol` — classify the remaining columns.
  - Chooses a label column (year → date → first text) and the numeric series to plot; picks **line** for time
    series, **bar** otherwise.
- **Economy analysis** — `loadEconomyInsights()` → `renderEconomy()`:
  - Resolves the employment-by-activity dataset via search, fetches its CSV.
  - Builds a `year → row` map, computes per-sector % change over the latest 5-year window, ranks sectors.
  - `openSectorDetail()` — on click, derives 5y/10y/all-time growth, share of total employment, growth &
    size ranks, momentum (last 5y vs. prior 5y), and a rule-based verdict; renders a full trend line.

## Why static?

- **Free hosting** on GitHub Pages, no servers to run or pay for.
- **Trust & transparency** — every number is computed from the live official source, in the open.
- **Zero maintenance** — there is no API key to rotate and nothing to keep running.

## Known constraints

- Depends on the portal's API staying public and CORS-enabled (it is today).
- A few datasets publish PDFs/XLS only — those show a notice instead of a chart.
- The economy panel keys on one specific dataset; if its resource id changes, the code falls back to a search
  by name.
