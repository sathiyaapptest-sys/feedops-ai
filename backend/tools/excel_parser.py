import logging
import re
from typing import Any, Dict, List, Optional

import pandas as pd
from pydantic import BaseModel

from backend.tools.data_adapter import DataSourceAdapter, infer_adapter, slugify_store_id, validate_and_transform

logger = logging.getLogger("feedops.excel_parser")

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
# Both 3-letter ("Mon") and full ("Monday") spellings resolve to the full
# name feed_compiler.py's _build_service_rows expects (it upper()s `day`
# straight into Google's DayOfWeek enum, e.g. "MONDAY").
_DAY_ALIASES = {name[:3].lower(): name for name in DAY_NAMES}
_DAY_ALIASES.update({name.lower(): name for name in DAY_NAMES})

# feed_compiler.py's VALID_SERVICE_TYPES is {DELIVERY, TAKEOUT, DINE_IN} --
# maps the free-text spellings aggregator exports actually use onto that enum.
_SERVICE_TYPE_ALIASES = {
    "delivery": "DELIVERY",
    "pickup": "TAKEOUT",
    "pick up": "TAKEOUT",
    "takeout": "TAKEOUT",
    "take out": "TAKEOUT",
    "takeaway": "TAKEOUT",
    "dine in": "DINE_IN",
    "dinein": "DINE_IN",
}

_TIME_RANGE_RE = re.compile(
    r"^([A-Za-z]+)(?:\s*-\s*([A-Za-z]+))?\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$"
)


def _to_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_service_types(raw: Optional[str]) -> Optional[List[str]]:
    if not raw:
        return None
    types: List[str] = []
    for part in str(raw).split(","):
        key = re.sub(r"[^a-z ]+", "", part.strip().lower())
        mapped = _SERVICE_TYPE_ALIASES.get(key)
        if mapped and mapped not in types:
            types.append(mapped)
    return types or None


def _parse_lead_time_minutes(row: Dict[str, Any]) -> Optional[float]:
    """
    Prefers an explicit lead_time_minutes column when present. Otherwise
    reconciles separate delivery/pickup lead-time-in-hours columns (some
    aggregator exports carry these instead of one minutes column) into the
    single lead_time_minutes feed_compiler.py's service feed needs -- takes
    the longer of the two so the quoted lead time is never an under-promise.
    """
    direct = _to_float(row.get("lead_time_minutes"))
    if direct is not None:
        return direct

    hours_values = [
        h for h in (
            _to_float(row.get("delivery_lead_time_hours")),
            _to_float(row.get("pickup_lead_time_hours")),
        ) if h is not None
    ]
    return max(hours_values) * 60 if hours_values else None


def _parse_opening_hours(raw: Optional[str]) -> Optional[List[Dict[str, Any]]]:
    """
    Parses free-text service-hours strings into feed_compiler.py's expected
    opening_hours shape ({day, isOpen, openTime, closeTime} per window).
    Handles a per-day list ("Mon 09:00-17:00; Tue 09:00-17:00"), a day-range
    shorthand ("Mon-Sun 11:00-23:00"), and split shifts (the same day
    appearing more than once, e.g. "Wed 11:00-14:30; Wed 18:00-20:00" --
    both windows are kept). A day never mentioned is simply omitted rather
    than emitted as a fabricated closed entry -- _build_service_rows already
    treats an absent day exactly like isOpen: false.
    """
    if not raw:
        return None
    windows: List[Dict[str, Any]] = []
    for segment in str(raw).split(";"):
        segment = segment.strip()
        if not segment:
            continue
        m = _TIME_RANGE_RE.match(segment)
        if not m:
            continue
        start_day, end_day, open_t, close_t = m.groups()
        start_name = _DAY_ALIASES.get(start_day.strip().lower())
        if not start_name:
            continue

        if end_day:
            end_name = _DAY_ALIASES.get(end_day.strip().lower())
            if not end_name:
                day_names = [start_name]
            else:
                start_idx, end_idx = DAY_NAMES.index(start_name), DAY_NAMES.index(end_name)
                day_names = (
                    DAY_NAMES[start_idx:end_idx + 1] if end_idx >= start_idx
                    else DAY_NAMES[start_idx:] + DAY_NAMES[:end_idx + 1]
                )
        else:
            day_names = [start_name]

        for day_name in day_names:
            windows.append({"day": day_name, "isOpen": True, "openTime": open_t, "closeTime": close_t})

    return windows or None


