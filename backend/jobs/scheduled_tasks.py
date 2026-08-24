"""
FeedOps AI - Scheduled Tasks

Two standing jobs Google's Actions Center integration requires on a recurring
cadence (see GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md sections 4, 6, 7):

  1. run_daily_feed_push()      - regenerate + upload the entity/action/service
                                   feed bundle, guarding against merchants
                                   Google's own Places data marks closed.
  2. run_weekly_conversion_sweep() - POST the sandbox test tokens (or the prod
                                   token) so the "3 events / 7 days" conversion-
                                   tracking check never lapses.

Meant to run as a Cloud Run Job on a Cloud Scheduler cron trigger (see
deploy/README.md), not as a long-running server. Each function returns a
plain dict summary; the CLI entrypoint below exits non-zero on failure so
Cloud Scheduler / Cloud Run Job retries and alerts correctly.

Every daily push is recorded as an upload_batches document (see
backend.db.firestore_client.UploadBatchRepository) so there's a real history
of what was uploaded and when, and a place for a human to record the one
thing this job structurally cannot verify itself: whether Google's Partner
Portal actually shows the batch as accepted (playbook section 6 -- a clean
SFTP put only proves delivery, not acceptance, and there's no API for that
check). This module never calls the Partner Portal; it only tracks what a
human reports after checking it themselves.
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

from backend.tools.feed_compiler import ActionsCenterFeedCompiler
from backend.tools.places_matcher import resolve_entity_match
from backend.tools.sftp_uploader import GoogleSFTPClient
from backend.tools.conversion_sentry import ConversionSentryTool
from backend.db.firestore_client import (
    MerchantRepository, STATUS_MATCHED, STATUS_EXCLUDED_CLOSED, UploadBatchRepository,
)

logger = logging.getLogger("feedops.jobs")
logging.basicConfig(level=logging.INFO)

DEFAULT_SNAPSHOT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "fixtures", "golden_dataset.json"
)
EXCLUDE_LIST_PATH = os.getenv("CLOSED_MERCHANT_EXCLUDE_LIST", "feeds_output/exclude_list.txt")

# Confidence at/above which we trust a Places "closed" status enough to auto-exclude a
# merchant. Below this, resolve_entity_match's candidate may not even be the right
# business, so excluding on its businessStatus would risk dropping a merchant that's
# actually fine (playbook section 4).
CLOSED_EXCLUSION_CONFIDENCE_THRESHOLD = 0.85
CLOSED_STATUSES = {"CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"}


def _load_merchants(path: str = DEFAULT_SNAPSHOT_PATH) -> List[Dict[str, Any]]:
    """
    Loads the current merchant list to feed today. Tries Firestore (the live data
    source) first; falls back to the last known-good JSON snapshot on disk if
    Firestore is unreachable or unconfigured -- matches the playbook's own guidance
    (section 6): regenerate from live data when reachable, otherwise re-package the
    last known-good data rather than skip the day's run entirely.
    """
    try:
        merchants = MerchantRepository().list_active()
        if merchants:
            logger.info(f"Loaded {len(merchants)} active merchant(s) from Firestore.")
            return merchants
        logger.warning("Firestore returned no active merchants; falling back to JSON snapshot.")
    except Exception as e:
        logger.warning(f"Firestore unreachable ({e}); falling back to JSON snapshot.")

    return _load_from_json_snapshot(path)


def _load_from_json_snapshot(path: str = DEFAULT_SNAPSHOT_PATH) -> List[Dict[str, Any]]:
    with open(path, "r") as f:
        raw = json.load(f)["merchants"]

    merchants = []
    for m in raw:
        location = m.get("location", {})
        address = location.get("address")
        if address:
            address_str = ", ".join(
                str(v) for v in [
                    address.get("street_address"), address.get("locality"),
                    address.get("region"), address.get("postal_code"),
                ] if v
            )
        else:
            address_str = location.get("unstructured_address", "")

        merchants.append({
            "store_id": m["id"],
            "name": m["name"],
            "address": address_str,
            "telephone": m.get("telephone"),
            "action_link": m.get("action_link"),
        })
    return merchants


def _apply_closed_merchant_guard(
    merchants: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Playbook section 4: exclude merchants Google's own Places data marks closed, before
    they ever reach a feed. High-confidence closed matches are auto-excluded; low-confidence
    or no-match results are kept and just noted -- "no Google listing" is common for small
    merchants and is not itself a reason to exclude.
    """
    kept, excluded = [], []
    for merchant in merchants:
        match = None
        try:
            match = _run_sync(resolve_entity_match(merchant["name"], merchant["address"]))
        except Exception as e:
            logger.warning(f"Places lookup failed for {merchant['store_id']} ({merchant['name']}): {e}")

        status = (match or {}).get("business_status")
        confidence = (match or {}).get("confidence", 0.0)

        if status in CLOSED_STATUSES and confidence >= CLOSED_EXCLUSION_CONFIDENCE_THRESHOLD:
            excluded.append({**merchant, "exclude_reason": f"{status} (confidence {confidence:.2f})"})
        else:
            kept.append({**merchant, "match_result": match})

    _persist_guard_results(kept, excluded)
    return kept, excluded


