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
from typing import Any, Dict, List, Optional, Tuple

from backend.tools.feed_compiler import ActionsCenterFeedCompiler
from backend.tools.places_matcher import resolve_entity_match
from backend.tools.sftp_uploader import GoogleSFTPClient
from backend.tools.conversion_sentry import ConversionSentryTool
from backend.db.firestore_client import (
    MerchantRepository, STATUS_EXCLUDED_CLOSED, UploadBatchRepository,
    ConversionCheckRepository,
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


def _load_merchants(
    path: str = DEFAULT_SNAPSHOT_PATH, allow_fixture_fallback: bool = True
) -> List[Dict[str, Any]]:
    """
    Loads the current merchant list to feed today. Tries Firestore (the live data
    source) first; when `allow_fixture_fallback` is True (the scheduled Cloud Run
    Job's default -- it must not skip a whole day just because Firestore hiccupped),
    falls back to the last known-good JSON snapshot on disk if Firestore is
    unreachable or returns nothing, matching the playbook's own guidance (section 6).

    When `allow_fixture_fallback` is False (the interactive "Upload Now" button),
    returns an empty list in either of those cases instead. An aggregator who
    hasn't uploaded any real merchants yet has zero active merchants in Firestore
    too -- without this flag, clicking Upload Now would silently push the fixture
    snapshot's 12 fake chain restaurants (Burger King, Pizza Hut, ...) and report
    it as a real success.
    """
    try:
        merchants = MerchantRepository().list_active()
        if merchants:
            logger.info(f"Loaded {len(merchants)} active merchant(s) from Firestore.")
            return merchants
        logger.warning("Firestore returned no active merchants.")
    except Exception as e:
        logger.warning(f"Firestore unreachable ({e}).")

    if not allow_fixture_fallback:
        return []

    logger.warning("Falling back to JSON snapshot.")
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
            # This id is from the static fixture, not a real Firestore document --
            # _persist_guard_results must not write status updates back under it,
            # or it creates an orphaned ghost merchant doc with no name/address,
            # just a status and a place_id (a real bug this flag fixes: it happened
            # every time the daily push fell back to this snapshot).
            "_synthetic": True,
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
    Never lets a Firestore write failure block the actual feed push.

    Skips merchants tagged _synthetic (sourced from the JSON snapshot fallback,
    not a real Firestore document) -- writing a status update under their
    fixture id would create a brand-new orphaned document with no name or
    address, not update anything real.

    A kept merchant's status is never touched here -- STATUS_MATCHED vs
    STATUS_NEEDS_REVIEW vs STATUS_APPROVED is EntityMatcher's and the Triage
    Queue's decision (confidence-gated), not this closed-merchant guard's. This
    used to call update_status(..., STATUS_MATCHED, ...) unconditionally
    whenever ANY place_id came back, which silently promoted every needs_review
    merchant to "matched" on the very next feed push regardless of its real
    confidence -- confirmed live: two merchants sitting at 31%/39% confidence
    in the Triage Queue got flipped to "matched" this way. Only the place_id
    is refreshed here (via upsert's merge, which leaves status alone since
    it's not in the payload); only the EXCLUDED branch legitimately owns a
    status transition, since "Google's own data marks this closed" really is
    this guard's own call to make."""
    try:
        repo = MerchantRepository()
        for m in excluded:
            if m.get("_synthetic"):
                continue
            repo.update_status(m["store_id"], STATUS_EXCLUDED_CLOSED, extra={"exclude_reason": m["exclude_reason"]})
        for m in kept:
            if m.get("_synthetic"):
                continue
            match = m.get("match_result") or {}
            if match.get("place_id"):
                repo.upsert({"store_id": m["store_id"], "place_id": match["place_id"]})
    except Exception as e:
        logger.warning(f"Could not persist closed-merchant guard results to Firestore: {e}")


def _append_exclude_list(excluded: List[Dict[str, Any]], path: str = EXCLUDE_LIST_PATH) -> None:
    if not excluded:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as f:
        for m in excluded:
            f.write(f"{m['store_id']}  # {m['name']} -- {m['exclude_reason']} ({datetime.now(timezone.utc).isoformat()})\n")


def _sftp_client_for(environment: str, org_id: Optional[str] = None) -> GoogleSFTPClient:
    username_env = f"GOOGLE_SFTP_USERNAME_{environment.upper()}"
    username = os.getenv(username_env, os.getenv("GOOGLE_SFTP_USERNAME"))
    
    if not username and org_id:
        try:
            from backend.db.firestore_client import OrganizationRepository
            org = OrganizationRepository().get(org_id) or {}
            config = org.get("config", {})
            username = config.get(f"sftp_username_{environment.lower()}") or config.get("sftp_username_sandbox")
        except Exception:
            pass

    if not username:
        username = "feedops_partner"

    key_path = os.getenv("GOOGLE_SFTP_KEY_PATH")
    if not key_path or not os.path.exists(os.path.expanduser(key_path)):
        for candidate in ["~/.ssh/google_actions_center", "~/.ssh/id_ed25519", "~/.ssh/id_rsa"]:
            if os.path.exists(os.path.expanduser(candidate)):
                key_path = candidate
                break

    dry_run = not (key_path and os.path.exists(os.path.expanduser(key_path)))
    if dry_run:
        logger.warning(
            f"No usable key at GOOGLE_SFTP_KEY_PATH or standard SSH locations; running SFTP upload in dry-run mode."
        )
    return GoogleSFTPClient(private_key_path=key_path, username=username, dry_run=dry_run)



def run_daily_feed_push(
    environment: str = "sandbox",
    snapshot_path: str = DEFAULT_SNAPSHOT_PATH,
    allow_fixture_fallback: bool = True,
    org_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Regenerates the feed bundle from the current merchant data and uploads it."""
    logger.info(f"Starting daily feed push ({environment})...")

    merchants = _load_merchants(snapshot_path, allow_fixture_fallback=allow_fixture_fallback)
    if not merchants:
        logger.warning("No merchant data available -- nothing to push.")
        return {
            "batch_id": None,
            "environment": environment,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "merchants_in_snapshot": 0,
            "merchants_excluded": 0,
            "merchants_pushed": 0,
            "feed_files": [],
            "upload": None,
            "ok": False,
            "needs_portal_verification": False,
            "batch_recorded": False,
            "error": "No merchant data on file yet -- upload merchants before pushing a feed.",
        }

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
            # Carried through so the service feed (lead time + hours) can be
            # compiled for merchants that have real data on file -- see
            # feed_compiler.py's _build_service_rows, which omits a merchant
            # from the service feed entirely rather than invent either.
            "service_types": m.get("service_types"),
            "opening_hours": m.get("opening_hours"),
            "lead_time_minutes": m.get("lead_time_minutes"),
        }
        match = m.get("match_result") or {}
        if match.get("place_id"):
            row["place_id"] = match["place_id"]
        merged.append(row)

    feed_bundle = compiler.compile_feeds(merged)

    sftp = _sftp_client_for(environment, org_id=org_id)
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
            "feed_files": feed_bundle,
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


async def _dispatch_ping(environment: str, partner_id: Optional[str] = None) -> Dict[str, Any]:
    return await ConversionSentryTool().dispatch_conversion_ping(environment, partner_id=partner_id)


def run_weekly_conversion_sweep(environment: str = "sandbox", partner_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Playbook section 7: POST the sandbox test tokens (or prod token) so the rolling
    "3 events / 7 days" conversion-tracking check never lapses. Run this at least once
    a week per environment.

    Persists every run to Firestore -- ConversionSentryTool's own health_log is
    in-memory only, and Cloud Run Jobs run as separate ephemeral processes each
    week, so that log never actually survives between runs in production. The
    "3 events / 7 days" compliance check needs real history to compute against.

    partner_id overrides the GOOGLE_CONVERSION_PARTNER_ID env var -- passed
    through from an aggregator's own saved org config when called via the API
    (see app.py's /api/conversion/check), falling back to the env var for the
    scheduled Cloud Run Job invocation, which has no per-org context.
    """
    logger.info(f"Starting weekly conversion sweep ({environment})...")
    response = _run_sync(_dispatch_ping(environment, partner_id))
    results = response.get("results", [])
    all_ok = bool(results) and all(r.get("status_code") == 200 for r in results)
    now = datetime.now(timezone.utc)

    summary = {
        "check_id": f"{environment}-{int(now.timestamp())}",
        "environment": environment,
        "timestamp": now.isoformat(),
        "tokens_pinged": len(results),
        "successful_pings": sum(1 for r in results if r.get("success")),
        "all_ok": all_ok,
        "results": results,
    }
    try:
        ConversionCheckRepository().create(summary)
    except Exception as e:
        logger.warning(f"Could not record conversion check '{summary['check_id']}' to Firestore: {e}")

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
