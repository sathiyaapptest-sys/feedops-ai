"""
FeedOps AI - Menu Feed Push

Google Menu Feeds (google.food_menu) is a separate, opt-in onboarding track
layered on top of Ordering Redirect -- see
https://developers.google.com/actions-center/verticals/ordering/redirect/reference/menu-feeds/onboarding-process
and backend/tools/onboarding_journey.py's compute_menu_journey(), which
tracks it independently of the 7-step Redirect journey.

Deliberately a separate module from backend/jobs/scheduled_tasks.py rather
than an addition to it -- this keeps zero risk to the already-shipped daily
feed push and weekly conversion sweep jobs. Every upload_batches document
this writes is tagged "kind": "menu" so it never gets counted by the
Redirect journey's feed-streak calculations, and vice versa (see
compute_feed_streak's `kind` parameter).

Unlike run_daily_feed_push, there's no fixture snapshot to fall back to for
menu data (no menu equivalent of fixtures/golden_dataset.json exists) -- if
there's no real merchant/menu data on file, this always returns a clean
"nothing to push" result rather than a misleading success, matching the
guard already applied to the interactive Ordering Redirect push.
"""

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List

from backend.tools.feed_compiler import ActionsCenterFeedCompiler
from backend.tools.sftp_uploader import GoogleSFTPClient
from backend.db.firestore_client import MerchantRepository, MenuRepository, UploadBatchRepository

logger = logging.getLogger("feedops.jobs.menu")


def _load_merchants_with_menus() -> List[Dict[str, Any]]:
    """
    Active merchants that both have a matched entity_id (place_id or a
    slugified store_id -- same fallback compile_feeds' entity_id derivation
    uses: f"vendor_{id}") and at least one real menu item on file. A merchant
    without a menu simply isn't included -- never a fabricated placeholder
    menu (see feed_compiler.compile_menu_feed's own "omit, don't invent" rule).
    """
    try:
        merchants = MerchantRepository().list_active()
    except Exception as e:
        logger.warning(f"Firestore unreachable ({e}); no merchant data to compile a menu feed from.")
        return []

    result: List[Dict[str, Any]] = []
    for merchant in merchants:
        store_id = merchant.get("store_id")
        if not store_id:
            continue
        try:
            menu = MenuRepository().get(store_id)
        except Exception as e:
            logger.warning(f"Could not load menu for '{store_id}': {e}")
            continue
        items = (menu or {}).get("items") or []
        if not items:
            continue
        entity_id = f"vendor_{store_id}"
        result.append({"entity_id": entity_id, "items": items})
    return result


def _generic_sftp_client_for(environment: str) -> GoogleSFTPClient:
    """
    Mirrors scheduled_tasks._sftp_client_for's pattern exactly, but reads the
    Generic SFTP server's own env vars -- Menu Feeds uploads through a
    different SFTP username than the Entity/Action/Service feed (Menu Feeds
    Overview: "Menu data are ingested using the Generic Feeds").
    """
    username_env = f"GOOGLE_GENERIC_SFTP_USERNAME_{environment.upper()}"
    username = os.getenv(username_env, os.getenv("GOOGLE_GENERIC_SFTP_USERNAME", "feedops_partner"))
    key_path = os.getenv("GOOGLE_SFTP_KEY_PATH")
    dry_run = not (key_path and os.path.exists(os.path.expanduser(key_path)))
    if dry_run:
        logger.warning(
            f"No usable key at GOOGLE_SFTP_KEY_PATH ({key_path!r}); running Menu Feed SFTP upload in dry-run mode."
        )
    return GoogleSFTPClient(private_key_path=key_path, username=username, dry_run=dry_run)


def run_menu_feed_push(environment: str = "sandbox") -> Dict[str, Any]:
    """Regenerates the google.food_menu feed from current merchant menu data and uploads it."""
    logger.info(f"Starting menu feed push ({environment})...")

    merchants_with_menus = _load_merchants_with_menus()
    if not merchants_with_menus:
        logger.warning("No merchant menu data available -- nothing to push.")
        return {
            "batch_id": None,
            "environment": environment,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "merchants_pushed": 0,
            "feed_files": [],
            "upload": None,
            "ok": False,
            "batch_recorded": False,
            "error": "No menu data on file yet -- add menu items before pushing a menu feed.",
        }

    compiler = ActionsCenterFeedCompiler()
    feed_bundle = compiler.compile_menu_feed(merchants_with_menus)
    if not feed_bundle:
        logger.warning("No menu items had a valid price -- nothing to push.")
        return {
            "batch_id": None,
            "environment": environment,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "merchants_pushed": 0,
            "feed_files": [],
            "upload": None,
            "ok": False,
            "batch_recorded": False,
            "error": "No menu items with a valid price -- nothing to push.",
        }

    sftp = _generic_sftp_client_for(environment)
    upload_result = sftp.upload_feeds(list(feed_bundle.values()))
    ok = upload_result.get("status") == "success"

    now = datetime.now(timezone.utc)
    batch_id = f"menu-{environment}-{int(now.timestamp())}"
    batch_record = None
    try:
        batch_record = UploadBatchRepository().create({
            "batch_id": batch_id,
            "environment": environment,
            "kind": "menu",
            "merchant_ids": [m["entity_id"] for m in merchants_with_menus],
            "merchant_count": len(merchants_with_menus),
            "excluded_count": 0,
            "feed_files": feed_bundle,
            "upload_status": upload_result.get("status"),
            "dry_run": sftp.dry_run,
        })
    except Exception as e:
        logger.warning(f"Could not record menu upload batch '{batch_id}' to Firestore: {e}")

    summary = {
        "batch_id": batch_id,
        "environment": environment,
        "timestamp": now.isoformat(),
        "merchants_pushed": len(merchants_with_menus),
        "feed_files": list(feed_bundle.values()),
        "upload": upload_result,
        "ok": ok,
        "needs_portal_verification": ok and not sftp.dry_run,
        "batch_recorded": batch_record is not None,
    }
    logger.info(f"Menu feed push finished: {summary}")
    return summary
