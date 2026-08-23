import json
# mcp>=2.0 renamed the high-level server helper from mcp.server.fastmcp.FastMCP
# to mcp.server.mcpserver.MCPServer; aliased here so the rest of this file is unchanged.
from mcp.server.mcpserver import MCPServer as FastMCP
from typing import Dict, Any, List
from pydantic import BaseModel, Field

# Import our tools
from backend.tools.places_matcher import GooglePlacesClient, verify_storefront_multimodal, generate_gbp_draft
from backend.tools.feed_compiler import ActionsCenterFeedCompiler
from backend.tools.conversion_sentry import ConversionSentryTool
from backend.tools.sftp_uploader import GoogleSFTPClient
from backend.tools.menu_extractor import ImageMenuExtractor
from backend.tools.excel_parser import SpreadsheetFeedParser

# Initialize FastMCP Server
mcp = FastMCP("feedops-tools")

# Pydantic Schemas for inputs
class SearchPlacesInput(BaseModel):
    query: str = Field(description="The search query for Google Places API")

class VerifyStorefrontInput(BaseModel):
    store_image_path: str = Field(description="Local path to the store image")
    streetview_image_path: str = Field(description="Local path to the street view image")

class CreateGbpDraftInput(BaseModel):
    merchant_data: Dict[str, Any] = Field(description="Dictionary containing merchant details like name, address, category")

class CompileFeedsInput(BaseModel):
    merchant_data_list: List[Dict[str, Any]] = Field(description="List of merchant data dictionaries to compile into feeds")

class DispatchConversionPingInput(BaseModel):
    environment: str = Field(default="sandbox", description="Environment to ping: 'sandbox' or 'production'")

class UploadFeedsInput(BaseModel):
    feed_files: List[str] = Field(description="List of paths to feed files to upload")
    dry_run: bool = Field(default=False, description="If True, simulates the upload without connecting to SFTP")


@mcp.tool()
async def search_places(query: str) -> Dict[str, Any]:
    """Search Google Places API for a given query."""
    client = GooglePlacesClient()
    return await client.search_places(query)

@mcp.tool()
def verify_storefront(store_image_path: str, streetview_image_path: str) -> Dict[str, Any]:
    """Verify if a store image matches a street view image using Gemini Vision."""
    return verify_storefront_multimodal(store_image_path, streetview_image_path)

@mcp.tool()
def generate_gbp_record(merchant_name: str, address: str) -> str:
    """Drafts a missing Google Business Profile record to unblock matching."""
    draft = generate_gbp_draft({"name": merchant_name, "address": address})
    return json.dumps(draft)

@mcp.tool()
def extract_menu_from_image(file_path: str) -> str:
    """Extract structured menu JSON from a printed menu image/PDF."""
    extractor = ImageMenuExtractor()
    try:
        data = extractor.extract_from_file(file_path)
        return data.model_dump_json()
    except Exception as e:
        return str(e)

@mcp.tool()
def parse_spreadsheet_to_feed(file_path: str) -> str:
    """Parse merchants and menus from an Excel/CSV spreadsheet."""
    parser = SpreadsheetFeedParser()
    try:
        data = parser.parse(file_path)
        return f"Parsed {len(data['merchants'])} merchants and {len(data['menus'])} menu items."
    except Exception as e:
        return str(e)

@mcp.tool()
def compile_feeds(merchant_data_list: list) -> Dict[str, str]:
    """Compile merchant data into Google Actions Center feeds."""
    compiler = ActionsCenterFeedCompiler()
    return compiler.compile_feeds(merchant_data_list)

@mcp.tool()
async def dispatch_conversion_ping(environment: str = "sandbox") -> Dict[str, Any]:
    """Dispatch synthetic conversion POST requests to endpoints."""
    sentry = ConversionSentryTool()
    return await sentry.dispatch_conversion_ping(environment)

@mcp.tool()
def upload_feeds_sftp(feed_files: list, dry_run: bool = False) -> Dict[str, Any]:
    """Upload compiled feed files via SFTP to Google Partner Upload."""
    uploader = GoogleSFTPClient(dry_run=dry_run)
    return uploader.upload_feeds(feed_files)

if __name__ == "__main__":
    mcp.run(transport="stdio")
