import os
import re
import difflib
import httpx
from typing import Dict, Any, Optional
from google import genai
from google.genai import types

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")


class GooglePlacesClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("GOOGLE_PLACES_API_KEY")
        self.base_url = "https://places.googleapis.com/v1/places:searchText"

    async def search_places(self, query: str) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("GOOGLE_PLACES_API_KEY is not configured.")

        # If query is a Google Place ID, fetch directly via official Place Details API
        if query.startswith("ChIJ"):
            url = f"https://places.googleapis.com/v1/places/{query}"
            headers = {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": self.api_key,
                "X-Goog-FieldMask": "id,displayName,formattedAddress,location,regularOpeningHours,businessStatus,internationalPhoneNumber"
            }
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers)
                if response.status_code == 200:
                    return {"places": [response.json()]}
                return {"places": []}

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
    try:
        result = await client.search_places(f"{name} {address}".strip())
    except Exception as e:
        return {"confidence": 0.0, "place_id": None, "candidate": None, "error": str(e)}

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


from backend.tools.model_cascade import generate_content_with_cascade

def verify_storefront_multimodal(store_image_path: str, streetview_image_path: str) -> Dict[str, Any]:
    client = genai.Client()
    
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
        
        text, _ = generate_content_with_cascade(
            client=client,
            contents=[store_file, street_file, prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
            vision_only=True,
        )
        import json
        if text:
            return json.loads(text)
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