def _persist_guard_results(kept: List[Dict[str, Any]], excluded: List[Dict[str, Any]]) -> None:
    """Best-effort: reflects the guard's decisions back to Firestore for the ops UI.
    Never lets a Firestore write failure block the actual feed push."""
    try:
        repo = MerchantRepository()
        for m in excluded:
            repo.update_status(m["store_id"], STATUS_EXCLUDED_CLOSED, extra={"exclude_reason": m["exclude_reason"]})
        for m in kept:
            match = m.get("match_result") or {}
            if match.get("place_id"):
                repo.update_status(m["store_id"], STATUS_MATCHED, extra={"place_id": match["place_id"]})
    except Exception as e:
        logger.warning(f"Could not persist closed-merchant guard results to Firestore: {e}")


def _append_exclude_list(excluded: List[Dict[str, Any]], path: str = EXCLUDE_LIST_PATH) -> None:
    if not excluded:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as f:
        for m in excluded:
            f.write(f"{m['store_id']}  # {m['name']} -- {m['exclude_reason']} ({datetime.now(timezone.utc).isoformat()})\n")


def _sftp_client_for(environment: str) -> GoogleSFTPClient:
    username_env = f"GOOGLE_SFTP_USERNAME_{environment.upper()}"
    username = os.getenv(username_env, os.getenv("GOOGLE_SFTP_USERNAME", "feedops_partner"))
    key_path = os.getenv("GOOGLE_SFTP_KEY_PATH")
    dry_run = not (key_path and os.path.exists(os.path.expanduser(key_path)))
    if dry_run:
        logger.warning(
            f"No usable key at GOOGLE_SFTP_KEY_PATH ({key_path!r}); running SFTP upload in dry-run mode."
        )
    return GoogleSFTPClient(private_key_path=key_path, username=username, dry_run=dry_run)


def run_daily_feed_push(environment: str = "sandbox", snapshot_path: str = DEFAULT_SNAPSHOT_PATH) -> Dict[str, Any]:
    """Regenerates the feed bundle from the current merchant data and uploads it."""
    logger.info(f"Starting daily feed push ({environment})...")

    merchants = _load_merchants(snapshot_path)
    kept, excluded = _apply_closed_merchant_guard(merchants)
    _append_exclude_list(excluded)

    if excluded:
        logger.info(f"Excluded {len(excluded)} closed merchant(s): {[m['store_id'] for m in excluded]}")

    compiler = ActionsCenterFeedCompiler()
    merged = []
    for m in kept:
        row = {
            "name": m["name"],
            "address": m["address"],
            "id": m["store_id"],
            "telephone": m.get("telephone"),
            "action_link": m.get("action_link"),
        }
        match = m.get("match_result") or {}
        if match.get("place_id"):
            row["place_id"] = match["place_id"]
        merged.append(row)

    feed_bundle = compiler.compile_feeds(merged)

    sftp = _sftp_client_for(environment)
    upload_result = sftp.upload_feeds(list(feed_bundle.values()))
    ok = upload_result.get("status") == "success"

    now = datetime.now(timezone.utc)
    batch_id = f"{environment}-{int(now.timestamp())}"
    batch_record = None
    try:
        batch_record = UploadBatchRepository().create({
            "batch_id": batch_id,
            "environment": environment,
            "merchant_ids": [m["id"] for m in merged],
            "merchant_count": len(merged),
            "excluded_count": len(excluded),
            "feed_files": list(feed_bundle.values()),
            "upload_status": upload_result.get("status"),
            "dry_run": sftp.dry_run,
        })
    except Exception as e:
        logger.warning(f"Could not record upload batch '{batch_id}' to Firestore: {e}")

    summary = {
        "batch_id": batch_id,
        "environment": environment,
        "timestamp": now.isoformat(),
        "merchants_in_snapshot": len(merchants),
        "merchants_excluded": len(excluded),
        "merchants_pushed": len(merged),
        "feed_files": list(feed_bundle.values()),
        "upload": upload_result,
        "ok": ok,
        "needs_portal_verification": ok and not sftp.dry_run,
        "batch_recorded": batch_record is not None,
    }
    logger.info(f"Daily feed push finished: {summary}")
    return summary


async def _dispatch_ping(environment: str) -> Dict[str, Any]:
    return await ConversionSentryTool().dispatch_conversion_ping(environment)


def run_weekly_conversion_sweep(environment: str = "sandbox") -> Dict[str, Any]:
    """
    Playbook section 7: POST the sandbox test tokens (or prod token) so the rolling
    "3 events / 7 days" conversion-tracking check never lapses. Run this at least once
    a week per environment.
    """
    logger.info(f"Starting weekly conversion sweep ({environment})...")
    response = _run_sync(_dispatch_ping(environment))
    results = response.get("results", [])
    all_ok = bool(results) and all(r.get("status_code") == 200 for r in results)

    summary = {
        "environment": environment,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "tokens_pinged": len(results),
        "all_ok": all_ok,
        "results": results,
    }
    if not all_ok:
        logger.error(f"Conversion sweep had failures: {summary}")
    else:
        logger.info(f"Conversion sweep OK: {summary}")
    return summary


def _run_sync(coro):
    """Runs an async coroutine from this module's synchronous job entrypoints."""
    import asyncio
    return asyncio.run(coro)


def main() -> int:
    parser = argparse.ArgumentParser(description="FeedOps AI scheduled tasks")
    parser.add_argument("--job", required=True, choices=["daily", "weekly"])
    parser.add_argument("--environment", default=os.getenv("ENVIRONMENT", "sandbox"), choices=["sandbox", "production"])
    args = parser.parse_args()

    if args.job == "daily":
        summary = run_daily_feed_push(environment=args.environment)
        ok = summary["ok"]
    else:
        summary = run_weekly_conversion_sweep(environment=args.environment)
        ok = summary["all_ok"]

    print(json.dumps(summary, indent=2, default=str))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