class MerchantEntity(BaseModel):
    name: str
    address: str
    telephone: Optional[str] = None
    action_link: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    vendor_id: Optional[str] = None
    service_types: Optional[List[str]] = None
    lead_time_minutes: Optional[float] = None
    opening_hours: Optional[List[Dict[str, Any]]] = None


class MenuItem(BaseModel):
    store_id: str
    merchant_name: str
    name: str
    price: float
    category: Optional[str] = None
    description: Optional[str] = None


class MenuRowError(BaseModel):
    row_index: int
    field: str
    message: str


class SpreadsheetFeedParser:
    def parse_merchants(self, file_path: str, org_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Parses restaurant/merchant rows from an uploaded spreadsheet -- a standalone
        upload, independent of menu data (see parse_menu for that; they used to be
        two sheets of one workbook, which forced every aggregator into one specific
        file shape and meant a menu-only re-upload had to carry merchant rows too).

        If `org_id` is given, loads that organization's saved column-mapping adapter
        (so a returning org's export shape is remembered, not re-guessed) and saves
        a newly-inferred one back for next time. Firestore being unreachable
        degrades to always-infer, it never blocks parsing.

        Returns {"merchants": [...], "errors": [...], "adapter": {...}} -- a row with
        a missing required field shows up in `errors`, not silently dropped or guessed at.
        """
        try:
            # dtype=str throughout: without it, pandas auto-infers numeric-looking
            # columns (phone numbers, postal codes with leading zeros) as floats,
            # silently mangling "+15551234" into "15551234.0" -- wrong data reaching
            # Google's feed is worse than the minor inconvenience of parsing prices
            # as strings and casting them explicitly where needed (parse_menu).
            if file_path.endswith('.csv'):
                df_merchants = pd.read_csv(file_path, dtype=str)
            else:
                df_merchants = pd.read_excel(file_path, sheet_name=0, dtype=str)
        except Exception as e:
            raise Exception(f"Failed to read spreadsheet: {e}")

        adapter = self._get_or_infer_adapter(df_merchants.columns.tolist(), org_id)
        rows, validation_errors = validate_and_transform(df_merchants, adapter)

        for row in rows:
            row["latitude"] = _to_float(row.get("latitude"))
            row["longitude"] = _to_float(row.get("longitude"))
            row["service_types"] = _parse_service_types(row.get("service_types"))
            row["opening_hours"] = _parse_opening_hours(row.pop("service_hours", None))
            row["lead_time_minutes"] = _parse_lead_time_minutes(row)
            row.pop("delivery_lead_time_hours", None)
            row.pop("pickup_lead_time_hours", None)

        merchants = [MerchantEntity(**row) for row in rows]

        return {
            "merchants": merchants,
            "errors": [e.model_dump() for e in validation_errors],
            "adapter": adapter.model_dump(),
        }

    def parse_menu(self, file_path: str, org_id: str) -> Dict[str, Any]:
        """
        Parses menu item rows from a standalone spreadsheet -- one row per dish,
        identified by a merchant-name column rather than a foreign key an
        aggregator's export is unlikely to carry. Each item's store_id is computed
        with the exact same slugify_store_id(org_id, name) the restaurant upload
        path uses (see _persist_bulk_merchant), so items land on the same merchant
        document a restaurant upload for that name already created (or will).

        Returns {"items": [...], "errors": [...]} -- a row missing its item name
        or a parseable price shows up in errors, never silently dropped or
        defaulted to a fabricated price.
        """
        try:
            if file_path.endswith('.csv'):
                df = pd.read_csv(file_path, dtype=str)
            else:
                df = pd.read_excel(file_path, sheet_name=0, dtype=str)
        except Exception as e:
            raise Exception(f"Failed to read spreadsheet: {e}")

        return self._parse_menu_rows(df, org_id)

    def _get_or_infer_adapter(self, columns: List[str], org_id: Optional[str]) -> DataSourceAdapter:
        if org_id:
            try:
                from backend.db.firestore_client import OrganizationRepository
                saved = OrganizationRepository().get_adapter(org_id)
                if saved:
                    return DataSourceAdapter(**saved)
            except Exception as e:
                logger.warning(f"Could not load saved adapter for org '{org_id}' ({e}); inferring instead.")

        adapter = infer_adapter(columns, org_id or "unknown")

        if org_id:
            try:
                from backend.db.firestore_client import OrganizationRepository
                OrganizationRepository().save_adapter(org_id, adapter.model_dump())
            except Exception as e:
                logger.warning(f"Could not persist inferred adapter for org '{org_id}': {e}")

        return adapter

    def _parse_menu_rows(self, df: pd.DataFrame, org_id: str) -> Dict[str, Any]:
        name_col = next((c for c in df.columns if c.lower() in ['merchant name', 'restaurant', 'store', 'restaurant name']), None)
        item_col = next((c for c in df.columns if c.lower() in ['item name', 'name', 'dish', 'menu item']), None)
        price_col = next((c for c in df.columns if c.lower() in ['price', 'cost']), None)
        category_col = next((c for c in df.columns if c.lower() in ['category', 'section', 'course']), None)
        desc_col = next((c for c in df.columns if c.lower() in ['description', 'desc', 'details']), None)

        items: List[MenuItem] = []
        errors: List[MenuRowError] = []

        if not name_col:
            errors.append(MenuRowError(row_index=-1, field="merchant_name",
                                        message="No merchant-identifying column found (expected one of: Merchant Name, Restaurant, Store)."))
        if not item_col:
            errors.append(MenuRowError(row_index=-1, field="name",
                                        message="No item-name column found (expected one of: Item Name, Name, Dish, Menu Item)."))
        if not price_col:
            errors.append(MenuRowError(row_index=-1, field="price",
                                        message="No price column found (expected one of: Price, Cost)."))
        if not name_col or not item_col or not price_col:
            return {"items": items, "errors": [e.model_dump() for e in errors]}

        for i, row in df.iterrows():
            merchant_name = str(row[name_col]).strip() if pd.notnull(row[name_col]) else ""
            item_name = str(row[item_col]).strip() if pd.notnull(row[item_col]) else ""
            raw_price = row[price_col]

            if not merchant_name:
                errors.append(MenuRowError(row_index=i, field="merchant_name", message="Merchant name is required."))
                continue
            if not item_name:
                errors.append(MenuRowError(row_index=i, field="name", message="Item name is required."))
                continue
            try:
                price = float(raw_price) if pd.notnull(raw_price) else None
                if price is None:
                    raise ValueError("missing")
            except (TypeError, ValueError):
                errors.append(MenuRowError(row_index=i, field="price", message=f"'{raw_price}' is not a valid price."))
                continue

            items.append(MenuItem(
                store_id=slugify_store_id(org_id, merchant_name),
                merchant_name=merchant_name,
                name=item_name,
                price=price,
                category=(str(row[category_col]).strip() if category_col and pd.notnull(row[category_col]) else None),
                description=(str(row[desc_col]).strip() if desc_col and pd.notnull(row[desc_col]) else None),
            ))

        return {"items": items, "errors": [e.model_dump() for e in errors]}
