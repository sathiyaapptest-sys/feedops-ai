"""
FeedOps AI - Conversion Sentry

Dispatches synthetic rwg_token conversion pings against Google's real
Actions Center conversion-tracking endpoints (GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md
section 7), not placeholders. Diagnoses failures by HTTP status code per the
playbook's own table -- that's the fast path Google's docs recommend before
touching application code.
"""

import os
import json
import httpx
import time
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta, timezone

SANDBOX_URL = "https://www.google.com/maps/conversion/debug/collect"
PRODUCTION_URL = "https://www.google.com/maps/conversion/collect"

STATUS_DIAGNOSIS = {
    200: "Accepted -- counts toward the portal's 3 events / 7 days check.",
    500: "Wrong/unresolvable partner id -- almost always the SFTP username used by mistake instead of the numeric Aggregator ID.",
    400: "A numeric-looking but unrecognized partner id.",
}


class ConversionSentryTool:
    def __init__(self):
        # Real sandbox test tokens come from Partner Portal -> conversion-tracking setup
        # (one per test merchant) -- these are placeholders until you configure the real
        # ones via GOOGLE_SANDBOX_TEST_TOKENS (comma-separated).
        env_tokens = os.getenv("GOOGLE_SANDBOX_TEST_TOKENS")
        self.sandbox_tokens = env_tokens.split(",") if env_tokens else [
            "rwg_token_test_1", "rwg_token_test_2", "rwg_token_test_3",
        ]
        self.health_log: Dict[str, List[Dict[str, Any]]] = {}

    async def dispatch_conversion_ping(
        self, environment: str = "sandbox", tokens: Optional[List[str]] = None, merchant_changed: int = 2,
        partner_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Dispatches synthetic conversion POST requests and records response code, latency,
        and a rolling 7-day health log.

        `tokens` overrides the default token set -- pass the real captured rwg_token(s)
        for production (there's no fixed "prod test token"; production conversions come
        from real customer clicks, so this only makes sense to call there with an actual
        token you captured). Defaults to the configured sandbox test tokens for sandbox.

        `partner_id` overrides the GOOGLE_CONVERSION_PARTNER_ID env var -- lets a caller
        (the aggregator dashboard's Conversion Tracking panel) use the numeric Partner ID
        an aggregator saved in their own org config (API & Webhooks) instead of requiring
        a server-wide environment variable, since a real deployment may serve more than
        one aggregator org with different Partner IDs.
        """
        url = PRODUCTION_URL if environment == "production" else SANDBOX_URL
        tokens = tokens if tokens is not None else (self.sandbox_tokens if environment == "sandbox" else [])
        if not tokens:
            raise ValueError(
                f"No conversion tokens to dispatch for environment '{environment}'. "
                "Production has no fixed test token -- pass the real captured rwg_token(s)."
            )

        partner_id = partner_id or os.getenv("GOOGLE_CONVERSION_PARTNER_ID")
        if not partner_id:
            raise ValueError(
                "GOOGLE_CONVERSION_PARTNER_ID is not set. This is the numeric Partner/Aggregator "
                "ID from Partner Portal -> Account and Users -> Account tab -- NOT the SFTP "
                "username (sending the wrong one is the most common mistake here, per the playbook)."
            )

        results = []
        async with httpx.AsyncClient() as client:
            for token in tokens:
                start_time = time.time()
                # Google's endpoint takes a text/plain body, not application/json --
                # httpx's json= kwarg sets the wrong content type, so encode manually.
                body = json.dumps({
                    "conversion_partner_id": partner_id,
                    "rwg_token": token,
                    "merchant_changed": merchant_changed,
                })

                try:
                    response = await client.post(
                        url, content=body, headers={"Content-Type": "text/plain"}, timeout=10.0
                    )
                    status_code = response.status_code
                    success = status_code == 200
                    error = None
                except httpx.RequestError as e:
                    # A real network/connection failure. Never fake a 200 here -- an
                    # unreachable endpoint means the check has NOT passed, and reporting
                    # otherwise would silently hide a real integration break.
                    status_code = None
                    success = False
                    error = str(e)

                latency = (time.time() - start_time) * 1000  # ms

                results.append({
                    "token": token,
                    "status_code": status_code,
                    "success": success,
                    "latency_ms": round(latency, 2),
                    "diagnosis": STATUS_DIAGNOSIS.get(status_code, error or "Unexpected status code."),
                })

        self._record_health(environment, results)
        self._cleanup_old_logs()

        return {
            "environment": environment,
            "results": results,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _record_health(self, environment: str, results: List[Dict[str, Any]]):
        today = datetime.now(timezone.utc).date().isoformat()
        self.health_log.setdefault(today, []).append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "environment": environment,
            "results": results,
        })

    def _cleanup_old_logs(self):
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
        for key in [date for date in self.health_log if date < cutoff_date]:
            del self.health_log[key]

    def get_health_log(self) -> Dict[str, List[Dict[str, Any]]]:
        return self.health_log
