# --- Stage 1: build the frontend static bundle ---
# Vite bakes VITE_* env vars into the JS at build time, not runtime, so
# Firebase config has to arrive as build args here -- setting them as Cloud
# Run env vars on the running container would have no effect on the already
# -built bundle. Pass them via `--build-arg` (see deploy/README.md).
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

RUN npm run build

# --- Stage 2: the actual Cloud Run service ---
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/
COPY fixtures/ fixtures/
COPY GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md .

# backend/server/app.py mounts frontend/dist as static files (when present)
# after every /api/* route, so the API and the UI are served from one
# Cloud Run service at one URL -- no separate hosting needed.
COPY --from=frontend-build /app/frontend/dist frontend/dist

# Cloud Run injects PORT (defaults to 8080 outside Cloud Run too, for local
# `docker run` parity). Shell form so ${PORT} actually expands; --reload is a
# dev-only flag and deliberately absent here.
ENV PORT=8080
EXPOSE 8080
CMD exec uvicorn backend.server.app:app --host 0.0.0.0 --port ${PORT}
