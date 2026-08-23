import os
import re
import difflib
import httpx
from typing import Dict, Any, Optional
from google import genai
from google.genai import types

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")


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
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.regularOpeningHours,places.businessStatus,places.internationalPhoneNumber"
        }
        
        payload = {
            "textQuery": query
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(self.base_url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()
            
    def _mock_search_places(self, query: str) -> Dict[str, Any]:
        if query == "ChIJieatS2VjUzoRcxdYOKeD2mw":
            return {
                "places": [
                    {
                        "id": "ChIJieatS2VjUzoRcxdYOKeD2mw",
                        "displayName": {"text": "THE SPOT"},
                        "formattedAddress": "37, Dumas St, White Town, Puducherry 605001",
                        "internationalPhoneNumber": "+91 98765 43210",
                        "location": {"latitude": 11.9314, "longitude": 79.8339},
                        "businessStatus": "OPERATIONAL",
                        "regularOpeningHours": {
                            "periods": [
                                {"open": {"day": 1, "hour": 10, "minute": 0}, "close": {"day": 1, "hour": 22, "minute": 30}},
                                {"open": {"day": 2, "hour": 10, "minute": 0}, "close": {"day": 2, "hour": 22, "minute": 30}},
                                {"open": {"day": 3, "hour": 10, "minute": 0}, "close": {"day": 3, "hour": 22, "minute": 30}},
                                {"open": {"day": 4, "hour": 10, "minute": 0}, "close": {"day": 4, "hour": 22, "minute": 30}},
                                {"open": {"day": 5, "hour": 10, "minute": 0}, "close": {"day": 5, "hour": 22, "minute": 30}},
                                {"open": {"day": 6, "hour": 10, "minute": 0}, "close": {"day": 6, "hour": 22, "minute": 30}},
                                {"open": {"day": 0, "hour": 10, "minute": 0}, "close": {"day": 0, "hour": 22, "minute": 30}}
                            ]
                        }
                    }
                ]
            }

        return {
            "places": [
                {
                    "id": "ChIJN1t_tDeuEmsRUsoyG83frY4" if query != "test" else "test",
                    "displayName": {"text": f"Mock Place for {query}"},
                    "formattedAddress": "123 Mock St, Mock City",
                    "internationalPhoneNumber": "+1 555-123-4567",
                    "location": {"latitude": 37.422, "longitude": -122.084},
                    "businessStatus": "OPERATIONAL",
                    "regularOpeningHours": {
                        "periods": [
                            {"open": {"day": 1, "hour": 9, "minute": 0}, "close": {"day": 1, "hour": 22, "minute": 0}},
                            {"open": {"day": 2, "hour": 9, "minute": 0}, "close": {"day": 2, "hour": 22, "minute": 0}},
                            {"open": {"day": 3, "hour": 9, "minute": 0}, "close": {"day": 3, "hour": 22, "minute": 0}},
                            {"open": {"day": 4, "hour": 9, "minute": 0}, "close": {"day": 4, "hour": 22, "minute": 0}},
                            {"open": {"day": 5, "hour": 9, "minute": 0}, "close": {"day": 5, "hour": 23, "minute": 0}},
                            {"open": {"day": 6, "hour": 10, "minute": 0}, "close": {"day": 6, "hour": 23, "minute": 0}}
                        ]
                    }
                }
            ]
        }

def _name_similarity(a: str, b: str) -> float:
    normalize = lambda s: re.sub(r"[^a-z0-9 ]", "", (s or "").lower()).strip()
    return difflib.SequenceMatcher(None, normalize(a), normalize(b)).ratio()


async def resolve_entity_match(name: str, address: str) -> Dict[str, Any]:
    """
    Resolves a merchant name+address against Google Places and scores confidence by
    comparing the input against the top candidate's name and address.

    This is a lightweight baseline heuristic (string similarity), not Google's own
    internal entity-matching algorithm -- treat the confidence score as indicative,
    not authoritative, and route low/zero-confidence results to human review or a
    Google Business Profile draft rather than trusting it blindly.
    """
    client = GooglePlacesClient()
    result = await client.search_places(f"{name} {address}".strip())
    candidates = result.get("places", [])
    if not candidates:
        return {"confidence": 0.0, "place_id": None, "candidate": None}

    top = candidates[0]
    candidate_name = top.get("displayName", {}).get("text", "")
    candidate_address = top.get("formattedAddress", "")

    confidence = round(
        (_name_similarity(name, candidate_name) * 0.7)
        + (_name_similarity(address, candidate_address) * 0.3),
        2,
    )

    return {
        "confidence": confidence,
        "place_id": top.get("id"),
        "name": candidate_name,
        "address": candidate_address,
        "business_status": top.get("businessStatus"),
        "candidate": top,
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
            model=GEMINI_MODEL,
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
