# Google Ordering Redirect — Reproducible Playbook

_A sanitized, platform-agnostic write-up of what it actually takes to ship
Google's "Ordering Redirect" integration (Actions Center → Ordering → Redirect
vertical) end to end: feeds, uploads, scheduling, and conversion tracking._

**No real company data appears in this document.** Vendor names, phone
numbers, addresses, partner IDs, SFTP usernames, and conversion tokens below
are all fabricated placeholders — swap in your own before using any snippet.
Anywhere a value is site-specific it's called out explicitly.

---

## 1. What the integration actually is

Google shows an **"Order online" button** on a business's existing Google
Maps / Search listing. Clicking it sends the customer to *your* ordering page
(`https://example.com/order/<merchant-slug>`). Google never touches the order
or the payment — it's pure top-of-funnel referral. You give Google three data
feeds describing your merchants and how to order from them, plus a webhook-ish
callback ("conversion tracking") that reports back when a referred click
turned into a real order.

**Non-obvious but important:** the address/phone/lat-lng you send in the feed
are used only for *matching* your entity to the correct Google Business
Profile — they are never displayed to the end customer. Google always sends
the customer to *your* URL, not to a phone number or address you supplied.
Don't over-think the privacy angle here; the exposure is your merchant's
public business listing, not new PII.

You will work in **two environments** the whole time:
- **Sandbox** — a practice environment. Nothing here is customer-visible.
  Feeds, matching, and conversion tracking all exist here first.
- **Production** — goes live on real Google listings. Only unlocked after
  Google reviews and approves your sandbox work (Partner Portal Step 4).

---

## 2. Portal setup (one-time)

