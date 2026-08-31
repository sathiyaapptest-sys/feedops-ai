"""
FeedOps AI - Per-organization data source adapters.

Different merchants/aggregators export merchant data in different shapes: a
POS export, a Google Sheet, a CSV with locale-specific column names. Rather
than silently guess (the old excel_parser.py behavior -- fuzzy-match a column
name and hope), this module infers a best-effort adapter, lets it be saved
per organization (see backend.db.firestore_client.OrganizationRepository) so
it's remembered and reused on the next upload instead of re-guessed every
time, and validates every row against it with clear, structured per-row
errors instead of skipping or fabricating data.
"""

import logging
import os
import re
from typing import Any, Dict, List, Tuple

import pandas as pd
from google import genai
from google.genai import types as genai_types
from pydantic import BaseModel

logger = logging.getLogger("feedops.data_adapter")

GEMMA_MODEL = os.getenv("GEMMA_MODEL", "gemma-4-26b-a4b-it")

def slugify_store_id(org_id: str, name: str) -> str:
    """
    Deterministic store_id for a bulk-uploaded merchant. Shared by every bulk
    ingestion path (restaurant rows, menu rows) so a menu spreadsheet -- a
    separate upload, possibly from a separate source system -- lands on the
    exact same merchant document a restaurant spreadsheet created, without
    needing the aggregator to invent and pass around an id column by hand.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "merchant"
    return f"{org_id}_{slug}"


REQUIRED_CANONICAL_FIELDS = {"name", "address"}
# service_hours/lead_time/service_types feed the service feed (see
# feed_compiler.py's _build_service_rows); delivery/pickup lead time in hours
# is a separate pair of columns some aggregator exports use instead of one
# lead_time_minutes column -- excel_parser.py's post-processing reconciles
# whichever of the two shows up into the single lead_time_minutes the
# compiler expects. All optional: a merchant missing any of these still gets
# an entity + action feed row, just no service feed row (feed_compiler.py's
# existing "omit, don't invent" rule).
OPTIONAL_CANONICAL_FIELDS = {
    "telephone", "action_link", "vendor_id", "latitude", "longitude",
    "service_types", "lead_time_minutes", "delivery_lead_time_hours",
    "pickup_lead_time_hours", "service_hours",
}

# Known column-name aliases per canonical field, matched case-insensitively
# after collapsing punctuation/whitespace.
FIELD_ALIASES: Dict[str, List[str]] = {
    "name": ["name", "store name", "restaurant", "restaurant name", "merchant name", "business name"],
    "address": ["address", "street", "address 1", "location", "full address"],
    "telephone": ["telephone", "phone", "phone number", "contact number"],
    "action_link": [
        "action link", "order url", "order link", "website", "ordering url",
        "action url", "action_url", "store url", "store link", "landing page", "checkout url"
    ],
    "vendor_id": ["vendor id", "external id", "external vendor id", "pos id", "source id"],
    "latitude": ["latitude", "lat"],
    "longitude": ["longitude", "lng", "long"],
    "service_types": [
        "service types", "service type", "ordering types", "ordering type",
        "fulfillment types", "fulfillment type"
    ],
    "lead_time_minutes": ["lead time minutes", "lead time (minutes)", "leadtime minutes"],
    "delivery_lead_time_hours": ["delivery lead time hrs", "delivery lead time hours", "delivery lead time"],
    "pickup_lead_time_hours": ["pickup lead time hrs", "pickup lead time hours", "pickup lead time"],
    "service_hours": ["service hours", "hours", "opening hours", "business hours"],
}


class DataSourceAdapter(BaseModel):
    """A saved column mapping for one organization's data source."""
    org_id: str
    field_mappings: Dict[str, str]  # canonical_field -> source_column

    def missing_required_fields(self) -> List[str]:
        return sorted(f for f in REQUIRED_CANONICAL_FIELDS if f not in self.field_mappings)


class ValidationError(BaseModel):
    row_index: int  # -1 for a file-level error (e.g. no column found at all)
    field: str
    message: str


