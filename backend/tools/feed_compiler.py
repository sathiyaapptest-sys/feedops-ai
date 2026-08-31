"""
FeedOps AI - Actions Center Feed Compiler

Emits the real Google Actions Center feed shape per
GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md section 3: the `madden.ingestion` proto,
snake_case fields, no `@type`/`@id` discriminators, one JSON document per feed
shaped `{"data": [...]}`. Packaged per section 5: data files plus
`.filesetdesc.json` descriptors, filenames stamped with a fresh unix timestamp
so they're never reused (reusing a filename gets a bundle silently rejected --
see section 5's "single most important naming rule").

Entity + action feeds are always compiled -- the required pair per the
playbook ("entity + action are the required pair, so it's fine to ship those
two first and add service later"). The service feed (section 3.3) is now
compiled too, but per-merchant: a merchant with no real lead_time on file is
omitted from the service feed entirely rather than assigned an invented
number (the playbook's explicit rule -- no safe default exists for lead_time)
-- it still gets an entity + action feed row, it just carries no service
feed data. ServiceHours is similarly only emitted when real structured
open/close data exists.
"""

import json
import logging
import os
import random
import re
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger("feedops.feed_compiler")


def _shard_metadata(timestamp: int) -> Dict[str, Any]:
    """
    Every fileset -- even a single-shard one -- needs this block on its data
    file or Google's ingestion sits at "Waiting for remaining shards"
    indefinitely: shard_number/total_shards is how Google knows a shard set
    is complete, and PROCESS_AS_COMPLETE is what triggers ingestion once it
    is (confirmed live: without this block, entity/action/service all sat in
    that state even though a correct, matching FilesetDescriptor -- the
    generation_timestamp/name/data_file fields -- had already resolved the
    earlier "cannot be parsed" failure). This compiler never actually shards
    a feed across multiple files, so shard_number is always 0 of 1.
    """
    return {
        "processing_instruction": "PROCESS_AS_COMPLETE",
        "shard_number": 0,
        "total_shards": 1,
        "nonce": random.randint(100_000, 999_999),
        "generation_timestamp": timestamp,
    }


def _slugify(value: str) -> str:
    """Lowercase, alnum-and-underscore only -- used to build stable-ish IDs
    (menu section/item ids) from free-text like a menu category name."""
    slug = re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_")
    return slug or "item"

# Descriptor `name` and data-file prefix are fixed strings per feed type (section 5).
FEED_DESCRIPTOR_NAMES = {
    "entity": "reservewithgoogle.entity",
    "action": "reservewithgoogle.action.v2",
    "service": "google.food_service",
}
FEED_DATA_FILE_PREFIXES = {
    "entity": "entity",
    "action": "actions",
    "service": "services",
}

# section 3.2: the supported service types are DELIVERY, TAKEOUT, DINE_IN
VALID_SERVICE_TYPES = {"DELIVERY", "TAKEOUT", "DINE_IN"}

MENU_FEED_DESCRIPTOR_NAME = "google.food_menu"
MENU_FEED_FILE_PREFIX = "menu"


