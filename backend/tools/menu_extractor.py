import os
from typing import List, Optional
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

class MenuItem(BaseModel):
    name: str = Field(description="Name of the menu item")
    description: Optional[str] = Field(None, description="Description of the item")
    dietary_flags: List[str] = Field(default_factory=list, description="List of dietary flags like Vegetarian, Vegan, Halal, Gluten-Free")
    price_micros: int = Field(description="Price in integer micros (e.g., $12.50 -> 12500000)")
    currency_code: str = Field(description="3-letter currency code (e.g., USD, INR)")
    options: List[str] = Field(default_factory=list, description="Option groups/modifiers like Size: Small/Large, Spice Level: Mild/Hot")

class MenuSection(BaseModel):
    name: str = Field(description="Name of the section/category (e.g., Starters, Mains, Beverages)")
    items: List[MenuItem] = Field(description="List of menu items in this section")

class MenuData(BaseModel):
    sections: List[MenuSection] = Field(description="List of menu sections")

class ImageMenuExtractor:
    def __init__(self):
        # Assumes GEMINI_API_KEY is in environment
        self.client = genai.Client()

    def extract_from_file(self, file_path: str) -> MenuData:
        try:
            with open(file_path, "rb") as f:
                image_bytes = f.read()
            return self.extract_from_bytes(image_bytes, os.path.splitext(file_path)[1].lower().strip('.'))
        except Exception as e:
            raise Exception(f"Failed to read image file: {e}")

    def extract_from_bytes(self, image_bytes: bytes, mime_type_suffix: str) -> MenuData:
        mime_type = f"image/{mime_type_suffix}"
        if mime_type_suffix == "pdf":
            mime_type = "application/pdf"
            
        prompt = """
        Extract the menu details from the provided image or PDF.
        Identify sections/categories (e.g., "Starters", "Mains").
        For each item, extract the name, description, and any dietary flags (Vegetarian, Vegan, Halal, Gluten-Free).
        Parse prices: convert amounts to integer micros (e.g., $12.50 becomes 12500000) and identify the currency code (e.g., USD).
        Identify option groups or modifiers (e.g., Size: Small/Large).
        """
        
        response = self.client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                prompt
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=MenuData,
            )
        )
        return response.parsed
