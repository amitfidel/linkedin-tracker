# Project Handoff — CyberTracker

Quick-start context for a new Claude Code session or collaborator.

## What this is

A Next.js 16 dashboard that tracks cybersecurity companies on LinkedIn and Gartner Peer Insights. Scrapes weekly, stores in Turso SQLite, generates an AI weekly brief via Gemini.

## Read first

- `CLAUDE.md` → points at `AGENTS.md`
- `AGENTS.md` → warns this is Next.js 16 with breaking changes; read `node_modules/next/dist/docs/` for new APIs
- `README.md` → user-facing overview
- This file (`HANDOFF.md`) → recent context

## Architecture at a glance

```
┌──────────────────┐     ┌───────────────────────┐     ┌──────────────────┐
│ GitHub Actions   │ Mon │ Railway (Next.js app) │     │ Turso libSQL DB  │
│ weekly-scrape.yml│────▶│ /api/scrape/cron      │────▶│ (production)     │
│ (Mon 2:00 UTC)   │     │ → runPipeline()       │     │                  │
└──────────────────┘     │ → Apify actors ──────▶│     │                  │
                         │ → Gemini API          │     │                  │
                         │ → Gartner (SKIPS on   │     │                  │
                         │   Railway — no Chrome)│     │                  │
                         └───────────────────────┘     └──────────────────┘
                                                              ▲
┌──────────────────┐     ┌───────────────────────┐            │
│ Windows Task Sch.│ Mon │ Local Chrome via      │            │
│ run-gartner-     │ 10am│ Playwright            │────────────┘
│ scheduled.bat    │local│ scripts/run-gartner-  │  push via
└──────────────────┘     │ local.ts              │  /api/scrape/
                         │ → scrapes Gartner     │  gartner-push
                         └───────────────────────┘
```

**Key insight:** Playwright can't run on Railway (no Chrome installed). Gartner scraping runs locally, results pushed to Railway via `POST /api/scrape/gartner-push`. The LinkedIn scrape runs on Railway via Apify.

## Current state (as of last commit)

### What works
- Weekly LinkedIn scrape: Monday 2am UTC via GitHub Actions → Railway
- Weekly Gartner scrape: Monday 10am local via Windows Task Scheduler → local → push to Railway
- Dashboard shows company cards with posts, jobs, Gartner 2 likes + 2 dislikes
- AI weekly brief (Gemini) with Customer Intelligence section for recent Gartner insights only
- Error badge in header: shows step failures from latest run, clickable, dismissable
- Parallel Apify calls (3 concurrent) for the jobs step

### Known limitations
- Gartner requires local Chrome — Railway instance skips Gartner steps via `RAILWAY_ENVIRONMENT` check
- Agrint (farming company) has no Gartner URL and discovery returns a wrong match
- URL discovery (`discoverGartnerUrl`) only works in headful mode — DDG shows CAPTCHA in headless
- No observability beyond console logs; no Sentry/external error tracking
- Settings UI shows cron expression but actual schedule lives in `.github/workflows/weekly-scrape.yml`

## Environment / secrets

### Local `.env` (already on this machine)
- `APIFY_API_TOKEN` — for LinkedIn scraping actors
- `DATABASE_URL` — Turso libSQL prod DB
- `DATABASE_AUTH_TOKEN` — Turso auth
- `GEMINI_API_KEY` — for AI summary

### Railway env vars (Railway dashboard → Variables)
- All of the above
- `SCRAPE_CRON_SECRET` — shared secret for GitHub Actions auth
- `RAILWAY_ENVIRONMENT` — auto-set by Railway, used to skip Playwright

### GitHub repo secrets (github.com/amitfidel/linkedin-tracker/settings/secrets/actions)
- `RAILWAY_APP_URL` = `https://linkedin-tracker-production-4f02.up.railway.app`
- `SCRAPE_CRON_SECRET` — same value as on Railway

## Key files