1. Get access to the **Partner Portal**: `https://actionscenter.google.com/home`
2. Someone with the **Administrator** role must generate and register an SSH
   key pair for SFTP feed uploads (an **Editor** role cannot register keys —
   this tripped us up once, don't waste time on it, just get an Admin to do it):
   ```bash
   ssh-keygen -t rsa -b 4096 -C "you@example.com" -f ~/.ssh/google_actions_center
   ```
   Register the **public** key (`.pub`) in the portal. The private key never
   leaves the machine that uploads feeds.
   - **Gotcha:** the portal validates the key's `-C` comment as an email
     address. Use a real, monitored address — it shows up in Google's
     correspondence about your integration.
3. Note down, per environment, from **Partner Portal → Configuration →
   Feeds**:
   - Your **SFTP username** (looks like `feeds-XXXXXXXX`; sandbox and
     production have *different* usernames on *different* SFTP endpoints —
     they do not share credentials).
4. Note down from **Partner Portal → Account and Users → Account tab**:
   - Your **numeric Partner/Aggregator ID** (used only for conversion
     tracking — a completely different ID from the SFTP username, and it's
     very easy to grab the wrong one; see §7).

---

## 3. The three feeds — proto shape

The proto package is **`madden.ingestion`**. Field naming is `snake_case`,
no `@type` discriminator fields. (If you were handed older/different sample
JSON files with `google.actions.foodordering.v1` and camelCase fields — that
schema is stale. Rebuild against the current spec, not inherited samples.)

Each feed is one JSON document shaped `{"data": [ ... ]}` — one row per
array element. You'll generate three separate files: **entity**, **action**,
**service**.

### 3.1 Entity feed — merchant identity

One `Entity` object per merchant. This is what Google matches against a real
Google Business Profile.

```json
{
  "data": [
    {
      "entity_id": "vendor_1001",
      "name": "Cedar & Sage Kitchen",
      "telephone": "+15025550142",
      "url": "https://example.com/order/cedar-and-sage-kitchen",
      "location": {
        "latitude": 38.2527,
        "longitude": -85.7585,
        "address": {
          "country": "US",
          "region": "KY",
          "locality": "Louisville",
          "postal_code": "40202",
          "street_address": "123 Example Street"
        }
      }
    },
    {
      "entity_id": "vendor_1002",
      "name": "Blue Harbor Fish Co",
      "telephone": "+19045550118",
      "url": "https://example.com/order/blue-harbor-fish-co",
      "location": {
        "latitude": 30.3322,
        "longitude": -81.6557,
        "unstructured_address": "Jacksonville, FL 32202, US"
      }
    }
  ]
}
```

Notes:
- `entity_id` — your own stable merchant key, prefixed however you like
  (`vendor_<id>` above). Must be identical across all three feeds.
- `url` — send your **own ordering page**, not the merchant's own website
  field even if you store one. Keeping the click in your own funnel is
  deliberate, not an oversight.
- `telephone` — E.164 format (`+1` + digits, no spaces/dashes).
- `location.address` **is required in practice**, even though the written
  spec implies lat/lng alone is acceptable — the validator rejects
  coordinate-only entities with `MISSING_REQUIRED_FIELD`. Send a structured
  `address` when you have all four parts (street, city, region, postal); fall
  back to a free-text `unstructured_address` otherwise. Never send neither.
- Validate lat/lng are within ±90 / ±180 before emitting — a stray sentinel
  value (`-500,-500` from a broken onboarding form, for example) will get
  silently rejected by Google if you don't catch it first, and it's better to
  drop the coordinates and keep the address than send garbage.

### 3.2 Action feed — the order deep links

One `ActionDetail` per (merchant × fulfillment type). This is the actual
"Order online" destination.

```json
{
  "data": [
    {
      "entity_id": "vendor_1001",
      "link_id": "link_delivery_1001",
      "url": "https://example.com/order/cedar-and-sage-kitchen",
      "actions": [{ "food_ordering_info": { "service_type": "DELIVERY" } }]
    },
    {
      "entity_id": "vendor_1001",
      "link_id": "link_pickup_1001",
      "url": "https://example.com/order/cedar-and-sage-kitchen",
      "actions": [{ "food_ordering_info": { "service_type": "TAKEOUT" } }]
    }
  ]
}
```

Notes:
- `service_type` enum values are **`DELIVERY`** and **`TAKEOUT`** — not
  `PICKUP`. Easy typo to make from habit.
- If your site has no separate URL per fulfillment type, both actions can
  point to the same `url` — `link_id` is what Google actually keys off of,
  not the URL.
- Every `link_id` referenced later by the service feed's
  `action_link_id` must exist here, and every `entity_id` here must exist in
  the entity feed. Orphans in either direction get rejected.

### 3.3 Service feed — hours, lead time, delivery area (optional but recommended)

`service.json` is a **oneof** wrapper: every array element is exactly one of
`{"service":{...}}`, `{"service_hours":{...}}`, `{"service_area":{...}}`, or
`{"fee":{...}}`. This is the feed most people get subtly wrong on first pass
because the JSON encoding rules for proto3 don't match what you'd guess:

| Proto type | JSON shape | Example |
|---|---|---|
| `Duration` | string with `s` suffix | `"5400s"` (not `90` or `"90m"`) |
| `TimeOfDay` | object, not a string | `{"hours":11,"minutes":0}` (not `"11:00"`) |
| `DayOfWeek` | enum **name** string | `"MONDAY"` (not `1` or `"Mon"`) |
| `LatLng` | object | `{"latitude":..,"longitude":..}` |
| `GeoCircle` | object | `{"center":{LatLng},"radius":<metres>}` |

```json
{
  "data": [
    {
      "service": {
        "service_id": "service_delivery_1001",
        "service_type": "DELIVERY",
        "parent_entity_id": "vendor_1001",
        "lead_time": { "min_lead_time_duration": "5400s" },
        "action_link_id": "link_delivery_1001"
      }
    },
    {
      "service_hours": {
        "hours_id": "hours_service_delivery_1001",
        "service_ids": ["service_delivery_1001"],
        "asap_hours": [
          {
            "time_windows": {
              "day_of_week": ["MONDAY", "TUESDAY", "WEDNESDAY"],
              "time_windows": {
                "open_time":  { "hours": 11, "minutes": 0 },
                "close_time": { "hours": 20, "minutes": 0 }
              }
            }
          }
        ]
      }
    },
    {
      "service_area": {
        "area_id": "area_service_delivery_1001",
        "service_ids": ["service_delivery_1001"],
        "circle": {
          "center": { "latitude": 38.2527, "longitude": -85.7585 },
          "radius": 8000
        }
      }
    }
  ]
}
```

Notes:
- `lead_time` is **required** on every `FoodOrderingService` object with **no
  safe default** — if you don't track a real prep/lead time for a merchant,
  omit that merchant from the service feed entirely rather than invent a
  number. The service feed is optional; entity + action are the required
  pair, so it's fine to ship those two first and add service later.
- `ServiceArea.circle.radius` is in **metres**, and should reflect real
  coverage, not a guess. If you track named delivery zones/cities rather than
  a radius, compute the great-circle distance from the merchant to the
  farthest zone you actually deliver to and add a small buffer (we used
  +1 km) — that gives Google a defensible number instead of an arbitrary one.
- `ServiceHours` is optional per merchant; only emit it when you actually
  have structured open/close data. A merchant with no hours on file just
  gets no `service_hours` object — don't fabricate hours.

---

## 4. Eligibility — keep it byte-identical across all three feeds

Whatever your merchant table looks like, define **one** eligibility filter
and apply it verbatim in the query/code that builds each of the three feeds.
A merchant appearing in one feed but not another produces orphan records
(an action with no parent entity, or an entity with no action) and Google
rejects them.

Typical conditions:
```
merchant.is_active
AND merchant.verification_status = 'APPROVED'
AND merchant.is_publicly_visible
AND NOT merchant.is_deleted
AND merchant.offers_delivery_or_pickup
AND merchant.name IS NOT NULL
AND merchant.city IS NOT NULL          -- needed to build an address
AND merchant.latitude/longitude IS NOT NULL
```
Service feed adds: `lead_time IS NOT NULL AND > 0`.

### Closed-merchant exclusion — this will bite you eventually

Google's **Launch Review fails outright** if a submitted feed contains a
merchant that Google's own Places data marks **"Temporarily closed"** or
**"Permanently closed"** — this status lives in *Google's* data, not yours, so
a merchant can be perfectly `active`/`APPROVED` in your own system and still
fail review. Build this as a standing guard, not a one-time cleanup:

1. **A simple exclude-list file** — one merchant ID per line, with a comment
   explaining why. Every feed query reads it and drops those IDs. One file,
   applied identically everywhere, guarantees no orphans.
2. **An automated status check** that runs after feed generation, queries the
   Google Places API `businessStatus` field for every feed merchant (by name +
   coordinates), and:
   - auto-appends **high-confidence** `CLOSED_TEMPORARILY`/`CLOSED_PERMANENTLY`
     hits to the exclude list and regenerates,
   - **reports but does not auto-exclude** low-confidence matches or
     no-matches (a small/home-based merchant with no Google Business Profile
     at all is common and not itself a problem — don't treat "no match" as
     "closed").
3. **Refuse to re-upload blind.** If your pipeline can't regenerate fresh data
   (e.g. a DB tunnel is down) and has to fall back to re-packaging the last
   known-good feed, run the status check against that cached data first and
   abort the upload rather than re-ship a feed you can no longer vouch for.

---

## 5. File naming & packaging

Each feed file, wherever it's produced from, collapses to one JSON document.
Package them into a per-run bundle:

```
upload/<unix_timestamp>/
  entity_<timestamp>_0001.json
  actions_<timestamp>_0001.json
  services_<timestamp>_0001.json
  <descriptor>_<timestamp>.filesetdesc.json   (one per feed type)
```

**Descriptor `name` field is a fixed string per feed type** (note they're
inconsistently named by Google, not a typo on your end):

| Feed | Descriptor `name` | Data-file prefix |
|---|---|---|
| Entity | `reservewithgoogle.entity` | `entity_` |
| Action | `reservewithgoogle.action.v2` | `actions_` |
| Service | `google.food_service` | `services_` |

**The single most important naming rule: filenames must be unique forever.**
Never re-upload a bundle under a name you've already sent — not even to
"retry" a failed upload. If a transfer fails partway, Google may have already
registered those filenames; re-sending the same names gets rejected as
`Failed, 0 items`, which then trips *both* the "fewer than 10 items" and the
"has errors" checks simultaneously — and there's no way to delete a bad feed
from history, it only ages out of the rolling review window (a few days).
**Recovery is always: re-package with a fresh timestamp, then upload.** Stamp
every run's filenames off the current unix time (or an equivalent monotonic
id) so this is structurally impossible to get wrong.

