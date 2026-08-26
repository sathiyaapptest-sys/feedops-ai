import asyncio
import json
from typing import Any, Dict, List, Optional

import pandas as pd
from pydantic import BaseModel

from backend.db.firestore_client import MerchantRepository
from backend.tools.places_matcher import _name_similarity, resolve_entity_match

# Same cutoff _persist_bulk_merchant (backend/server/app.py) already uses for
# matched vs. needs-review vs. no-listing -- reused here for suggestion
# confidence badges rather than inventing a new threshold.
MATCH_CONFIDENCE_THRESHOLD = 0.90

_REQUIRED_COLUMNS = ["Entity ID", "Entity Name", "Country", "Matched", "State"]


class EntityMatchRow(BaseModel):
    entity_id: str
    entity_name: str
    country: Optional[str] = None
    matched_raw: str
    state: Optional[str] = None


def parse_entity_csv(file_obj) -> Dict[str, Any]:
    """
    Parses Google's Entity-match CSV export. Columns observed in a real
    export: Entity ID, Entity Name, Country, Matched, State (e.g.
    `vendor_101, Sourdough Bakehouse, US, ["Yes",3], INVENTORY_DISABLED`).
    """
    errors: List[Dict[str, Any]] = []
    try:
        df = pd.read_csv(file_obj, dtype=str)
    except Exception as e:
        return {"rows": [], "errors": [{"row_index": -1, "field": "file", "message": f"Could not parse CSV: {e}"}]}

    missing = [c for c in _REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        return {
            "rows": [],
            "errors": [{"row_index": -1, "field": "columns", "message": f"Missing expected column(s): {', '.join(missing)}"}],
        }

    rows: List[EntityMatchRow] = []
    for idx, row in df.iterrows():
        entity_id = str(row.get("Entity ID") or "").strip()
        entity_name = str(row.get("Entity Name") or "").strip()
        if not entity_id or not entity_name:
            errors.append({"row_index": idx, "field": "entity_id/entity_name", "message": "Missing Entity ID or Entity Name"})
            continue
        rows.append(
            EntityMatchRow(
                entity_id=entity_id,
                entity_name=entity_name,
                country=(str(row.get("Country")) if pd.notna(row.get("Country")) else None),
                matched_raw=str(row.get("Matched") or ""),
                state=(str(row.get("State")) if pd.notna(row.get("State")) else None),
            )
        )

    return {"rows": rows, "errors": errors}


def _is_matched_yes(matched_raw: str) -> bool:
    """
    The `Matched` cell is a stringified list like '["Yes",3]', not a plain
    bool. Only one real sample has been observed -- this defensively tries
    JSON first, then falls back to a substring check, but should be verified
    against more real exports before being trusted broadly.
    """
    if not matched_raw:
        return False
    try:
        parsed = json.loads(matched_raw)
        if isinstance(parsed, list) and parsed:
            return str(parsed[0]).strip().lower() == "yes"
    except (json.JSONDecodeError, TypeError):
        pass
    return "yes" in matched_raw.lower()


def _needs_remediation(row: EntityMatchRow) -> bool:
    """
    True only when the row is NOT matched -- that's the one case a Maps URL
    suggestion actually helps. A row can show Matched=Yes with a disabled
    State for unrelated reasons (confirmed in a real sample: vendor_101 was
    Matched=Yes yet State=INVENTORY_DISABLED) -- suggesting a fresh Maps URL
    there wouldn't fix that and risks overwriting a correct existing match,
    so those are deliberately left out of remediation here.
    """
    return not _is_matched_yes(row.matched_raw)


def _maps_url(place_id: Optional[str]) -> Optional[str]:
    if not place_id:
        return None
    return f"https://www.google.com/maps/place/?q=place_id:{place_id}"


def _find_merchant_by_name(entity_name: str, merchants: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Google's `Entity ID` (e.g. "vendor_101") does NOT map to our
    MerchantRepository store_id -- store_id is a deterministic slug of
    org_id + merchant name (slugify_store_id), not an arbitrary vendor_NNN
    scheme. So matching happens by name instead: exact (case-insensitive)
    first, then the highest-scoring fuzzy match via the same
    _name_similarity helper resolve_entity_match uses internally.
    """
    normalized_target = entity_name.strip().lower()
    for m in merchants:
        if (m.get("name") or "").strip().lower() == normalized_target:
            return m

    best_merchant: Optional[Dict[str, Any]] = None
    best_score = 0.0
    for m in merchants:
        score = _name_similarity(entity_name, m.get("name") or "")
        if score > best_score:
            best_score, best_merchant = score, m

    # Only accept a fuzzy match if it's reasonably confident -- otherwise
    # this is a "no_merchant_record" case, not a fresh_lookup one.
    if best_merchant is not None and best_score >= 0.75:
        return best_merchant
    return None


async def suggest_matches(rows: List[EntityMatchRow], org_id: Optional[str] = None) -> Dict[str, Any]:
    """
    For each row that needs remediation, suggests a Google Maps URL to copy
    into Google's "Edit match" screen. Never writes anything back to Google
    (no API exists for that) and never writes to Firestore -- purely
    computed and returned for a human to act on.
    """
    all_merchants = await asyncio.to_thread(MerchantRepository().list_all)
    if org_id:
        scoped_merchants = [m for m in all_merchants if m.get("org_id") == org_id] or all_merchants
    else:
        scoped_merchants = all_merchants

    suggestions: List[Dict[str, Any]] = []
    for row in rows:
        if not _needs_remediation(row):
            continue

        merchant = _find_merchant_by_name(row.entity_name, scoped_merchants)

        if merchant is None:
            suggestions.append(
                {
                    "entity_id": row.entity_id,
                    "entity_name": row.entity_name,
                    "state": row.state,
                    "confidence": None,
                    "place_id": None,
                    "suggested_maps_url": None,
                    "source": "no_merchant_record",
                    "note": "No merchant record matched this Entity Name -- verify the Entity ID mapping or search manually.",
                }
            )
            continue

        if merchant.get("place_id"):
            suggestions.append(
                {
                    "entity_id": row.entity_id,
                    "entity_name": row.entity_name,
                    "state": row.state,
                    "confidence": merchant.get("confidence"),
                    "place_id": merchant.get("place_id"),
                    "suggested_maps_url": _maps_url(merchant.get("place_id")),
                    "source": "stored",
                    "note": None,
                }
            )
            continue

        try:
            match = await resolve_entity_match(merchant.get("name", ""), merchant.get("address", ""))
        except Exception as e:
            suggestions.append(
                {
                    "entity_id": row.entity_id,
                    "entity_name": row.entity_name,
                    "state": row.state,
                    "confidence": None,
                    "place_id": None,
                    "suggested_maps_url": None,
                    "source": "no_merchant_record",
                    "note": f"Places lookup failed: {e}",
                }
            )
            continue

        suggestions.append(
            {
                "entity_id": row.entity_id,
                "entity_name": row.entity_name,
                "state": row.state,
                "confidence": match.get("confidence"),
                "place_id": match.get("place_id"),
                "suggested_maps_url": _maps_url(match.get("place_id")),
                "source": "fresh_lookup",
                "note": None,
            }
        )

    return {"suggestions": suggestions}
