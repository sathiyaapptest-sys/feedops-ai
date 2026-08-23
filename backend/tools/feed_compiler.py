import json
import os
from typing import Dict, List, Any
from datetime import datetime

class ActionsCenterFeedCompiler:
    def __init__(self, output_dir: str = "feeds_output"):
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)
        
    def compile_feeds(self, merchant_data_list: List[Dict[str, Any]]) -> Dict[str, str]:
        """
        Compiles staged merchant data into official Google Actions Center monolithic JSON files.
        """
        timestamp = int(datetime.utcnow().timestamp())
        
        # Initialize feed structures
        entity_feed = []
        service_feed = []
        action_feed = []
        menu_feed = []
        
        for merchant in merchant_data_list:
            place_id = merchant.get("place_id", f"mock_place_{merchant.get('id', '')}")
            entity_id = merchant.get("entity_id", f"entity_{place_id}")
            
            # 1. Entity
            entity_feed.append({
                "@type": "Restaurant",
                "@id": entity_id,
                "name": merchant.get("name", "Unknown Restaurant"),
                "address": merchant.get("address", {}),
                "geo": merchant.get("geo", {}),
                "openingHours": merchant.get("opening_hours", [])
            })
            
            # 2. Service
            service_id = f"service_{entity_id}"
            service_feed.append({
                "@type": "FoodEstablishment",
                "@id": service_id,
                "provider": {"@id": entity_id},
                "serviceType": merchant.get("service_type", ["TAKEOUT"]),
                "serviceArea": merchant.get("service_area", {})
            })
            
            # 3. Action
            action_feed.append({
                "@type": "OrderAction",
                "provider": {"@id": entity_id},
                "service": {"@id": service_id},
                "actionLink": {
                    "url": f"https://example.com/order/{entity_id}?rwg_token=",
                    "actionMetadata": {
                        "isThirdParty": True
                    }
                }
            })
            
            # 4. Menu
            if "menu" in merchant:
                menu_feed.append({
                    "@type": "Menu",
                    "provider": {"@id": entity_id},
                    "menuSection": merchant["menu"].get("sections", [])
                })
        
        # Write feeds to files
        feeds_generated = {}
        
        feeds = {
            "google.food_entity": entity_feed,
            "google.food_service": service_feed,
            "google.food_action": action_feed,
            "google.food_menu": menu_feed
        }
        
        for feed_name, feed_data in feeds.items():
            if not feed_data:
                continue
            
            # Write data file
            data_file_path = os.path.join(self.output_dir, f"{feed_name}-{timestamp}.json")
            with open(data_file_path, "w") as f:
                for item in feed_data:
                    f.write(json.dumps(item) + "\n")
            
            # Write descriptor file
            desc_file_path = os.path.join(self.output_dir, f"{feed_name}-{timestamp}.filesetdesc.json")
            with open(desc_file_path, "w") as f:
                descriptor = {
                    "generation_timestamp": timestamp,
                    "name": feed_name,
                    "record_count": len(feed_data)
                }
                f.write(json.dumps(descriptor, indent=2))
                
            feeds_generated[feed_name] = data_file_path
            
        return feeds_generated
