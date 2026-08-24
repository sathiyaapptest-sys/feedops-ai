# FeedOps AI

**Autonomous operations for Google Actions Center's Ordering Redirect integration** — built for the [All Things Agentic Hackathon](https://allthingsagentichackathon.devpost.com) (category: **Taskmaster**).

Restaurant aggregators and merchants who want an "Order Online" button on Google Search/Maps have to run a genuinely painful integration: match every merchant against Google Places, compile three separate feed files to an exact undocumented proto shape, deliver them by SFTP every single day forever, keep a weekly conversion-tracking heartbeat alive, and manually babysit a review process with no API for "did Google actually accept what I sent." FeedOps AI turns that into a multi-agent system that does the matching, the compiling, the health-tracking, and the human-in-the-loop recovery — while being explicit about the handful of steps that are structurally manual because Google exposes no API for them at all.

## What it does

- **Merchant onboarding**, single or bulk (CSV/Excel), with a real Google Places match, an ADK agent judging match confidence, and a human triage queue for anything ambiguous.
- **Feed compilation** to Google's real `madden.ingestion` proto shape (entity, action, and — for merchants with real lead-time and hours on file — service feeds), packaged and SFTP-uploaded per the platform's exact naming/ordering rules.
- **A closed-merchant guard** that checks Google's own Places data before every push, so a feed never includes a location Google itself has already marked closed.
- **Conversion-tracking upkeep**, dispatching the sandbox/production pings Google requires at least every 7 days to keep the integration from being silently de-indexed.
- **Feed Health**, a day-by-day view of push history with an "Upload Now" button for immediate recovery and a self-report verification loop — because Google's Partner Portal is the only place that shows whether a feed was actually *accepted*, not just delivered, and there's no API for that.
- **Ask FeedOps**, a support surface grounded via RAG in the team's own reverse-engineered domain playbook, answering integration questions with cited sources instead of a generic LLM guess.
- **Self-service merchant profiles**, with per-organization data adapters that remember a returning aggregator's spreadsheet column shape instead of re-guessing it every upload.

## Architecture

