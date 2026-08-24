# Persistence, RAG, and scheduled jobs

## Firestore merchant data + playbook RAG index

Merchant records live in Firestore (`backend/db/firestore_client.py`,
collection `merchants`). Seed it from the golden dataset:

```bash
python -m fixtures.seed_firestore
```

The SchemaAuditorAgent and the "Ask FeedOps" support endpoint
(`POST /api/support/ask`) ground themselves in the real
[GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md](../GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md)
via Firestore vector search (`backend/rag/playbook_index.py`, collection
`playbook_chunks`) instead of a hardcoded prompt summary. Build that index
once, and again whenever the playbook doc changes:

```bash
python -m fixtures.seed_playbook_index
```

**Before that will actually retrieve anything**, create the vector index
`find_nearest()` needs on the `embedding` field -- without it, retrieval
fails with `FailedPrecondition` (the error message includes a direct link to
create it, or run this ahead of time):

```bash
gcloud firestore indexes composite create \
  --collection-group=playbook_chunks \
  --query-scope=COLLECTION \
  --field-config=vector-config='{"dimension":"768","flat":"{}"}',field-path=embedding
```

(768 matches `GEMINI_EMBEDDING_DIMENSION`'s default in `playbook_index.py` --
keep them in sync if you change one.)

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

## One-time setup

```bash
export PROJECT_ID=your-gcp-project
export REGION=us-central1
export REPO=feedops-ai

gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION

# Build and push the image (from the repo root, where the Dockerfile lives)
gcloud builds submit --tag $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/scheduled-tasks:latest .
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
gcloud run jobs create feedops-daily-push \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/scheduled-tasks:latest \
  --region=$REGION \
  --args="--job=daily,--environment=sandbox" \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest,GOOGLE_SFTP_KEY_PATH=google-sftp-key:latest" \
  --max-retries=2 \
  --task-timeout=600

gcloud run jobs create feedops-weekly-sweep \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/scheduled-tasks:latest \
  --region=$REGION \
  --args="--job=weekly,--environment=sandbox" \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest" \
  --max-retries=2 \
  --task-timeout=300
```

Once Launch Review passes production (playbook section 9), create matching
`*-production` jobs with `--environment=production` and the production SFTP
username/key -- don't just flip the existing sandbox jobs, run both cadences
in both environments per the playbook.

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

## Known gap this doesn't fix

`backend/tools/conversion_sentry.py` still points at placeholder
`https://example.com/api/conversion/...` URLs, not Google's real
`https://www.google.com/maps/conversion/{debug/}collect` endpoints -- the
weekly sweep will run on schedule but won't actually satisfy Google's check
until that's fixed. Same for `feed_compiler.py`'s feed shape (schema.org
JSON-LD instead of the real Actions Center proto format) -- the daily push
will upload feeds, but Google's validator will reject them until that's fixed.
Both are tracked as separate, not-yet-picked follow-up work.
