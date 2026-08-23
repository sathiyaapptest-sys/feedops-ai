import pandas as pd
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

class MerchantEntity(BaseModel):
    name: str
    address: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    telephone: Optional[str] = None

class MenuItem(BaseModel):
    merchant_name: str
    item_name: str
    price: float
    description: Optional[str] = None

class SpreadsheetFeedParser:
    def parse(self, file_path: str) -> Dict[str, List[Any]]:
        try:
            if file_path.endswith('.csv'):
                df_merchants = pd.read_csv(file_path)
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
                
                df_merchants = pd.read_excel(xls, sheet_name=merchant_sheet)
                df_menus = pd.read_excel(xls, sheet_name=menu_sheet) if menu_sheet else None

        except Exception as e:
            raise Exception(f"Failed to read spreadsheet: {e}")

        merchants = self._parse_merchants(df_merchants)
        menus = self._parse_menus(df_menus) if df_menus is not None else []
        
        return {
            "merchants": merchants,
            "menus": menus
        }

    def _parse_merchants(self, df: pd.DataFrame) -> List[MerchantEntity]:
        merchants = []
        
        # Fuzzy matching for columns
        name_col = next((c for c in df.columns if c.lower() in ['store name', 'restaurant', 'name']), None)
        addr_col = next((c for c in df.columns if c.lower() in ['street', 'address 1', 'address', 'location']), None)
        
        if not name_col or not addr_col:
            raise ValueError("Spreadsheet must contain a Name and Address column for merchants.")
            
        for _, row in df.iterrows():
            name = str(row[name_col])
            address = str(row[addr_col])
            
            # Simple mock: automatically calculating lat/lng geocodes if missing via places_matcher
            # In a real environment, this would call out to backend.tools.places_matcher
            entity = MerchantEntity(name=name, address=address)
            merchants.append(entity)
            
        return merchants

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