Compression is optional (gzip only — not zip) and only worth it at real
scale; a few dozen KB of JSON doesn't need it.

---

## 6. Uploading — SFTP, no exceptions

There is no HTTPS endpoint, no cloud-storage bucket, no portal upload button.
**SFTP is the only transport.**

```bash
sftp -P 19321 -i ~/.ssh/google_actions_center <SFTP_USERNAME>@partnerupload.google.com
```
At the prompt:
```
mput *.filesetdesc.json     # descriptors go FIRST
mput *_0001.json            # then the data files
bye
```

- Sandbox and production are **separate SFTP endpoints with separate
  usernames** — get the production username from the portal only after
  Google has approved and enabled production (see §9); it will not exist
  before that.
- After upload, check **Partner Portal → Ingestion → History**. A clean SFTP
  `put` only proves the file was delivered — it says nothing about whether
  Google accepted it. You want a row that reads **`Done`, 0 errors**.
- Feeds are expected **daily**. Production requires this cadence permanently;
  sandbox review wants several consecutive clean days before it'll pass you
  through.

### Automating the daily push

Manual SFTP will not reliably hold a daily cadence, so automate it:

- **An upload script** that does a non-interactive SFTP `mput` of the newest
  bundle, descriptors first. Keep the SFTP username **out of source control**
  — read it from a chmod-600 file or an environment variable, never hardcode
  it in a committed script.
