FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/
COPY fixtures/ fixtures/
COPY GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md .

# Cloud Run injects PORT (defaults to 8080 outside Cloud Run too, for local
# `docker run` parity). Shell form so ${PORT} actually expands; --reload is a
# dev-only flag and deliberately absent here.
ENV PORT=8080
EXPOSE 8080
CMD exec uvicorn backend.server.app:app --host 0.0.0.0 --port ${PORT}