| Path | Purpose |
|------|---------|
| `src/lib/pipeline/orchestrator.ts` | `runPipeline()` — 5-step LinkedIn scrape + Gartner; `runGartnerOnly()` |
| `src/lib/apify/scraper.ts` | Apify actor wrappers; `scrapeJobs` parallelized via `runPool` |
| `src/lib/gartner/scraper.ts` | Playwright-based Gartner scraper; fetch fallback (usually 403) |
| `src/lib/analysis/ai-summarizer.ts` | Gemini prompt + weekly digest generation |
| `src/lib/utils/pool.ts` | Bounded-concurrency helper used by scrapeJobs and local Gartner script |
| `src/app/api/scrape/route.ts` | Manual trigger (POST) |
| `src/app/api/scrape/cron/route.ts` | GitHub Actions trigger (Bearer auth) |
| `src/app/api/scrape/gartner-push/route.ts` | Local Gartner results ingestion |
| `src/app/api/scrape/[id]/acknowledge/route.ts` | Dismiss error badge |
| `src/components/layout/header.tsx` | Run Scrape button + error badge |
| `src/components/layout/error-badge.tsx` | Error badge + dialog |
| `scripts/run-gartner-local.ts` | Local Gartner scrape + push to Railway |
| `scripts/run-gartner-scheduled.bat` | Wrapper for Windows Task Scheduler |
| `.github/workflows/weekly-scrape.yml` | Monday 2am UTC trigger |
| `src/db/schema.ts` | Drizzle schema (9 tables) |

## Recent changes (last 10 commits, most recent first)

1. **Error visibility + parallel Apify + Railway scheduler** — three-in-one improvement
2. **Fix Gartner likes-dislike panel extraction** — Sepio was missing dislikes
3. **Fix Railway env vars + reduce stuck-run cleanup to 15min** — previous pipelines hung on Playwright
4. **Skip Playwright entirely on Railway** via `RAILWAY_ENVIRONMENT` check
5. **Add 10s browser launch timeout** — prevented runaway hangs
6. **Add Windows Task Scheduler for weekly Gartner** — Monday 10am local
7. **Show 2 likes + 2 dislikes; weekly-only AI Gartner** — matches UI display
8. **Replace ScraperAPI with Playwright** — no paid proxy needed
9. **30-day posts on cards; fix stuck running runs**
10. **Switch Gartner URL discovery from Gartner search to DuckDuckGo HTML**

## Common tasks

### Run LinkedIn + Gartner scrape manually
Click "Run Scrape" in the dashboard header (Railway + local hybrid — LinkedIn runs on Railway, Gartner won't update without the local script).

### Run Gartner scrape locally (populates Gartner data)
```bash
cd "C:/Users/amitf/Documents/Projects/personal progects/LinkedIn scraper/linkedin-tracker"
npx tsx scripts/run-gartner-local.ts
```

### Check latest scrape status
```bash
curl -s https://linkedin-tracker-production-4f02.up.railway.app/api/scrape/status | head -c 500
```

### Test the cron endpoint (simulates GitHub Actions)
```bash
curl -X POST https://linkedin-tracker-production-4f02.up.railway.app/api/scrape/cron \
  -H "Authorization: Bearer $SCRAPE_CRON_SECRET"
```

### Apply a new Drizzle migration
```bash
npx drizzle-kit generate
# Then manually apply to Turso via a one-off script (see git history for pattern)
```

### Check scheduled Windows task
```powershell
schtasks /query /tn "CyberTracker-GartnerScrape" /v /fo list
```

## Deployment

- **Railway:** auto-deploys on every push to `main`. ~1-2 min.
- **GitHub Actions:** workflow file is on `main`; new scheduled runs pick up changes automatically.

## What to work on next (user-prioritized list of known improvements)

These were identified in a previous audit but not yet implemented:
1. Add Anthropic/Claude as fallback when Gemini fails
2. Add DB indexes on `linkedinPostId`, `status`, `textHash` (single-column)
3. Dedupe the 100+ lines of Gartner logic between `runPipeline` and `runGartnerOnly`
4. Validate LinkedIn URLs in the Add Company form
5. Add Sentry or similar for error tracking
6. N+1 query in digest generation (`digest-generator.ts:79-94`)

## Tracked companies

Currently: `armis`, `claroty`, `sepio`, `agrint` (the last one is the farm-tech outlier — no Gartner coverage).

## Contact / ownership

Repo: https://github.com/amitfidel/linkedin-tracker
Production: https://linkedin-tracker-production-4f02.up.railway.app