- **A daily driver script** that: regenerates feeds from live data if the
  data source is reachable, otherwise re-packages the last known-good raw
  JSON under a fresh timestamp (never re-send an old bundle's filenames);
  runs the closed-merchant guard from §4; then uploads. Log every run.
- **A scheduled job** (`launchd` on macOS, `cron`/systemd timer on Linux)
  firing once a day. Harden the transport: set an explicit connect timeout
  and keepalive on the SFTP call (e.g. `-o ConnectTimeout=30 -o
  ServerAliveInterval=15 -o ServerAliveCountMax=4`) so a stalled or dropped
  connection fails fast instead of hanging for hours — we've seen both a
  multi-hour stall and a mid-transfer connection reset from Google's end, and
  neither times out on its own without this.
- Known operational gaps worth designing around: a machine that's asleep or
  logged out at the scheduled time will simply skip that day's run (`launchd`
  fires on next wake, not retroactively); build a "did today's run actually
  happen" check into your monitoring rather than assuming a scheduled job = a
  completed job.

### Reading the portal's "Needs attention" errors correctly

Three sub-errors commonly show up under Feeds, and none of them are usually
what they sound like:

| What the portal says | What it actually means |
|---|---|
| "uploaded later than expected" | You missed a day — restart the daily job |
| "1 feed with fewer than 10 items" | Almost always one stale/partial upload sitting in the rolling review window — it ages out, no action needed once the daily cadence is solid |
| "1 feed with errors → duplicate entry" | You re-uploaded a **filename** you'd already used (see §5) — not duplicate *records*. Fix is process (unique names), not data. |

---

## 7. Conversion tracking

**What it is:** when a customer clicks Google's "Order online" button, Google
appends `?rwg_token=<opaque token>` to your URL. Your app must capture that
token (e.g. in a short-lived cookie), and when the referred order actually
completes, POST it back to Google. If no token ever flows back, Google's
model treats every one of its referrals as a dead end — even though real
orders are happening.

### Endpoints

| Environment | Endpoint |
|---|---|
| Sandbox | `https://www.google.com/maps/conversion/debug/collect` |
| Production | `https://www.google.com/maps/conversion/collect` |

Both take a `text/plain` body:
```json
{"conversion_partner_id":"<your numeric Partner/Aggregator ID>","rwg_token":"<captured token>","merchant_changed":2}
```
- `conversion_partner_id` — the **numeric Partner/Aggregator ID** from
  **Partner Portal → Account and Users → Account tab**. This is a completely
  different value from your SFTP username, and sending the SFTP-style
  identifier here is the single most common mistake — it fails silently in a
  confusing way (see the HTTP-code table below).
