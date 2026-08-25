# FeedOps AI — Progress & Reference

Internal engineering reference tracking what's been built, verified, and left
open. Not the hackathon-facing README (that's still to be written) — this is
for picking the project back up quickly, in this session or a future one.

**Hackathon**: [All Things Agentic](https://allthingsagentichackathon.devpost.com)
— category **Taskmaster**, deadline **Aug 31, 2026 5pm PT**. Judged on
Innovation & Operational Utility (40%), Architectural Discipline & Tech Stack
(30%), Demo & Production Readiness (30%). Mandatory tech: Gemini 3.5+, a
Google agent framework (using ADK), a GCP infra service (using Firestore +
Cloud Run).

## What FeedOps AI is

Automates the operational grind of Google Actions Center's Ordering Redirect
integration (see [GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md](GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md)
for the full domain spec this project targets): merchant entity matching
against Google Places, Actions Center feed compilation, SFTP upload, and
conversion-tracking health checks — normally a manual, error-prone daily
grind for restaurant aggregators.

## Architecture (all real, all verified — not a mockup)

- **4 Google ADK agents** (`backend/agent/orchestrator.py`): EntityMatcher
  (judges Places match confidence, grounds ambiguous ones via Google Search),
  SchemaAuditor (compiles + audits feeds, grounded in the real playbook via
  RAG), ConversionSentry (dispatches + interprets conversion pings),
  Support (the "Ask FeedOps" surface). Each runs through a real
  `google.adk.runners.Runner`, with deterministic Python fallback if the
  agent call fails — verified live with a real Gemini key.
- **Firestore** (`backend/db/firestore_client.py`): `MerchantRepository`,
  `OrganizationRepository`, `UploadBatchRepository`. System of record for
  merchant status, org config/adapters, and upload history.
- **RAG** (`backend/rag/playbook_index.py`): chunks the playbook by section,
  embeds with Gemini, holds vectors in an in-process cache (built from the
  Docker-bundled file on first use, no Firestore vector index needed).
  Grounds SchemaAuditor and the Support agent.
- **Scheduled jobs** (`backend/jobs/scheduled_tasks.py`): daily feed push
  (closed-merchant guard + compile + SFTP upload) and weekly conversion
  sweep, deployable as Cloud Run Jobs on Cloud Scheduler crons
  (`deploy/README.md`).
- **Data adapters** (`backend/tools/data_adapter.py`): per-organization
  column-mapping, saved and reused, with structured per-row validation
  errors instead of silent guessing.
- **Frontend**: React/Vite, wired to the real backend for onboarding (live
  SSE agent stream) and Ask FeedOps. Firebase Auth-gated.

## Commit-by-commit history (see `git log` for full messages)

1. `fbff6fb` — initial scaffold (inherited, largely non-functional at start)
2. `e905d63` — replaced a fabricated `google.antigravity` import with real
   Google ADK; fixed 3 broken cross-module call signatures
3. `8631037` — wired all 3 agents through real ADK Runners (previously only
   1 of 3 actually called Gemini)
4. `d8e1140` — daily feed push + weekly conversion sweep as Cloud Run Jobs
5. `1d4dccc` — Firestore merchant persistence + playbook RAG grounding
6. `95b9f88` — fixed conversion tracking (real Google endpoints, was
   posting to placeholder URLs) and feed compiler (real Actions Center
   proto shape, was emitting schema.org JSON-LD)
7. `46a2cdc` — organization onboarding intake + per-org data adapters
8. `e75e4ec` — upload batch history + human-only Portal verification loop
   (no automated Google Console calls — none exist to make)
9. `82f95a6` — Cloud Run web service deployment (Dockerfile split from jobs)
10. `3f22608` — wired frontend to the real backend (live onboarding pipeline,
    Ask FeedOps)
11. `83faff1` — fixed `GEMINI_MODEL` default (`gemini-flash-latest` alias
    was timing out; `gemini-3.6-flash` works reliably)

## Known gaps (honest, not hidden)

- **`BulkUpload.tsx` swallows validation errors.** The backend correctly
  returns per-row errors from the data-adapter validation; the component
  only shows a success count. Found during testing, not yet fixed.
- **`Menu.tsx`'s XLSX-upload path expects the wrong response shape** from
  `/api/upload/spreadsheet` (expects `.menu`/`.sections`, actual shape is
  `{merchants, menus}`) — pre-existing, not introduced this session.
- **No architecture diagram, no demo video** — still outstanding.
- Onboarding is now split across three pages by pipeline stage: Onboard
  Store runs EntityMatcher only (name/phone/email/address, keyed by the
  signed-in user's email); My Store collects hours/lead-time/service-types
  into the same `merchants/{email}` record; Services runs the real
  SchemaAuditor + ConversionSentry via `/api/merchants/audit` and displays
  the actual compiled entity/action/service feed JSON, persisted so
  revisiting the page shows the last real run. The old fake
  `AgentStreamViewer` / `/api/agent/stream` canned stream is gone.
- RAG retrieval no longer depends on a Firestore vector index at all — see
  the RAG bullet above; this was fixed after the earlier Firestore SDK
  rewrite left `playbook_index.py` on the one remaining broken code path
  (`.collection()` calls against a client that no longer supports them).

## Environment notes for next time

- **Gemini model**: use `gemini-3.6-flash` explicitly, not the
  `gemini-flash-latest` alias (confirmed unreliable — 504s). Google's own
  API told us this when `gemini-2.5-flash` 404'd as deprecated.
- **Free tier rate limits are real** — running several agent calls back to
  back (e.g. rapid manual testing) will trip per-minute quota. Not a bug;
  space out calls or expect occasional graceful fallback under quota.
- **`.env` holds `GEMINI_API_KEY`** (gitignored, never committed) — belongs to
  the **"Gemini Project - FeedOps 2"** AI Studio project
  (`gen-lang-client-0171944630`), confirmed genuine **Free tier: no billing
  account attached, so it cannot be charged** — exceeding quota just returns
  429s, never a bill. There is a second, separate project, **"Gemini Project
  - FeedOps AI"** (`gen-lang-client-0724450224`), which *is* billing-linked
  (Tier 1, pay-as-you-go once quota's free allowance is exceeded) but sits
  unused and currently non-responding, pending Google's "administrator must
  verify this account" step in Cloud Console → Billing → Account management.
  That project's billing account ("My Billing Account", `01DC66-D1B783-155448`)
  holds a ₹28,693.88 Free Trial credit valid until **21 Nov 2026** — covers
  standard GCP infra (Cloud Run, Firestore, Cloud Build, Logging, Firebase
  RTDB) but explicitly **excludes Gemini API costs** (Google's own free-trial
  terms). None of this is live yet since nothing's deployed to Cloud Run —
  it only becomes relevant if/when deployment happens under the FeedOps AI
  project. **Do not switch `.env` to the FeedOps AI key without first setting
  a Gemini API spend cap** (Tier 1 default ceiling is ~$250/₹20-21k) and
  resolving the account verification.
- No `gcloud` CLI, no GCP credentials, no running Docker daemon by default
  in a fresh sandboxed session — Docker Desktop can be started with
  `open -a Docker` and works once up (verified this session); `gcloud`
  deploys need to be run by the account holder.
- Dev servers: backend `python run.py` (port 8000, needs `.venv` +
  `.env` sourced); frontend via `.claude/launch.json`'s `frontend` config
  (port 5173) or `npm --prefix frontend run dev`.

## Next steps (in the order agreed)

1. ~~Deploy prep~~ ✓ / ~~Frontend wiring~~ ✓ / **current: confirm the flow is
   fully stable** (fix or accept the two known frontend gaps above)
2. README + architecture diagram
3. Demo video (max 4 min per Devpost rules)
4. Push to a real remote, grant repo access to `testing@devpost.com` and
   `cloudhackathons@google.com`
