from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

STEP_SETUP = "setup"
STEP_FEEDS_SANDBOX = "feeds_sandbox"
STEP_CONVERSION_SANDBOX = "conversion_sandbox"
STEP_SANDBOX_TO_PROD_REVIEW = "sandbox_to_prod_review"
STEP_FEEDS_PRODUCTION = "feeds_production"
STEP_CONVERSION_PRODUCTION = "conversion_production"
STEP_LAUNCH_REVIEW = "launch_review"

# Menu Feeds -- a separate, opt-in 5-step track layered on top of the 7-step
# journey above (never merged with it). See compute_menu_journey.
STEP_MENU_SETUP = "menu_setup"
STEP_MENU_SANDBOX_DEV = "menu_sandbox_development"
STEP_MENU_SANDBOX_REVIEW = "menu_sandbox_review"
STEP_MENU_PRODUCTION_DEV = "menu_production_development"
STEP_MENU_LAUNCH_REVIEW = "menu_launch_review"

STATUS_COMPLETE = "complete"
STATUS_NEEDS_ATTENTION = "needs_attention"
STATUS_PENDING = "pending"

FEED_STREAK_TARGET_DAYS = 3
# Google's real launch checklist requires "feeds uploaded consecutively for 3
# days with at least 10 entities in each feed" -- not just a clean status.
FEED_STREAK_MIN_ENTITIES = 10
# Same values as app.py's CONVERSION_COMPLIANCE_MIN_EVENTS / _WINDOW_DAYS,
# duplicated (not imported) to avoid a backend.server -> backend.tools import
# cycle -- this module must stay import-free of anything server/Firestore.
CONVERSION_MIN_EVENTS = 3
CONVERSION_WINDOW_DAYS = 7

REVIEW_APPROVED = "approved"
REVIEW_REJECTED = "rejected"


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def compute_feed_streak(
    batches: List[Dict[str, Any]], environment: str, today: Optional[date] = None, kind: str = "ordering"
) -> Dict[str, Any]:
    """
    Consecutive most-recent calendar days (looking back from `today`) with at
    least one batch, in `environment`, where every present `feed_status_{type}`
    field is `confirmed_clean` AND at least FEED_STREAK_MIN_ENTITIES merchants
    were in the feed that day (Google's real requirement -- a clean but tiny
    feed doesn't count). Stops at the first failing day (no batch that day,
    any non-clean status, or too few entities) or at FEED_STREAK_TARGET_DAYS,
    whichever comes first.

    `kind` distinguishes Ordering Redirect batches ("ordering", the default --
    every existing call site is unaffected) from Menu Feed batches ("menu").
    Batches from before this field existed have no `kind` at all and are
    treated as "ordering" via the same `.get(..., "ordering")` fallback used
    everywhere else this field is read, so old data's behavior is unchanged.
    """
    today = today or datetime.now(timezone.utc).date()

    by_day: Dict[date, List[Dict[str, Any]]] = defaultdict(list)
    for batch in batches:
        if batch.get("environment") != environment:
            continue
        if batch.get("kind", "ordering") != kind:
            continue
        ts = _parse_timestamp(batch.get("created_at"))
        if not ts:
            continue
        by_day[ts.date()].append(batch)

    streak = 0
    cursor = today
    while streak < FEED_STREAK_TARGET_DAYS:
        day_batches = by_day.get(cursor)
        if not day_batches:
            break
        day_clean = True
        for batch in day_batches:
            if (batch.get("merchant_count") or 0) < FEED_STREAK_MIN_ENTITIES:
                day_clean = False
                break
            for key, value in batch.items():
                if key.startswith("feed_status_") and value != "confirmed_clean":
                    day_clean = False
                    break
            if not day_clean:
                break
        if not day_clean:
            break
        streak += 1
        cursor = cursor - timedelta(days=1)

    return {
        "current": streak,
        "target": FEED_STREAK_TARGET_DAYS,
        "clean": streak >= FEED_STREAK_TARGET_DAYS,
    }