- `merchant_changed` — send as an **integer**, `2` for "customer ordered from
  the exact merchant they were referred to" (the normal case for a redirect
  integration). `1` is reserved for a changed-merchant edge case (e.g. a
  multi-vendor cart where the referred merchant wasn't the one ultimately
  ordered from) — implement it later if your cart supports switching
  merchants mid-session; `2` is a safe default otherwise.

### Diagnosing via HTTP status — this is the fast path

POST directly with `curl` and read the status code before touching any
application code:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://www.google.com/maps/conversion/debug/collect \
  -H 'Content-Type: text/plain' \
  --data '{"conversion_partner_id":"<YOUR_PARTNER_ID>","rwg_token":"<TEST_TOKEN>","merchant_changed":2}'
```

| Code | Meaning |
|---|---|
| `200` | Accepted — counts toward the portal's "≥3 events in 7 days" check |
| `500` | Wrong / unresolvable partner id — almost always the SFTP username used by mistake instead of the numeric Aggregator ID |
| `400` | A numeric-looking but unrecognized partner id |
| other | Network/endpoint problem — re-check the URL and retry |

The portal gives you a handful of **sandbox test tokens** (one per test
merchant) under its own conversion-tracking setup instructions — search the
Actions Center documentation under
`.../ordering/redirect/integration-steps/direct-conversion-tracking` from
within the Partner Portal help center for the current doc, since Google
moves these paths between doc revisions. POST each token once with the
sandbox endpoint above; three distinct tokens (= three distinct merchants)
satisfy the portal's check.

### Weekly upkeep — don't skip this

Both the sandbox and production conversion-tracking checks require **≥3
events in the trailing 7 days**, and they **lapse** the moment the last batch
ages out of that window — this isn't a one-time setup task, it's a standing
weekly chore until Google's Launch Review passes:

```bash
# once a week, per environment, using the 3 sandbox test tokens Google gave you
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://www.google.com/maps/conversion/debug/collect \
  -H 'Content-Type: text/plain' \
  --data '{"conversion_partner_id":"<PARTNER_ID>","rwg_token":"<TOKEN_A>","merchant_changed":2}'
# repeat for TOKEN_B, TOKEN_C, then again against the production endpoint
```
Wrap this in a small script that holds the tokens and partner id, prints an
HTTP code per token, and exits non-zero if any isn't `200` — it's cheap
insurance against a silent lapse. Events count **immediately** on POST; they
are **not** gated behind any pending review, so you can (and should) keep
this green well before Launch Review even starts.

### Application-side implementation (once curl proves the endpoint works)

1. On every page load / route change, check the URL for `rwg_token` and store
   it (a 30-day cookie alongside the referred merchant's identity is
   reasonable — most sessions won't have a token at all, this should be a
   no-op the vast majority of the time).
2. On confirmed order completion, if a token is present, fire the POST above
   with `merchant_changed:2` (or `1` if the customer's final order left the
   referred merchant).
3. Keep the conversion partner id and target environment (`sandbox` vs
   `production`) in config, not hardcoded — you will flip sandbox → production
   exactly once, at real launch, and want that to be a one-line change.

---

## 8. Merchant matching (separate step, easy to forget)

Ingesting a feed successfully is not the same as being **visible**. Google
still has to match each `Entity` to a real Google Business Profile listing.
An unmatched entity sits `INVENTORY_DISABLED` and shows nothing.

- Matching happens **in the portal**, per environment, and is manual:
  **Portal → Inventory → Inventory Viewer** → find the entity → provide the
  Google Maps URL for that business's own listing.
- The URL must be a full `https://www.google.com/maps/place/...` link.
  **Rejected:** shortened `share.google/...` or `maps.app.goo.gl/...` links,
  and `google.com/search?...` links from Search rather than Maps. There's no
  API to generate this URL — open the listing in Google Maps itself and copy
  the address-bar URL.
