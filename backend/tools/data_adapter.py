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

import re
from typing import Any, Dict, List, Tuple

import pandas as pd
from pydantic import BaseModel

REQUIRED_CANONICAL_FIELDS = {"name", "address"}
OPTIONAL_CANONICAL_FIELDS = {"telephone", "action_link"}

# Known column-name aliases per canonical field, matched case-insensitively
# after collapsing punctuation/whitespace.
FIELD_ALIASES: Dict[str, List[str]] = {
    "name": ["name", "store name", "restaurant", "restaurant name", "merchant name", "business name"],
    "address": ["address", "street", "address 1", "location", "full address"],
    "telephone": ["telephone", "phone", "phone number", "contact number"],
    "action_link": ["action link", "order url", "order link", "website", "ordering url"],
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


def infer_adapter(columns: List[str], org_id: str) -> DataSourceAdapter:
    """Best-effort column mapping from known aliases. Missing required fields
    are left unmapped rather than guessed -- validate_and_transform will then
    surface a clear file-level error instead of silently misreading a column."""
    normalized = {col: _normalize(col) for col in columns}
    mappings: Dict[str, str] = {}
    for canonical, aliases in FIELD_ALIASES.items():
        for col, norm in normalized.items():
            if norm in aliases:
                mappings[canonical] = col
                break
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