def _normalize(column_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", column_name.lower()).strip()


class _ColumnMatch(BaseModel):
    canonical_field: str
    column_name: str


class _ColumnMatchList(BaseModel):
    matches: List[_ColumnMatch]


def _infer_unmapped_fields_with_gemma(unmapped_fields: List[str], leftover_columns: List[str]) -> Dict[str, str]:
    """
    Best-effort semantic column match for canonical fields the exact-alias
    table above missed (e.g. a column named "Outlet" or "Trading As" instead
    of any known alias). Gemma is the right-sized model for this -- it's a
    small, low-stakes text-matching task, not worth a full Gemini call.

    Uses response_schema (not just response_mime_type) because unconstrained
    JSON mode is inconsistent about shape on a model this size -- observed it
    return a bare {field: column} dict, a list of {field: column} dicts, and
    a list of {"canonical_field", "column_name"} dicts across otherwise
    identical calls. A pydantic response_schema forces one shape reliably.

    Never guesses past what it's told to consider: only `unmapped_fields` and
    `leftover_columns` are offered, and the result is filtered back down to
    that same set, so a hallucinated field/column name can't sneak into the
    adapter. Never raises -- an empty return is treated exactly like "still
    unmapped" by the caller, and validate_and_transform's existing
    missing-required-field error is the fallback, not a crash.
    """
    if not unmapped_fields or not leftover_columns:
        return {}
    prompt = (
        "Match each spreadsheet column to at most one canonical field. Only include a "
        "match you're confident about; skip a field entirely rather than guess. "
        f"Canonical fields needing a match: {unmapped_fields}. "
        f"Available columns: {leftover_columns}."
    )
    try:
        client = genai.Client()
        response = client.models.generate_content(
            model=GEMMA_MODEL,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json", response_schema=_ColumnMatchList
            ),
        )
        matches = response.parsed.matches if response.parsed else []
        return {
            m.canonical_field: m.column_name for m in matches
            if m.canonical_field in unmapped_fields and m.column_name in leftover_columns
        }
    except Exception as e:
        logger.warning(f"Gemma column-matching unavailable ({e}); falling back to unmapped.")
        return {}


def infer_adapter(columns: List[str], org_id: str) -> DataSourceAdapter:
    """Best-effort column mapping: exact known aliases first, then Gemma for
    whatever's left over. Fields Gemma also can't place stay unmapped --
    validate_and_transform will then surface a clear file-level error instead
    of silently misreading a column."""
    normalized = {col: _normalize(col) for col in columns}
    mappings: Dict[str, str] = {}
    for canonical, aliases in FIELD_ALIASES.items():
        for col, norm in normalized.items():
            if norm in aliases:
                mappings[canonical] = col
                break

    still_needed = [f for f in (REQUIRED_CANONICAL_FIELDS | OPTIONAL_CANONICAL_FIELDS) if f not in mappings]
    leftover_columns = [c for c in columns if c not in mappings.values()]
    if still_needed:
        gemma_mappings = _infer_unmapped_fields_with_gemma(still_needed, leftover_columns)
        if gemma_mappings:
            logger.info(f"Gemma matched columns for org '{org_id}': {gemma_mappings}")
        mappings.update(gemma_mappings)

    return DataSourceAdapter(org_id=org_id, field_mappings=mappings)


def validate_and_transform(
    df: "pd.DataFrame", adapter: DataSourceAdapter
) -> Tuple[List[Dict[str, Any]], List[ValidationError]]:
    """
    Validates every row against `adapter` and returns (valid_rows, errors).
    A row with any required-field error is excluded from valid_rows entirely
    -- partial/wrong data never silently enters the pipeline.
    """
    missing = adapter.missing_required_fields()
    if missing:
        return [], [
            ValidationError(
                row_index=-1, field=field,
                message=f"No column mapped to required field '{field}'. Update the adapter's field_mappings.",
            )
            for field in missing
        ]

    rows: List[Dict[str, Any]] = []
    errors: List[ValidationError] = []

    for idx, row in df.iterrows():
        record: Dict[str, Any] = {}
        row_errors: List[ValidationError] = []

        for field in REQUIRED_CANONICAL_FIELDS:
            col = adapter.field_mappings[field]
            value = row.get(col)
            if pd.isna(value) or str(value).strip() == "":
                row_errors.append(ValidationError(
                    row_index=int(idx), field=field, message=f"'{field}' is required but empty."
                ))
            else:
                record[field] = str(value).strip()

        for field in OPTIONAL_CANONICAL_FIELDS:
            col = adapter.field_mappings.get(field)
            if col and col in row.index and not pd.isna(row[col]):
                record[field] = str(row[col]).strip()

        if row_errors:
            errors.extend(row_errors)
        else:
            rows.append(record)

    return rows, errors