class ActionsCenterFeedCompiler:
    def __init__(self, output_dir: str = "feeds_output"):
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)

    def compile_merchant_feed(
        self, merchant_data: Dict[str, Any], match_result: Optional[Dict[str, Any]] = None
    ) -> Dict[str, str]:
        """Compiles a single merchant's feed bundle, folding in its Places match result."""
        merged = dict(merchant_data)
        if match_result:
            if match_result.get("place_id"):
                merged["place_id"] = match_result["place_id"]
            candidate = match_result.get("candidate") or {}
            location = candidate.get("location") or {}
            if location.get("latitude") is not None:
                merged.setdefault("latitude", location["latitude"])
                merged.setdefault("longitude", location["longitude"])
        return self.compile_feeds([merged])

    def _build_location(self, merchant: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Section 3.1: `location.address` is required in practice (structured or
        free-text), even though the written spec implies lat/lng alone is
        acceptable -- the real validator rejects coordinate-only entities.
        Returns None if neither address form is available, signaling the
        caller to skip this merchant rather than emit an invalid entity.
        """
        location: Dict[str, Any] = {}

        lat, lng = merchant.get("latitude"), merchant.get("longitude")
        if lat is not None and lng is not None and -90 <= lat <= 90 and -180 <= lng <= 180:
            location["latitude"] = lat
            location["longitude"] = lng
        # else: silently drop bad/missing coordinates rather than send a garbage
        # sentinel -- an address-only entity is valid, coordinate garbage is not.

        structured = merchant.get("structured_address")
        required_parts = ("street_address", "locality", "region", "postal_code")
        if structured and all(structured.get(k) for k in required_parts):
            location["address"] = {
                "country": structured.get("country", "US"),
                "region": structured["region"],
                "locality": structured["locality"],
                "postal_code": structured["postal_code"],
                "street_address": structured["street_address"],
            }
        elif merchant.get("address"):
            location["unstructured_address"] = merchant["address"]
        else:
            return None  # never send neither (section 3.1)

        return location

    @staticmethod
    def _lead_time_duration(minutes: Any) -> Optional[str]:
        """Section 3.3: `Duration` is a string with an `s` suffix, e.g. `"5400s"`
        -- not `90` or `"90m"`. Returns None (never a fabricated fallback) if
        no real, positive lead time is on file."""
        try:
            minutes = float(minutes)
        except (TypeError, ValueError):
            return None
        return f"{int(minutes * 60)}s" if minutes > 0 else None

    @staticmethod
    def _time_of_day(time_str: Any) -> Optional[Dict[str, int]]:
        """Section 3.3: `TimeOfDay` is an object (`{"hours":11,"minutes":0}`),
        not a `"11:00"` string."""
        if not time_str or ":" not in str(time_str):
            return None
        try:
            hours, minutes = str(time_str).split(":")
            return {"hours": int(hours), "minutes": int(minutes)}
        except ValueError:
            return None

    def _build_service_rows(
        self, merchant: Dict[str, Any], entity_id: str, service_types: List[str], link_ids: Dict[str, str]
    ) -> List[Dict[str, Any]]:
        """
        One `{"service": {...}}` row per fulfillment type, plus one shared
        `{"service_hours": {...}}` row if real opening-hours data exists.
        `lead_time` has no safe default (section 3.3) -- a merchant with none
        on file is omitted from the service feed entirely, not assigned an
        invented number. Same rule for hours: no opening_hours on file means
        no `service_hours` object, never a fabricated schedule.
        """
        lead_time = self._lead_time_duration(merchant.get("lead_time_minutes"))
        if lead_time is None:
            return []

        rows: List[Dict[str, Any]] = []
        service_ids: List[str] = []
        for service_type in service_types:
            link_id = link_ids.get(service_type)
            if not link_id:
                continue
            service_id = f"service_{service_type.lower()}_{entity_id}"
            service_ids.append(service_id)
            rows.append({
                "service": {
                    "service_id": service_id,
                    "service_type": service_type,
                    "parent_entity_id": entity_id,
                    "lead_time": {"min_lead_time_duration": lead_time},
                    "action_link_id": link_id,
                }
            })

        if not service_ids:
            return []

        asap_hours = []
        for day in merchant.get("opening_hours") or []:
            if not day.get("isOpen"):
                continue
            open_time = self._time_of_day(day.get("openTime"))
            close_time = self._time_of_day(day.get("closeTime"))
            if not open_time or not close_time:
                continue
            asap_hours.append({
                "time_windows": {
                    "day_of_week": [str(day.get("day", "")).upper()],
                    "time_windows": {"open_time": open_time, "close_time": close_time},
                }
            })

        if asap_hours:
            rows.append({
                "service_hours": {
                    "hours_id": f"hours_{entity_id}",
                    "service_ids": service_ids,
                    "asap_hours": asap_hours,
                }
            })

        return rows

    def compile_feeds(self, merchant_data_list: List[Dict[str, Any]]) -> Dict[str, str]:
        """
        Compiles entity + action feeds for a batch of merchants, plus a service
        feed row for any merchant with a real lead_time on file. A merchant with
        no usable address is skipped from *all* feeds -- eligibility must stay
        byte-identical across feeds (section 4), or Google rejects the orphan
        records that result from a merchant appearing in one feed but not another.
        """
        timestamp = int(time.time())
        entity_rows: List[Dict[str, Any]] = []
        action_rows: List[Dict[str, Any]] = []
        service_rows: List[Dict[str, Any]] = []

        for merchant in merchant_data_list:
            # vendor_id (a bulk upload's own aggregator-supplied id) takes
            # priority over the internal store_id slug -- Google's system may
            # already have this merchant registered (and possibly Matched)
            # under vendor_<vendor_id> from an earlier push; using anything
            # else here would stop updating that entity and start minting an
            # unmatched duplicate instead.
            raw_id = merchant.get("entity_id") or merchant.get("vendor_id") or merchant.get("id") or merchant.get("store_id")
            entity_id = merchant["entity_id"] if merchant.get("entity_id") else f"vendor_{raw_id}"

            location = self._build_location(merchant)
            if location is None:
                logger.warning(f"Skipping merchant '{entity_id}': no structured or unstructured address.")
                continue

            # Strictly check action_link / action_url / url -- no guessing or fabricated mock URLs
            raw_url = str(merchant.get("action_link") or merchant.get("action_url") or merchant.get("url") or "").strip()
            is_valid_url = bool(raw_url and (raw_url.startswith("http://") or raw_url.startswith("https://")) and "." in raw_url)
            order_url = raw_url if is_valid_url else ""

            if not order_url:
                logger.warning(
                    f"Merchant '{entity_id}' has missing or invalid action_link ('{raw_url}'). "
                    "Google Actions Center requires a valid destination URL for Ordering Redirect."
                )

            entity_rows.append({
                "entity_id": entity_id,
                "name": merchant.get("name", ""),
                "telephone": merchant.get("telephone", ""),
                "url": order_url,
                "location": location,
            })

            # Action rows require a valid http/https destination URL per madden.ingestion proto
            if order_url:
                service_types = merchant.get("service_types") or ["DELIVERY"]
                link_ids: Dict[str, str] = {}
                for service_type in service_types:
                    if service_type not in VALID_SERVICE_TYPES:
                        logger.warning(f"Skipping invalid service_type '{service_type}' for '{entity_id}'.")
                        continue
                    link_id = f"link_{service_type.lower()}_{entity_id}"
                    link_ids[service_type] = link_id
                    action_rows.append({
                        "entity_id": entity_id,
                        "link_id": link_id,
                        "url": order_url,
                        "actions": [{"food_ordering_info": {"service_type": service_type}}],
                    })

                service_rows.extend(self._build_service_rows(merchant, entity_id, list(link_ids.keys()), link_ids))

        feeds_generated: Dict[str, str] = {}
        for feed_type, rows in (("entity", entity_rows), ("action", action_rows), ("service", service_rows)):
            if not rows:
                continue

            prefix = FEED_DATA_FILE_PREFIXES[feed_type]
            data_path = os.path.join(self.output_dir, f"{prefix}_{timestamp}_0001.json")
            with open(data_path, "w") as f:
                json.dump({"metadata": _shard_metadata(timestamp), "data": rows}, f)

            desc_path = os.path.join(self.output_dir, f"{prefix}_{timestamp}.filesetdesc.json")
            with open(desc_path, "w") as f:
                json.dump({
                    "generation_timestamp": timestamp,
                    "name": FEED_DESCRIPTOR_NAMES[feed_type],
                    "data_file": [os.path.basename(data_path)],
                }, f, indent=2)

            feeds_generated[feed_type] = data_path
            feeds_generated[f"{feed_type}_descriptor"] = desc_path

        return feeds_generated

    @staticmethod
    def _text_field(text: str) -> Dict[str, Any]:
        """TextField -> {text: [LocalizedText]} -- the first entry is the
        preferred representation (Menu Feeds Overview). Single-locale only;
        no per-org language config exists yet to populate language_code."""
        return {"text": [{"text": text}]}

    @staticmethod
    def _menu_item_money(price: Any) -> Optional[Dict[str, Any]]:
        """
        Money{currency_code, units, nanos} from a stored plain float price
        (dollars, e.g. 12.5) -- MenuRepository items have no currency field
        today, so USD is hardcoded rather than guessed per-org. Returns None
        (never a fabricated price) for anything that doesn't parse to a real
        non-negative number, matching this compiler's existing "omit, don't
        invent" rule for lead_time/hours.
        """
        try:
            amount = float(price)
        except (TypeError, ValueError):
            return None
        if amount < 0:
            return None
        units = int(amount)
        nanos = round((amount - units) * 1_000_000_000)
        return {"currency_code": "USD", "units": units, "nanos": nanos}

    def compile_menu_feed(self, merchants_with_menus: List[Dict[str, Any]]) -> Dict[str, str]:
        """
        Compiles the google.food_menu feed (see Menu Feeds Overview and the
        food_menu.proto bundle: FoodMenuFeed.data is a flat list of
        MenuComponent, each independently a Menu, MenuSection, or MenuItem,
        linked by id references -- Menu.section_ids/item_ids and
        MenuSection.item_ids -- not nested JSON).

        Only Menu -> MenuSection (grouped by stored `category`) -> MenuItem ->
        Offer(price) is emitted. MenuItemOption, nutrition, allergens, and
        dietary restrictions aren't in this app's stored menu data
        (MenuRepository: name/price/category/description per item) and are
        simply omitted rather than invented.

        `merchants_with_menus` items are shaped
        {"entity_id": str, "items": [{"name", "price", "category", "description"}, ...]}
        -- entity_id must be the SAME id already used in that merchant's
        Entity feed row (compile_feeds), since a menu can't attach to a
        merchant Google doesn't already know about (onboarding doc: menu
        feed "relies on the Merchants or Entity feed").
        """
        timestamp = int(time.time())
        rows: List[Dict[str, Any]] = []

        for merchant in merchants_with_menus:
            entity_id = merchant.get("entity_id")
            items = merchant.get("items") or []
            if not entity_id or not items:
                continue

            # Preserve first-seen category order rather than an arbitrary dict order.
            section_order: List[str] = []
            sections: Dict[str, Dict[str, Any]] = {}

            for i, item in enumerate(items):
                money = self._menu_item_money(item.get("price"))
                if money is None:
                    logger.warning(
                        f"Skipping menu item '{item.get('name')}' for '{entity_id}': no valid price."
                    )
                    continue

                category = (item.get("category") or "Menu").strip() or "Menu"
                section_id = f"section_{_slugify(category)}_{entity_id}"
                if section_id not in sections:
                    sections[section_id] = {
                        "menu_section_id": section_id,
                        "display_name": self._text_field(category),
                        "item_ids": [],
                    }
                    section_order.append(section_id)

                item_id = f"item_{i}_{_slugify(item.get('name', ''))}_{entity_id}"
                menu_item: Dict[str, Any] = {
                    "menu_item_id": item_id,
                    "display_name": self._text_field(item.get("name", "")),
                    "offer_set": {"offers": [{"price": money}]},
                }
                if item.get("description"):
                    menu_item["description"] = self._text_field(item["description"])

                sections[section_id]["item_ids"].append(item_id)
                rows.append({"item": menu_item})

            populated_sections = [sections[sid] for sid in section_order if sections[sid]["item_ids"]]
            if not populated_sections:
                continue  # every item had an invalid price -- no menu to send for this merchant

            for section in populated_sections:
                rows.append({"section": section})

            rows.append({
                "menu": {
                    "menu_id": f"menu_{entity_id}",
                    "merchant_ids": [entity_id],
                    "section_ids": [s["menu_section_id"] for s in populated_sections],
                }
            })

        if not rows:
            return {}

        data_path = os.path.join(self.output_dir, f"{MENU_FEED_FILE_PREFIX}_{timestamp}_0001.json")
        with open(data_path, "w") as f:
            json.dump({"metadata": _shard_metadata(timestamp), "data": rows}, f)

        desc_path = os.path.join(self.output_dir, f"{MENU_FEED_FILE_PREFIX}_{timestamp}.filesetdesc.json")
        with open(desc_path, "w") as f:
            json.dump({
                "generation_timestamp": timestamp,
                "name": MENU_FEED_DESCRIPTOR_NAME,
                "data_file": [os.path.basename(data_path)],
            }, f, indent=2)

        return {"menu": data_path, "menu_descriptor": desc_path}