*(Diagram in progress — see [Known gaps](#known-gaps-and-honest-limitations))*

- **4 Google ADK agents** (`backend/agent/orchestrator.py`), each running through a real `google.adk.runners.Runner` against Gemini, with a deterministic Python fallback if the agent call fails:
  - **EntityMatcher** — judges Google Places match confidence, grounds ambiguous cases via Google Search.
  - **SchemaAuditor** — compiles and audits a merchant's feed, grounded in the real integration playbook via RAG.
  - **ConversionSentry** — dispatches and interprets conversion-tracking pings.
  - **Support** — the "Ask FeedOps" surface.
- **Firestore** (`backend/db/firestore_client.py`) — system of record for merchant status, organization config, and upload batch history. No ORM; thin repositories over plain documents.
- **RAG** (`backend/rag/playbook_index.py`) — chunks the internal domain playbook by section, embeds with Gemini, retrieves via Firestore's native vector search. Grounds the SchemaAuditor agent and Ask FeedOps. The raw playbook document itself is intentionally excluded from this repository (see below) — only its already-built vector index is queried at runtime.
- **An MCP server** (`backend/tools/mcp_server.py`) — exposes 8 of the same backend tools (Places search, storefront verification, feed compilation, SFTP upload, conversion pings, menu/spreadsheet extraction) over the real Model Context Protocol via stdio transport, independent of the FastAPI app, so any MCP-compatible client can drive the same tool surface.
- **Scheduled jobs** (`backend/jobs/scheduled_tasks.py`) — daily feed push (closed-merchant guard → compile → upload) and weekly conversion sweep, designed as Cloud Run Jobs on Cloud Scheduler crons.
- **Data adapters** (`backend/tools/data_adapter.py`) — per-organization column-mapping for bulk uploads, saved and reused, with structured per-row validation errors instead of silent guessing.
- **Frontend** — React/Vite, Firebase Auth-gated, wired to the real backend (live SSE onboarding stream, Feed Health, Ask FeedOps, self-service merchant profile).

## Why the playbook isn't in this repo

`GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md` — the reverse-engineered domain spec this project's RAG grounding and feed compiler are built against — is real, hard-won competitive-advantage content, not scaffolding. It's excluded from version control entirely: kept on the maintainers' local disk and indexed into Firestore, never pushed to a repo any collaborator would see. This does **not** affect how the app runs — the RAG pipeline only reads the raw file at index-build time (`fixtures/seed_playbook_index.py`); every runtime query (SchemaAuditor, Ask FeedOps) goes through the already-built Firestore vector index, never the file itself. The code implementing that pipeline — chunking, embedding, retrieval, citation — is fully present and reviewable in `backend/rag/`.

## Tech stack

| Layer | Technology |
|---|---|
| LLM | Gemini 3.6 Flash / 3.7 Flash (`google-genai`) |
| Agent framework | Google ADK (`google-adk`) — 4 agents, real `Runner` execution |
| Tool protocol | MCP (`mcp[cli]`) — a standalone server alongside the ADK agents |
| Database | Firestore (Firebase Admin SDK) — merchant records, org config, upload history, RAG vector index |
| Compute | Cloud Run (web service + scheduled jobs), Cloud Build, Cloud Scheduler |
| Backend | FastAPI, Python 3.11 |
| Frontend | React 18, Vite, TypeScript, Tailwind, Firebase Auth + client SDK |
| Feed delivery | SFTP (`paramiko`) — Google's Partner Upload endpoint, no HTTPS alternative exists |
| Spreadsheet ingestion | `pandas` / `openpyxl` |

## Project structure

```
backend/
  agent/         ADK agents + orchestration (orchestrator.py)
  db/            Firestore repositories (merchants, orgs, upload batches)
  rag/           Playbook chunking/embedding/retrieval
  jobs/          Scheduled daily push + weekly conversion sweep
  tools/         Places matching, feed compiler, SFTP, conversion pings,
                 menu/spreadsheet extraction, data adapters, MCP server
  server/        FastAPI app + routes, Firebase Auth dependency
frontend/
  src/components/Aggregator/   Readiness scorecard, triage queue, bulk upload, feed health
  src/components/Merchant/     Self-service store profile, menu, services
  src/components/Customer/     Public storefront view
deploy/          Dockerfile.jobs, Cloud Build config, deployment instructions
fixtures/        One-time Firestore/RAG seeding scripts
```

## Getting started

### Prerequisites

- Python 3.11+, Node 18+
- A [Gemini API key](https://aistudio.google.com/apikey) (free tier works for development)
- A [Firebase project](https://console.firebase.google.com) with **Authentication (Email/Password)** and **Firestore** enabled — required for any auth-gated feature (onboarding, self-service profile save, triage actions). Without this, the frontend runs against dummy fallback config and every sign-in attempt fails.

### Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in GEMINI_API_KEY at minimum
python run.py           # serves on http://localhost:8000, /docs for the API
```

Optional env vars for features that degrade gracefully without them (mock/dry-run fallback, never a crash): `GOOGLE_PLACES_API_KEY`, `GOOGLE_SFTP_USERNAME` / `GOOGLE_SFTP_KEY_PATH`, `GOOGLE_CONVERSION_PARTNER_ID`, `GEMINI_MODEL` (defaults to `gemini-3.6-flash` — the `gemini-flash-latest` alias is unreliable in practice).

To ground SchemaAuditor / Ask FeedOps in real RAG output, build the Firestore vector index once (needs a Firestore vector index created first — see [deploy/README.md](deploy/README.md)):

```bash
python -m fixtures.seed_playbook_index
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env    # fill in your Firebase project's Web SDK config
npm run dev              # serves on http://localhost:5173
```

### MCP server (optional, standalone)

```bash
python -m backend.tools.mcp_server
```
Runs over stdio — connect it from any MCP-compatible client (e.g. Claude Desktop's MCP config) to drive Places search, feed compilation, SFTP upload, and conversion pings as MCP tools independent of the web app.

### Deploying to Cloud Run

See [deploy/README.md](deploy/README.md) for the full `gcloud run deploy` commands, service account IAM setup, and the Firestore vector index creation command. Requires your own authenticated `gcloud` session — nothing in this repo can create GCP infrastructure on its own.

## Known gaps and honest limitations

- **`BulkUpload.tsx`** now persists valid rows and surfaces validation errors, but doesn't yet expose an organization selector in the UI — bulk uploads without an explicit `org_id` fall into a shared `unknown` bucket.
- **`Menu.tsx`'s XLSX-upload path** expects a different response shape than `/api/upload/spreadsheet` actually returns (pre-existing).
- **The Services page's live agent stream is canned** — the onboarding page's stream is real; this one was deliberately left out of scope.
- **No architecture diagram yet** — in progress.
- **No demo video yet** — in progress.
- **A real Firebase project was never wired up during development** — see [Getting started](#getting-started); the frontend has been running on dummy fallback config, so sign-in has not been exercised against a real Firebase Auth backend until deployment.
- Several manual, human-only steps exist because **Google exposes no API for them**, not because we didn't automate them: Partner Portal setup, launch review, and confirming a feed was actually *accepted* (a clean SFTP upload only proves delivery). FeedOps AI tracks these as explicit self-report states (see Feed Health) rather than pretending to check them automatically.

## Project timeline

Started **2026-08-23**. The initial scaffold was inherited and largely non-functional (a fabricated `google.antigravity` import, only 1 of 3 agents actually calling Gemini, feeds shaped as generic JSON-LD instead of Google's real proto, conversion pings posting to placeholder URLs). Every subsequent commit replaced a specific piece of that with a real, verified implementation — see the commit history for the section-by-section account.

## License / disclosures

Built on an inherited starter scaffold (see Project timeline above) — the multi-agent orchestration, Firestore persistence, RAG grounding, feed compilation logic, MCP server wiring, scheduled jobs, and frontend integration were built and verified during the hackathon submission period. No other third-party code beyond the dependencies listed in `requirements.txt` / `frontend/package.json`.