def compute_conversion_compliance(
    checks: List[Dict[str, Any]], environment: str, now: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    Sums `successful_pings` across `checks` in `environment` within the last
    CONVERSION_WINDOW_DAYS -- same rule as app.py's list_conversion_checks(),
    scoped to one environment instead of aggregated globally.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=CONVERSION_WINDOW_DAYS)

    total = 0
    for check in checks:
        if check.get("environment") != environment:
            continue
        ts = _parse_timestamp(check.get("timestamp"))
        if not ts or ts < cutoff:
            continue
        total += check.get("successful_pings", 0) or 0

    return {
        "current": total,
        "target": CONVERSION_MIN_EVENTS,
        "compliant": total >= CONVERSION_MIN_EVENTS,
    }


def _portal_status_sandbox(org: Optional[Dict[str, Any]]) -> Optional[str]:
    if not org:
        return None
    config = org.get("config") or {}
    return config.get("portal_status_sandbox") or (org.get("portal_status") or {}).get("sandbox")


def compute_journey(
    org: Optional[Dict[str, Any]],
    batches: List[Dict[str, Any]],
    checks: List[Dict[str, Any]],
    today: Optional[date] = None,
    merchant_count: int = 0,
) -> Dict[str, Any]:
    """Pure, no I/O. Assembles all 7 onboarding-journey steps from raw dicts."""
    config = (org or {}).get("config") or {}

    # Step 1: Setup
    # Note: ApiWebhooks.tsx's PORTAL_STATUS_OPTIONS is ["not_started",
    # "in_progress", "live"] -- NOT firestore_client.py's PORTAL_STATUS_CONFIGURED
    # /_LAUNCH_APPROVED constants ("configured"/"launch_approved"), which are
    # never actually written by the frontend. Match the real saved values.
    portal_status_sandbox = _portal_status_sandbox(org)
    partner_id = config.get("conversion_partner_id")
    setup_complete = portal_status_sandbox in ("in_progress", "live") and bool(partner_id)
    if setup_complete:
        setup_status, setup_detail = STATUS_COMPLETE, "Sandbox SFTP configured and Conversion Partner ID set."
    else:
        missing = []
        if portal_status_sandbox not in ("in_progress", "live"):
            missing.append("sandbox SFTP configuration")
        if not partner_id:
            missing.append("Conversion Partner ID")
        setup_status = STATUS_NEEDS_ATTENTION
        setup_detail = f"Missing: {', '.join(missing)}. Set these on API & Webhooks."

    # Step 2/3: Sandbox
    feeds_sandbox = compute_feed_streak(batches, "sandbox", today)
    no_merchants = merchant_count == 0
    if not setup_complete:
        feeds_sandbox_status = STATUS_PENDING
        feeds_sandbox_detail = f"{feeds_sandbox['current']}/{feeds_sandbox['target']} consecutive clean days."
    elif no_merchants:
        # A feed is compiled from the merchant roster -- "0/3 clean days" reads
        # as "feeds are failing" when the real blocker is that there's nothing
        # to feed yet. Say that plainly instead of leaving it ambiguous.
        feeds_sandbox_status = STATUS_NEEDS_ATTENTION
        feeds_sandbox_detail = "No merchant data on file yet -- upload your restaurant roster on the Merchants page first."
    elif feeds_sandbox["clean"]:
        feeds_sandbox_status = STATUS_COMPLETE
        feeds_sandbox_detail = f"{feeds_sandbox['current']}/{feeds_sandbox['target']} consecutive clean days."
    else:
        feeds_sandbox_status = STATUS_NEEDS_ATTENTION
        feeds_sandbox_detail = f"{feeds_sandbox['current']}/{feeds_sandbox['target']} consecutive clean days."

    conversion_sandbox = compute_conversion_compliance(checks, "sandbox")
    if feeds_sandbox_status != STATUS_COMPLETE:
        conversion_sandbox_status = STATUS_PENDING
    elif conversion_sandbox["compliant"]:
        conversion_sandbox_status = STATUS_COMPLETE
    else:
        conversion_sandbox_status = STATUS_NEEDS_ATTENTION
    conversion_sandbox_detail = (
        f"{conversion_sandbox['current']}/{conversion_sandbox['target']} conversion events in the last "
        f"{CONVERSION_WINDOW_DAYS} days."
    )

    # Step 4: Sandbox to Production Review (self-attested)
    sandbox_review_value = config.get("sandbox_to_prod_review_status")
    sandbox_review_ready = feeds_sandbox_status == STATUS_COMPLETE and conversion_sandbox_status == STATUS_COMPLETE
    if sandbox_review_value == REVIEW_APPROVED:
        review_status, review_detail = STATUS_COMPLETE, "Approved."
    elif sandbox_review_value == REVIEW_REJECTED:
        review_status, review_detail = STATUS_NEEDS_ATTENTION, "Previously rejected -- address the issues, then re-request."
    elif sandbox_review_ready:
        review_status, review_detail = STATUS_NEEDS_ATTENTION, "Ready to request review."
    else:
        review_status, review_detail = STATUS_PENDING, "Complete Feeds and Conversion Tracking in Sandbox first."

    # Step 5/6: Production
    review_approved = review_status == STATUS_COMPLETE
    feeds_production = compute_feed_streak(batches, "production", today)
    if not review_approved:
        feeds_production_status = STATUS_PENDING
        feeds_production_detail = f"{feeds_production['current']}/{feeds_production['target']} consecutive clean days."
    elif no_merchants:
        feeds_production_status = STATUS_NEEDS_ATTENTION
        feeds_production_detail = "No merchant data on file yet -- upload your restaurant roster on the Merchants page first."
    elif feeds_production["clean"]:
        feeds_production_status = STATUS_COMPLETE
        feeds_production_detail = f"{feeds_production['current']}/{feeds_production['target']} consecutive clean days."
    else:
        feeds_production_status = STATUS_NEEDS_ATTENTION
        feeds_production_detail = f"{feeds_production['current']}/{feeds_production['target']} consecutive clean days."

    conversion_production = compute_conversion_compliance(checks, "production")
    if feeds_production_status != STATUS_COMPLETE:
        conversion_production_status = STATUS_PENDING
    elif conversion_production["compliant"]:
        conversion_production_status = STATUS_COMPLETE
    else:
        conversion_production_status = STATUS_NEEDS_ATTENTION
    conversion_production_detail = (
        f"{conversion_production['current']}/{conversion_production['target']} conversion events in the last "
        f"{CONVERSION_WINDOW_DAYS} days."
    )

    # Step 7: Launch Review (self-attested)
    launch_value = config.get("launch_review_status")
    launch_ready = (
        review_approved
        and feeds_production_status == STATUS_COMPLETE
        and conversion_production_status == STATUS_COMPLETE
    )
    if launch_value == REVIEW_APPROVED:
        launch_status, launch_detail = STATUS_COMPLETE, "Approved -- launched."
    elif launch_value == REVIEW_REJECTED:
        launch_status, launch_detail = STATUS_NEEDS_ATTENTION, "Previously rejected -- address the issues, then re-request."
    elif launch_ready:
        launch_status, launch_detail = STATUS_NEEDS_ATTENTION, "Ready to request launch review."
    else:
        launch_status, launch_detail = STATUS_PENDING, "Complete the Sandbox-to-Production Review and Production readiness first."

    steps = [
        {"key": STEP_SETUP, "label": "Setup", "status": setup_status, "detail": setup_detail, "progress": None},
        {
            "key": STEP_FEEDS_SANDBOX,
            "label": "Feeds ready in Sandbox",
            "status": feeds_sandbox_status,
            "detail": feeds_sandbox_detail,
            "progress": {"current": feeds_sandbox["current"], "target": feeds_sandbox["target"]},
        },
        {
            "key": STEP_CONVERSION_SANDBOX,
            "label": "Conversion Tracking in Sandbox",
            "status": conversion_sandbox_status,
            "detail": conversion_sandbox_detail,
            "progress": {"current": conversion_sandbox["current"], "target": conversion_sandbox["target"]},
        },
        {
            "key": STEP_SANDBOX_TO_PROD_REVIEW,
            "label": "Sandbox to Production Review",
            "status": review_status,
            "detail": review_detail,
            "progress": None,
        },
        {
            "key": STEP_FEEDS_PRODUCTION,
            "label": "Feeds ready in Production",
            "status": feeds_production_status,
            "detail": feeds_production_detail,
            "progress": {"current": feeds_production["current"], "target": feeds_production["target"]},
        },
        {
            "key": STEP_CONVERSION_PRODUCTION,
            "label": "Conversion Tracking in Production",
            "status": conversion_production_status,
            "detail": conversion_production_detail,
            "progress": {"current": conversion_production["current"], "target": conversion_production["target"]},
        },
        {
            "key": STEP_LAUNCH_REVIEW,
            "label": "Launch Review",
            "status": launch_status,
            "detail": launch_detail,
            "progress": None,
        },
    ]

    complete_count = sum(1 for s in steps if s["status"] == STATUS_COMPLETE)
    return {"steps": steps, "overall_progress": {"complete": complete_count, "total": len(steps)}}


