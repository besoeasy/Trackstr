# Trackstr — AGENTS.md

Trackstr is an open, Nostr-powered media tracking + social platform (movies, shows, music).
Stack: Vue.js + Vite + JavaScript. Media storage: IPFS via [Originless](https://github.com/besoeasy/Originless) (free public instance: https://originless.gupt.app/). Metadata: TMDB, MusicBrainz (client UI presentation only). Integrations: Spotify, Plex, Jellyfin.
Portable social layer: activity, ratings, reviews, social graph live on Nostr, owned by the user's identity.

## Architecture Philosophy: Mutable State vs. Immutable Logs

Trackstr divides all data into two fundamental categories to ensure permanent personal data preservation without relay bloat or artificial expiration countdowns:

| Data Category | Purpose | Nostr Event Pattern | Why |
|---|---|---|---|
| **Mutable State** (Watch/listening status, current rating, watchlists, metadata) | Current status or latest value per media item | **NIP-33 Parameterized Replaceable Events** (`kind: 30000..39999`) with `["d", "<d-tag>"]` | Relays automatically overwrite older versions per `(pubkey, kind, d)`. Zero relay bloat, zero auto-renew needed. |
| **Immutable Logs** (Listening history, scrobbles, check-ins, written reviews) | Point-in-time historical diary entries | **Regular Kinds** (`kind: 1000..9999`) with **NO expiration** tag | Scrobbles and reviews are historical diary entries; they remain permanent forever without maintenance. |
| **Deletions** | Removing an event | **NIP-09 Deletion Requests** (`kind: 5`) | Native protocol deletion standard across relays and clients. |

### Architectural Evolution

| Aspect | Previous Expiry Model (Flawed) | Trackstr Modern Architecture |
|---|---|---|
| **Mutable State (Watch status, current rating)** | Regular kinds (5400) + custom anchor + 10y expiry + auto-renew loop | **NIP-33 Parameterized Replaceable Events** (`kind: 30000..39999`) — relays automatically overwrite older versions per `(pubkey, kind, d-tag)`. Zero relay bloat, zero auto-renew needed. |
| **Immutable Logs (Listening history, scrobbles, reviews)** | Regular kinds + 10y expiry + auto-renew | **Regular Kinds** (`kind: 1000..9999`) with **NO expiration** — scrobbles and reviews are historical diary entries; they remain permanent forever without maintenance. |
| **Deletions** | Expiring tombstones (risk resurrecting deleted items after 10y) | Standard **NIP-09 Deletions** (`kind: 5`) |
| **Relay Footprint** | Accumulates thousands of redundant revisions and renew events | Minimal; relays store current state for mutable items and true history for logs |
| **Offline Safety** | Data wiped by relays if user is inactive > 10 years | Safe; permanent user ownership without artificial countdowns |

---

## Event Kinds & Schema

Trackstr uses allocated custom kind ranges:
- **Mutable State (Parameterized Replaceable, NIP-33: `30000 <= n < 40000`)**: Range `35400–35403`
- **Immutable Logs (Regular, NIP-01: `1000 <= n < 10000`)**: Range `5401–5402`

| Item | Category | Kind | Content / key tags |
| --- | --- | --- | --- |
| **User Rating** (Current score) | Mutable State (NIP-33) | `35400` | `content` = optional note/JSON; `["d", "<d-tag>"]`, `["contentid", "<64-hex>"]`, `["rating", "8"]` (1–10 scale) |
| **Written Review** (Body + score at time) | Immutable Log (Regular) | `5401` | `content` = review body; `["d", "<contentid>"]`, `["contentid", "<64-hex>"]`, `["rating", "8"]` optional, `["spoiler", "1"]` optional |
| **Watch / Listening Status** (Current state) | Mutable State (NIP-33) | `35402` | `content` = optional detail/JSON; `["d", "<d-tag>"]`, `["contentid", "<64-hex>"]`, `["status", "plan-to-watch\|watching\|completed\|on-hold\|dropped\|listening\|plan-to-listen"]`, `["progress", "…"]` optional |
| **Activity Log / Scrobble / Check-in** | Immutable Log (Regular) | `5402` | `content` = optional detail/JSON; `["d", "<contentid>"]`, `["contentid", "<64-hex>"]`, `["status", "watching\|completed\|listening"]`, `["progress", "…"]` optional |
| **Media Metadata** (Community curation) | Mutable State (NIP-33) | `35403` | `content` = synopsis or structured JSON (cast, crew); `["d", "<contentid>"]`, `["contentid", "<64-hex>"]`, `["poster", "ipfs://<CID>"]` optional, `["banner", "ipfs://<CID>"]` optional, `["genre", "…"]` optional, `["lang", "en"]` optional |

### Kind Rules & Identity Keys

1. **Mutable State (`35400`, `35402`, `35403`)**:
   - Addressable/Replaceable by `(kind, pubkey, d-tag)` per NIP-33.
   - **`d-tag` Construction**:
     - Movies, shows, or music albums: `["d", "<contentid>"]`.
     - Individual episodes: `["d", "<contentid>:s<season>e<episode>"]` (e.g. `<contentid>:s1e3`), ensuring episode records do not clobber the parent show or sibling episodes.
   - Relays automatically deduplicate and store only the latest event per `(kind, pubkey, d-tag)`.
   - **Updates**: Publish a new event with the same `d-tag` and a fresh `created_at`. No client-side anchor reconciliation or auto-renew jobs required.
2. **Immutable Logs (`5401`, `5402`)**:
   - Regular kinds per NIP-01. Every event represents a permanent, append-only historical log entry (scrobble, check-in, or written review).
   - Carry `["d", "<contentid>"]` solely as a relay-indexed lookup tag (`#d`) so clients can query logs by media item (`{"kinds": [5401, 5402], "#d": ["<contentid>"]}`). Relays never dedup on `d` for regular kinds.
   - **NO NIP-40 expiration tags (`["expiration", ...]`)**: Review logs and listening history are permanent personal archives.
3. **Deletions (NIP-09)**:
   - To delete an item, publish a standard NIP-09 deletion event (`kind: 5`) referencing the event ID (for regular kinds) or coordinate `a` tag (`35400:<pubkey>:<d-tag>` for NIP-33 kinds).
   - Clients filter out deleted events upon processing the NIP-09 notice.
4. **App Attribution**:
   - Every Trackstr event carries exactly one `["trackstr", "<app-id>"]` app tag (e.g. `["trackstr", "web"]`).
5. **No Redundant `t` Tags**:
   - Events are strictly namespaced by kind; omit `["t", "trackstr-..."]` to optimize wire size.
6. **Social Graph & Profiles**:
   - Follows stay on standard kind `3` (NIP-02); user profile metadata stays on standard kind `0` (NIP-01).

---

Media meta tags (every event carrying a media ref includes these along with `contentid` — never tag proprietary IDs like `tmdb`, `imdb`, or `mbid`):

- `["type", "movie|show|episode|music"]` — what the ref points at.
- `["name", "<title>"]` — denormalized display name, so feeds render without a metadata lookup.
- `["year", "<YYYY>"]` — release year (movie), first-air year (show/episode).
- `["season", "<n>"]` + `["episode", "<n>"]` — only when `type` is `episode`. Season `"0"` = specials (standard convention); `episode` counts within its season, specials included.

Content identity (`contentid` — provider-free primary key):

- Every event with a media ref carries `["contentid", "<64-hex>"]`. Readers match/join on `contentid` only — never on `name`/`year`. Events never tag proprietary database IDs (TMDB, IMDb, MusicBrainz, etc.). Only the client UI queries external providers for presentation metadata (posters, cast, synopses), never Nostr relays or events.
- `contentid` = lowercase hex `sha256` over the canonical string (UTF-8 bytes):
  - movie/show: `"<type>|<norm(title)>|<year>"`, e.g. `"movie|fight club|1999"` or `"show|game of thrones|2011"`. Episodes anchor directly to their parent show's `contentid` (episodes specify position via `["season", "<n>"]` and `["episode", "<n>"]` event tags, ensuring all show activity aggregates under a single relay query).
  - music: `"music|<norm(artist)>|<norm(title)>|<year>"`
- `norm()` is byte-exact and identical on every client (hash identity depends on it):
  1. Unicode NFKC normalize
  2. lowercase
  3. trim, collapse every internal whitespace run to one space
  4. literal `|` delimiter characters in fields are escaped as `\|` to preserve boundary invariance
  5. no article-stripping, no transliteration, no punctuation removal — dumb and exact beats clever and divergent
- Collisions (title+year is not unique; years are disputed ±1 across sources): optional `["qualifier", "<text>"]` (director, country, `"short"`, …). When present it joins the hash: `"<type>|<norm(title)>|<year>|<norm(qualifier)>"`. Without one, same-hash works merge; anyone spotting a false merge SHOULD republish with a qualifier to split. Known limitation, handled by convention, not consensus.

### Publishing & Updates

1. **Mutable State (`35400`, `35402`, `35403`)**:
   - Built as NIP-33 parameterized replaceable events with `["d", "<d-tag>"]`.
   - To create or edit: Publish with the current timestamp (`created_at = now`). Relays replace any previous event with matching `(pubkey, kind, d)`.
   - No custom anchor tag, no auto-renew background jobs, and no NIP-40 expiration.
2. **Immutable Logs (`5401`, `5402`)**:
   - Built as regular NIP-01 events with `["d", "<contentid>"]`.
   - Never carry `["expiration", "..."]` tags. Each event is a permanent historical diary entry.
   - Every scrobble or written review is appended to the user's timeline.

Example Mutable Rating Event (`kind: 35400`):
```json
{
  "kind": 35400,
  "created_at": 1788900000,
  "tags": [
    ["d", "5d974f7d08efef728f3e77f6f910291782d657b47a37374045b89301c6ee1f30"],
    ["contentid", "5d974f7d08efef728f3e77f6f910291782d657b47a37374045b89301c6ee1f30"],
    ["trackstr", "web"],
    ["type", "movie"],
    ["name", "Fight Club"],
    ["year", "1999"],
    ["rating", "8"]
  ],
  "content": "Rewatched director's cut."
}
```

Example Immutable Review Event (`kind: 5401`):
```json
{
  "kind": 5401,
  "created_at": 1788900000,
  "tags": [
    ["d", "5d974f7d08efef728f3e77f6f910291782d657b47a37374045b89301c6ee1f30"],
    ["contentid", "5d974f7d08efef728f3e77f6f910291782d657b47a37374045b89301c6ee1f30"],
    ["trackstr", "web"],
    ["type", "movie"],
    ["name", "Fight Club"],
    ["year", "1999"],
    ["rating", "8"]
  ],
  "content": "Still holds up remarkably well."
}
```

### Deletion (NIP-09)

Instead of fragile, expiring client-side tombstones, Trackstr uses native Nostr **NIP-09 deletion requests** (`kind: 5`):
1. For regular events (`5401`, `5402`): Emit a `kind: 5` event with an `["e", "<event-id>"]` tag.
2. For replaceable events (`35400`, `35402`, `35403`): Emit a `kind: 5` event with an `["a", "<kind>:<pubkey>:<d-tag>"]` coordinate tag.
3. Compliant relays delete or suppress the referenced events; clients filter them out upon receiving the deletion notice.

---

### Media Content Aggregation & Bootstrapping (Kind 35403)

Decentralized media metadata curation allows users to publish and share posters, backdrops, synopses, and cast/crew details directly on Nostr without relying on centralized APIs:

- Each contributor publishes an addressable event with kind `35403` for a `contentid`, carrying their proposed metadata (`poster`, `banner`, `genre`, `lang`, and synopsis/cast in `content`).
- **Aggregation & Web of Trust (WoT)**: Clients merge fields across publishers for the same `contentid`:
  1. Prioritize metadata published by authors in the user's follow list (NIP-02 Web of Trust).
  2. Fall back to community consensus (highest zapped, most liked, or most frequent values).
  3. Support language filtering via `["lang", "en"]`, `["lang", "es"]`, etc.
- **Bootstrapping & One-Click Seeding (Client UX)**:
  To solve the cold-start problem without centralized scrapers or relay flooding:
  1. **Check presence**: When a user logs or views media, the client checks if any `kind: 35403` events exist on Nostr for that `contentid`.
  2. **Contribute prompt (only if missing)**: If no `35403` metadata event is present on relays for that `contentid`, the client presents a "Contribute to Nostr" / "Seed Metadata" action.
  3. **Fetch & publish**: On user confirmation, the client fetches artwork, synopsis, and cast from external APIs (TMDB, MusicBrainz), constructs the provider-free `35403` event, and the user signs and publishes it with their Nostr identity.
  4. **Once present, prompt hides**: If metadata already exists for that `contentid`, the prompt is suppressed to prevent duplicate relay spam.

---

### Taxonomy & Conventions (Ratings, Status, Sync)

- **Rating scale (`35400`, `5401`)**: Standard scale is **1 to 10**. Expressed as numeric string (e.g. `"8"` or half-step `"8.5"`). Math is `sum(ratings) / count(ratings)` on a 10-point scale.
- **Activity status enum (`35402`, `5402`)**:
  - Movies & Shows: `"plan-to-watch"`, `"watching"`, `"completed"`, `"on-hold"`, `"dropped"`.
  - Music: `"plan-to-listen"`, `"listening"`, `"completed"`.
- **Local-first delta sync**:
  - Clients cache winning items in local storage (e.g. IndexedDB).
  - Background delta-sync queries relays with `{"kinds": [35400, 35402, 35403, 5401, 5402], "since": <last_synced_unix_timestamp>}` for instant UI loading without relay wait.
- **Media storage & uploads (IPFS via Originless)**:
  - All media uploads (posters, backdrops/banners, artwork, avatars) MUST use IPFS content addressing via [Originless](https://github.com/besoeasy/Originless) (free public instance for uploading media: https://originless.gupt.app/).
  - Event tags stick strictly to `ipfs://<CID>` (e.g. `["poster", "ipfs://bafybeic..."]`).
  - No centralized HTTP/HTTPS URLs (AWS S3, Imgur, Cloudinary, etc.) are allowed in event tags for uploaded media—Trackstr is decentralized and media assets must remain permanent and content-addressed.
  - Client UIs resolve `ipfs://<CID>` via local IPFS nodes or gateway URLs (e.g. Originless gateway, https://originless.gupt.app/) at presentation time.

---

### Agent Checklist (Every Diff Touching Nostr)

- [ ] Use **NIP-33 Parameterized Replaceable Kinds (`35400`, `35402`, `35403`)** for mutable state; ensure `["d", "<d-tag>"]` is set properly (`<contentid>` or `<contentid>:s<season>e<episode>`).
- [ ] Use **Regular Kinds (`5401`, `5402`)** for immutable logs (reviews, scrobbles/check-ins). **Do NOT add NIP-40 expiration tags** (`["expiration", ...]`).
- [ ] Every event carries exactly one `["trackstr", "<app-id>"]` app attribution tag.
- [ ] Every event with a media ref carries a valid `contentid` computed per the scheme (`norm()` byte-exact) and a matching `["d", "<contentid>"]` tag for relay filtering.
- [ ] No proprietary IDs (TMDB, IMDb, MBID) are tagged on Nostr events; join strictly on `contentid`.
- [ ] No redundant `t` tags are emitted (`kind` + `trackstr` tag fully namespace the event).
- [ ] Media asset tags (`poster`, `banner`, etc.) stick strictly to `ipfs://<CID>` format via Originless.
- [ ] Activity events use canonical status strings (`plan-to-watch`, `watching`, `completed`, `on-hold`, `dropped`, `plan-to-listen`, `listening`).
- [ ] Deletions use standard **NIP-09 (`kind: 5`)** deletion events referencing event ID or addressable coordinate.