- A confirmed match typically shows up as `INVENTORY_LIVE` within about a day.
- **Matches do not reliably carry over from sandbox to production** — budget
  time to redo matching in the production portal even though you already did
  it in sandbox. Keep a simple worksheet (merchant → entity_id → verified
  Maps link) while you do sandbox matching once, and it becomes a fast
  copy-paste job for production later.

---

## 9. Going to production

1. Get sandbox feeds + sandbox conversion tracking both green.
2. Submit **Partner Portal Step 4 (Sandbox → Production review)**.
3. Once Google approves, your **production SFTP account is enabled** — it
   does not exist before this. Uploading to it before approval does nothing;
   files sit untouched and Ingestion History stays empty. That's expected,
   not a bug — don't waste time debugging an empty production Inventory
   before Step 4 is actually approved.
4. Point your daily upload job at the production SFTP username, and generate
   feeds from your **production data source** — double-check you're not
   accidentally still pointed at a staging/test database once this matters
   for real, publicly-visible listings.
5. Re-do merchant matching in the production Inventory Viewer (§8).
6. Flip conversion tracking's target environment to production
   (`.../maps/conversion/collect`, no `/debug/`).
7. Submit **Launch Review**. Google will flag any merchant its own Places
   data considers closed (§4) — fix and resubmit rather than arguing the
   point, it's Google's data that gates this, not yours.
8. Keep the weekly conversion-tracking re-send (§7) going in **both**
   environments until Launch Review actually passes.

---

## 10. Do's and Don'ts

**Do**
- Keep eligibility rules byte-identical across all three feeds. This one
  discipline prevents the entire "orphan record" failure class.
- Stamp every upload bundle's filenames with a fresh timestamp, always —
  make it structurally impossible to reuse a filename.
- Run a closed-merchant check against Google's own Places data before every
  upload, not just once at setup.
- Diagnose conversion-tracking failures by HTTP status code first — it tells
  you immediately whether the problem is the partner id (500), an unknown id
  (400), or something else, before you go anywhere near application code.
- Treat conversion-tracking's "3 events / 7 days" as a recurring weekly chore
  until Launch Review passes, not a one-time setup box to check.
- Validate lat/lng ranges and require *some* address representation
  (structured or free-text) before emitting an entity — Google's validator is
  stricter in practice than the written spec suggests.
- Automate the daily feed push from day one. A manual process will not
  survive contact with a multi-week review cycle.

**Don't**
- Don't re-upload a bundle under a filename you've already used, even to
  "retry" a failed transfer — package fresh instead.
- Don't confuse your SFTP username with your numeric Partner/Aggregator ID —
  they come from different portal screens and conversion tracking wants the
  latter only.
- Don't assume a clean SFTP `put` means Google accepted the feed — always
  confirm `Done, 0 errors` in Ingestion History.
- Don't assume sandbox merchant matches carry over to production — plan to
  redo them.
- Don't send the merchant's own external website as the action URL if your
  goal is to keep the click inside your ordering flow — send your own
  ordering page URL.
- Don't treat "merchant has no Google Business Profile" as an error state —
  it's common for small/home-based businesses and just means that merchant
  can't be matched (and therefore won't go live) until they create one; it's
  an external dependency, not a bug in your feed.
- Don't invent data (a lead time, a delivery radius, an address) to satisfy a
  required field — omit the merchant from that specific feed instead. A
  wrong ETA or coverage area is worse than the merchant being briefly absent
  from one optional feed.

---

## 11. Reference material

- Partner Portal: `https://actionscenter.google.com/home`
- Sandbox conversion endpoint: `https://www.google.com/maps/conversion/debug/collect`
- Production conversion endpoint: `https://www.google.com/maps/conversion/collect`
- SFTP upload host: `partnerupload.google.com`, port `19321`
- In-portal help center: search for "Ordering redirect integration steps" and
  "Direct conversion tracking" — Google reorganizes these doc paths between
  revisions, so the portal's own search is more reliable than a bookmarked
  link.

---

_This document intentionally omits: any real company name, real merchant
names/addresses/phone numbers, real partner IDs, real SFTP credentials, and
real conversion tokens. Every identifier above is a fabricated placeholder —
substitute your own from your own Partner Portal account before use._