def compute_menu_journey(
    org: Optional[Dict[str, Any]],
    batches: List[Dict[str, Any]],
    today: Optional[date] = None,
    merchant_count: int = 0,
) -> Dict[str, Any]:
    """
    Pure, no I/O. Assembles the 5-step Google Menu Feeds onboarding journey --
    Setup / Sandbox Development / Sandbox Review / Production Development /
    Launch Review, per the real docs:
    https://developers.google.com/actions-center/verticals/ordering/redirect/reference/menu-feeds/onboarding-process

    A separate, opt-in track layered on top of the 7-step Ordering Redirect
    journey (compute_journey) -- never merged with it, and returned even when
    disabled (via the "enabled" key) so the caller doesn't need a second fetch
    just to decide whether to render anything.
    """
    config = (org or {}).get("config") or {}
    menu_enabled = bool(config.get("menu_feeds_enabled"))

    # Step 1: Setup
    generic_sandbox_username = config.get("generic_sftp_username_sandbox")
    setup_complete = menu_enabled and bool(generic_sandbox_username)
    if setup_complete:
        setup_status, setup_detail = STATUS_COMPLETE, "Menu Feeds enabled and Generic SFTP (sandbox) configured."
    else:
        missing = []
        if not menu_enabled:
            missing.append("Menu Feeds not enabled")
        if not generic_sandbox_username:
            missing.append("Generic SFTP username (sandbox)")
        setup_status = STATUS_NEEDS_ATTENTION
        setup_detail = f"Missing: {', '.join(missing)}. Set these on Setup."

    # Step 2: Sandbox Development
    sandbox_dev = compute_feed_streak(batches, "sandbox", today, kind="menu")
    no_merchants = merchant_count == 0
    if not setup_complete:
        sandbox_dev_status = STATUS_PENDING
        sandbox_dev_detail = f"{sandbox_dev['current']}/{sandbox_dev['target']} consecutive clean menu feed days."
    elif no_merchants:
        sandbox_dev_status = STATUS_NEEDS_ATTENTION
        sandbox_dev_detail = "No merchant data on file yet -- upload your restaurant roster on the Merchants page first."
    elif sandbox_dev["clean"]:
        sandbox_dev_status = STATUS_COMPLETE
        sandbox_dev_detail = f"{sandbox_dev['current']}/{sandbox_dev['target']} consecutive clean menu feed days."
    else:
        sandbox_dev_status = STATUS_NEEDS_ATTENTION
        sandbox_dev_detail = f"{sandbox_dev['current']}/{sandbox_dev['target']} consecutive clean menu feed days."

    # Step 3: Sandbox Review (self-attested -- no API, same pattern as the
    # Redirect journey's two review steps)
    sandbox_review_value = config.get("menu_sandbox_review_status")
    sandbox_review_ready = sandbox_dev_status == STATUS_COMPLETE
    if sandbox_review_value == REVIEW_APPROVED:
        sandbox_review_status, sandbox_review_detail = STATUS_COMPLETE, "Approved."
    elif sandbox_review_value == REVIEW_REJECTED:
        sandbox_review_status = STATUS_NEEDS_ATTENTION
        sandbox_review_detail = "Previously rejected -- address the issues, then re-request."
    elif sandbox_review_ready:
        sandbox_review_status, sandbox_review_detail = STATUS_NEEDS_ATTENTION, "Ready to request review."
    else:
        sandbox_review_status, sandbox_review_detail = STATUS_PENDING, "Complete Sandbox Development first."

    # Step 4: Production Development
    sandbox_review_approved = sandbox_review_status == STATUS_COMPLETE
    production_dev = compute_feed_streak(batches, "production", today, kind="menu")
    if not sandbox_review_approved:
        production_dev_status = STATUS_PENDING
        production_dev_detail = f"{production_dev['current']}/{production_dev['target']} consecutive clean menu feed days."
    elif no_merchants:
        production_dev_status = STATUS_NEEDS_ATTENTION
        production_dev_detail = "No merchant data on file yet -- upload your restaurant roster on the Merchants page first."
    elif production_dev["clean"]:
        production_dev_status = STATUS_COMPLETE
        production_dev_detail = f"{production_dev['current']}/{production_dev['target']} consecutive clean menu feed days."
    else:
        production_dev_status = STATUS_NEEDS_ATTENTION
        production_dev_detail = f"{production_dev['current']}/{production_dev['target']} consecutive clean menu feed days."

    # Step 5: Launch Review (self-attested)
    launch_value = config.get("menu_launch_review_status")
    launch_ready = sandbox_review_approved and production_dev_status == STATUS_COMPLETE
    if launch_value == REVIEW_APPROVED:
        launch_status, launch_detail = STATUS_COMPLETE, "Approved -- launched."
    elif launch_value == REVIEW_REJECTED:
        launch_status = STATUS_NEEDS_ATTENTION
        launch_detail = "Previously rejected -- address the issues, then re-request."
    elif launch_ready:
        launch_status, launch_detail = STATUS_NEEDS_ATTENTION, "Ready to request launch review."
    else:
        launch_status, launch_detail = STATUS_PENDING, "Complete Production Development first."

    steps = [
        {"key": STEP_MENU_SETUP, "label": "Setup", "status": setup_status, "detail": setup_detail, "progress": None},
        {
            "key": STEP_MENU_SANDBOX_DEV,
            "label": "Sandbox Development",
            "status": sandbox_dev_status,
            "detail": sandbox_dev_detail,
            "progress": {"current": sandbox_dev["current"], "target": sandbox_dev["target"]},
        },
        {
            "key": STEP_MENU_SANDBOX_REVIEW,
            "label": "Sandbox Review",
            "status": sandbox_review_status,
            "detail": sandbox_review_detail,
            "progress": None,
        },
        {
            "key": STEP_MENU_PRODUCTION_DEV,
            "label": "Production Development",
            "status": production_dev_status,
            "detail": production_dev_detail,
            "progress": {"current": production_dev["current"], "target": production_dev["target"]},
        },
        {
            "key": STEP_MENU_LAUNCH_REVIEW,
            "label": "Launch Review",
            "status": launch_status,
            "detail": launch_detail,
            "progress": None,
        },
    ]

    complete_count = sum(1 for s in steps if s["status"] == STATUS_COMPLETE)
    return {
        "enabled": menu_enabled,
        "steps": steps,
        "overall_progress": {"complete": complete_count, "total": len(steps)},
    }
