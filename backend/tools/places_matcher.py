import os
import httpx
from typing import Dict, Any, Optional
from google import genai
from google.genai import types

class GooglePlacesClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("GOOGLE_PLACES_API_KEY")
        self.base_url = "https://places.googleapis.com/v1/places:searchText"

    async def search_places(self, query: str) -> Dict[str, Any]:
        if not self.api_key:
            return self._mock_search_places(query)
            
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.regularOpeningHours,places.businessStatus"
        }
        
        payload = {
            "textQuery": query
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(self.base_url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()
            
    def _mock_search_places(self, query: str) -> Dict[str, Any]:
        return {
            "places": [
                {
                    "id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
                    "displayName": {"text": f"Mock Place for {query}"},
                    "formattedAddress": "123 Mock St, Mock City",
                    "location": {"latitude": 37.422, "longitude": -122.084},
                    "businessStatus": "OPERATIONAL"
                }
            ]
        }

def verify_storefront_multimodal(store_image_path: str, streetview_image_path: str) -> Dict[str, Any]:
    client = genai.Client()
    
    # In a real scenario, you'd upload these files or pass them if small enough
    # Here we assume the paths are accessible by the genai SDK.
    try:
        store_file = client.files.upload(file=store_image_path)
        street_file = client.files.upload(file=streetview_image_path)
        
        prompt = (
            "Compare these two images: the first is a store image provided by a merchant, "
            "and the second is a Street View image. "
            "Verify if they show the same storefront. Analyze visual signage, logos, and features. "
            "Provide a match score from 0.0 to 1.0 and a reasoning string. "
            "Output as JSON with keys 'score' and 'reasoning'."
        )
        
        response = client.models.generate_content(
            model='gemini-3.6-flash',
            contents=[store_file, street_file, prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        import json
        if response.text:
            return json.loads(response.text)
        return {"score": 0.0, "reasoning": "Failed to generate response"}
        
    except Exception as e:
        return {"score": 0.0, "reasoning": f"Error during verification: {str(e)}"}

def generate_gbp_draft(merchant_data: Dict[str, Any]) -> Dict[str, Any]:
    # Extracts basic info to form a GBP draft payload
    return {
        "primaryCategory": merchant_data.get("category", "restaurant"),
        "standardizedAddress": {
            "addressLines": [merchant_data.get("address", "")],
            "postalCode": merchant_data.get("postal_code", ""),
            "locality": merchant_data.get("city", ""),
            "administrativeArea": merchant_data.get("state", ""),
            "regionCode": merchant_data.get("country", "US")
        },
        "operatingHours": merchant_data.get("hours", {}),
        "coordinates": {
            "latitude": merchant_data.get("lat", 0.0),
            "longitude": merchant_data.get("lng", 0.0)
        }
    }
