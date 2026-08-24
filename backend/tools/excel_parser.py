import logging
from typing import Any, Dict, List, Optional

import pandas as pd
from pydantic import BaseModel

from backend.tools.data_adapter import DataSourceAdapter, infer_adapter, validate_and_transform

logger = logging.getLogger("feedops.excel_parser")


class MerchantEntity(BaseModel):
    name: str
    address: str
    telephone: Optional[str] = None
    action_link: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class MenuItem(BaseModel):
    merchant_name: str
    item_name: str
    price: float
    description: Optional[str] = None


class SpreadsheetFeedParser:
    def parse(self, file_path: str, org_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Parses merchants + menus from an uploaded spreadsheet. If `org_id` is given,
        loads that organization's saved column-mapping adapter (so a returning org's
        export shape is remembered, not re-guessed) and saves a newly-inferred one
        back for next time. Firestore being unreachable degrades to always-infer,
        it never blocks parsing.

        Returns {"merchants": [...], "menus": [...], "errors": [...], "adapter": {...}}
        -- unlike the old fuzzy-matching version, a row with a missing required field
        shows up in `errors`, not silently dropped or guessed at.
        """
        try:
            # dtype=str throughout: without it, pandas auto-infers numeric-looking
            # columns (phone numbers, postal codes with leading zeros) as floats,
            # silently mangling "+15551234" into "15551234.0" -- wrong data reaching
            # Google's feed is worse than the minor inconvenience of parsing prices
            # as strings and casting them explicitly where needed (_parse_menus).
            if file_path.endswith('.csv'):
                df_merchants = pd.read_csv(file_path, dtype=str)
                df_menus = None
            else:
                xls = pd.ExcelFile(file_path)
                merchant_sheet = xls.sheet_names[0]
                menu_sheet = xls.sheet_names[1] if len(xls.sheet_names) > 1 else None

                for s in xls.sheet_names:
                    if 'merchant' in s.lower():
                        merchant_sheet = s
                    elif 'menu' in s.lower() or 'item' in s.lower():
                        menu_sheet = s

                df_merchants = pd.read_excel(xls, sheet_name=merchant_sheet, dtype=str)
                df_menus = pd.read_excel(xls, sheet_name=menu_sheet, dtype=str) if menu_sheet else None

        except Exception as e:
            raise Exception(f"Failed to read spreadsheet: {e}")

        adapter = self._get_or_infer_adapter(df_merchants.columns.tolist(), org_id)
        rows, validation_errors = validate_and_transform(df_merchants, adapter)
        merchants = [MerchantEntity(**row) for row in rows]

        menus = self._parse_menus(df_menus) if df_menus is not None else []

        return {
            "merchants": merchants,
            "menus": menus,
            "errors": [e.model_dump() for e in validation_errors],
            "adapter": adapter.model_dump(),
        }

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

    def _parse_menus(self, df: pd.DataFrame) -> List[MenuItem]:
        menus = []
        name_col = next((c for c in df.columns if c.lower() in ['merchant name', 'restaurant', 'store']), None)
        item_col = next((c for c in df.columns if c.lower() in ['item name', 'name', 'dish']), None)
        price_col = next((c for c in df.columns if c.lower() in ['price', 'cost']), None)

        if not item_col or not price_col:
            return menus

        for _, row in df.iterrows():
            merchant = str(row[name_col]) if name_col else "Unknown"
            item = str(row[item_col])
            price = float(row[price_col]) if pd.notnull(row[price_col]) else 0.0

            menus.append(MenuItem(merchant_name=merchant, item_name=item, price=price))

        return menus
