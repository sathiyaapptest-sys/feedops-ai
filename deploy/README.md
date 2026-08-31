# Deploying FeedOps AI

## Web service (Cloud Run) -- start here

The root `Dockerfile` is a two-stage build: it compiles the React frontend
first (`frontend/dist`), then packages it alongside the FastAPI backend
(`backend/server/app.py`) into one Cloud Run service -- `app.py` mounts
`frontend/dist` as static files after every `/api/*` route, so one URL
serves both the UI and the API. Built and run-tested locally with real
Docker: the image builds clean, serves `/docs`, every API route, and the
compiled React app (`/`, static assets), degrades gracefully with no
credentials mounted (returns a clear JSON error instead of crashing), and
shuts down cleanly on SIGTERM in under a second.

**The frontend stage needs your real Firebase Web SDK config as Docker
build args** (Vite bakes `VITE_*` vars into the JS at build time, so they
can't be set as ordinary Cloud Run runtime env vars afterward -- that would
have no effect on the already-built bundle). Because `gcloud run deploy
--source` doesn't expose `--build-arg`, this needs the two-step Cloud
Build path instead of the one-liner:

```bash
export PROJECT_ID=your-gcp-project
export REGION=us-central1
export IMAGE=gcr.io/$PROJECT_ID/feedops-ai-backend

# Step 1: build the image via Cloud Build, passing your Firebase project's
# real Web SDK config (console.firebase.google.com -> Project settings ->
# General -> Your apps -> Web app -> SDK setup and configuration).
gcloud builds submit --config=deploy/cloudbuild.web.yaml \
  --substitutions=_IMAGE=$IMAGE,\
_VITE_FIREBASE_API_KEY=your-value,\
_VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com,\
_VITE_FIREBASE_PROJECT_ID=your-project,\
_VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com,\
_VITE_FIREBASE_MESSAGING_SENDER_ID=your-value,\
_VITE_FIREBASE_APP_ID=your-value

# Step 2: deploy that image.
gcloud run deploy feedops-ai-backend \
  --image=$IMAGE \
  --region=$REGION \
  --allow-unauthenticated \
  --service-account=feedops-run@$PROJECT_ID.iam.gserviceaccount.com \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest" \
  --set-env-vars="ENVIRONMENT=sandbox"
```

These are Firebase's own client-side Web SDK values, not secrets -- they
identify the project rather than authorize access (real security is
Firebase Security Rules + API key restrictions in the GCP console), so
they're fine to pass as plain build substitutions rather than Secret
Manager entries.

The service account needs `roles/datastore.user` (Firestore reads/writes via
Application Default Credentials -- no key file needed, same pattern as
everywhere else in this codebase) and, once you're ready, whatever
permissions the Places/Conversion API keys require:

```bash
gcloud iam service-accounts create feedops-run
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:feedops-run@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

`--allow-unauthenticated` makes the service reachable at its Cloud Run URL
without a Google-managed auth layer in front -- the app's own sensitive
routes still require a Firebase ID token via `get_current_user`, so this
doesn't expose merchant-write operations, only makes the service network-
reachable at all (needed for a judge to actually open the URL).

**Proof of running on Google Cloud** (the hackathon's explicit requirement):
after deploying, `gcloud run services logs read feedops-ai-backend
--region=$REGION` and the Cloud Run console page for the service are your
evidence -- screenshot or link both in the submission.

## Firestore merchant data + playbook RAG index

Merchant records live in Firestore (`backend/db/firestore_client.py`,
collection `merchants`). Seed it from the golden dataset:

```bash
python -m fixtures.seed_firestore
```

The SchemaAuditorAgent and the "Ask FeedOps" support endpoint
(`POST /api/support/ask`) ground themselves in the real
[GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md](../GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md)
instead of a hardcoded prompt summary, via `backend/rag/playbook_index.py`.
There's no separate index-build step and no Firestore vector index to
provision: the Dockerfile already `COPY`s the playbook into the image, and
the first `retrieve_playbook_context` call in each process chunks and embeds
it into a plain in-memory list, then ranks by cosine similarity in Python.
Nothing to run ahead of time -- just make sure the file exists wherever the
process runs (it does, in the deployed container) and `GEMINI_API_KEY` is
set.

# Scheduled jobs: Cloud Run Jobs + Cloud Scheduler

Two recurring jobs `backend/jobs/scheduled_tasks.py` implements, per
[GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md](../GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md)
sections 6-7:

- **Daily feed push** (`--job daily`) - regenerate + upload the entity/action/service
  feed bundle, guarding against merchants Google's Places data marks closed.
- **Weekly conversion sweep** (`--job weekly`) - POST the sandbox/production test
  tokens so the "3 events / 7 days" conversion-tracking check never lapses.

Both exit non-zero on failure, so Cloud Run Job execution failures surface in
Cloud Monitoring / Cloud Scheduler's own failure notifications without extra
wiring.

**One job per cadence covers both environments, automatically.** Omit
`--environment` (pass `--org-id` instead, or set `FEEDOPS_ORG_ID`) and each
run always does sandbox, then checks that org's Sandbox-to-Production Review
status in Firestore and also runs production if it's approved -- no second
`*-production` job/trigger to create by hand once review passes, and nothing
touches production before it's actually approved. Pass `--environment`
explicitly only to force a single environment (e.g. for a manual test run).

## One-time setup

```bash
export PROJECT_ID=your-gcp-project
export REGION=us-central1
export REPO=feedops-ai

gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION

# Jobs use a separate Dockerfile (deploy/Dockerfile.jobs) from the web
# service's root Dockerfile, so this builds via the small Cloud Build config
# that points at it rather than the default `gcloud builds submit --tag`
# (which only ever looks at ./Dockerfile).
gcloud builds submit \
  --config=deploy/cloudbuild.jobs.yaml \
  --substitutions=_IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/scheduled-tasks:latest \
  .
```

Put secrets (`GEMINI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_SFTP_KEY_PATH`
contents, per-environment `GOOGLE_SFTP_USERNAME_SANDBOX` /
`GOOGLE_SFTP_USERNAME_PRODUCTION`) in Secret Manager rather than plain env vars:

```bash
gcloud secrets create gemini-api-key --data-file=- <<< "$GEMINI_API_KEY"
gcloud secrets create google-sftp-key --data-file=~/.ssh/google_actions_center
```

## Create the two Cloud Run Jobs

```bash
export FEEDOPS_ORG_ID=your-org-id   # the Firebase uid of the aggregator account

gcloud run jobs create feedops-daily-push \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/scheduled-tasks:latest \
  --region=$REGION \
  --args="--job=daily,--org-id=$FEEDOPS_ORG_ID" \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest,GOOGLE_SFTP_KEY_PATH=google-sftp-key:latest" \
  --max-retries=2 \
  --task-timeout=600

gcloud run jobs create feedops-weekly-sweep \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/scheduled-tasks:latest \
  --region=$REGION \
  --args="--job=weekly,--org-id=$FEEDOPS_ORG_ID" \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest" \
  --max-retries=2 \
  --task-timeout=300
```

Both always push/sweep sandbox. Once Sandbox-to-Production Review is
approved for `$FEEDOPS_ORG_ID` (self-attested on the Dashboard, or via the
Portal-screenshot suggestion), the same two jobs pick up production
automatically on their next scheduled run -- nothing to redeploy.

## Create the two Cloud Scheduler triggers

Cloud Scheduler calls the Cloud Run Jobs Admin API to start an execution,
authenticating as a service account with the `roles/run.invoker` role on the job:

```bash
export SA=feedops-scheduler@$PROJECT_ID.iam.gserviceaccount.com
gcloud iam service-accounts create feedops-scheduler
gcloud run jobs add-iam-policy-binding feedops-daily-push \
  --region=$REGION --member="serviceAccount:$SA" --role="roles/run.invoker"
gcloud run jobs add-iam-policy-binding feedops-weekly-sweep \
  --region=$REGION --member="serviceAccount:$SA" --role="roles/run.invoker"

gcloud scheduler jobs create http feedops-daily-push-trigger \
  --location=$REGION \
  --schedule="0 9 * * *" \
  --uri="https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT_ID/jobs/feedops-daily-push:run" \
  --http-method=POST \
  --oauth-service-account-email=$SA

gcloud scheduler jobs create http feedops-weekly-sweep-trigger \
  --location=$REGION \
  --schedule="0 9 * * 1" \
  --uri="https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT_ID/jobs/feedops-weekly-sweep:run" \
  --http-method=POST \
  --oauth-service-account-email=$SA
```

`0 9 * * *` = daily at 9:00 AM in the scheduler's configured timezone;
`0 9 * * 1` = every Monday at 9:00 AM. Both comfortably clear Google's "3
events / 7 days" and daily-cadence requirements with room for a retry.

## Required config for the weekly sweep

`conversion_sentry.py` now posts to Google's real conversion endpoints and
requires two env vars before it'll do anything but raise a clear error:

- `GOOGLE_CONVERSION_PARTNER_ID` -- the numeric Partner/Aggregator ID from
  Partner Portal -> Account and Users -> Account tab. **Not** your SFTP
  username -- sending that instead is the single most common mistake here
  (playbook section 7).
- `GOOGLE_SANDBOX_TEST_TOKENS` -- comma-separated, the 3 real sandbox test
  tokens Google gives you per test merchant in the portal's own
  conversion-tracking setup instructions. Defaults to placeholder values that
  will correctly get rejected until you set this.

## Remaining known gap

The daily push only compiles entity + action feeds (the required pair per
the playbook -- "it's fine to ship those two first and add service later").
The service feed needs per-merchant lead_time / opening hours / delivery-area
data that doesn't exist in the current intake; that's queued as part of the
onboarding-intake work, not fixed here.
