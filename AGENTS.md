# Trackstr — AGENTS.md

Trackstr is an open, Nostr-powered media tracking + social platform (movies, shows, music).
Stack: Vue.js + Vite + JavaScript. Metadata: Wikipedia, TVMaze, TMDB, MusicBrainz (client UI presentation only). Integrations: Spotify, Plex, Jellyfin.
Portable social layer: activity, ratings, reviews, recommendations, and social graph live on Nostr, owned by the user's identity.

## Architecture Philosophy: 100% Mutable Replaceable State

Trackstr uses **NIP-33 Parameterized Replaceable Events** for all user-generated tracking data. We are strictly a media tracking and recommendation platform—not an immutable scrobble logger.

| Data Category | Purpose | Nostr Event Pattern | Why |
|---|---|---|---|
| **Mutable State** (Watch/listening status, ratings & reviews, similar suggestions) | Current status, latest score, written review, or recommendations per media item | **NIP-33 Parameterized Replaceable Events** (`kind: 30000..39999`) with `["d", "<d-tag>"]` | Relays automatically overwrite older versions per `(pubkey, kind, d)`. Zero relay bloat, zero auto-renew needed. |
| **Deletions** | Removing an event | **NIP-09 Deletion Requests** (`kind: 5`) | Native protocol deletion standard across relays and clients. |

### Architectural Evolution

| Aspect | Previous Expiry / Log Model | Trackstr Modern Architecture |
|---|---|---|
| **Mutable State (Watch status, current rating & reviews)** | Regular kinds (5400/5401) + custom anchor + 10y expiry + auto-renew loop | **NIP-33 Parameterized Replaceable Events** (`kind: 30000..39999`) — relays automatically overwrite older versions per `(pubkey, kind, d-tag)`. Zero relay bloat, zero auto-renew needed. |
| **Community Recommendations** | None | **Kind `35401` Parameterized Replaceable Events** (`["d", "<source_contentid>"]`) allowing users to suggest similar titles, creating a decentralized feedback loop. |
| **Activity Logging** | 5402 Scrobble / Check-in bloat | **Removed**. Trackstr tracks state and recommendations directly without scrobbler noise. |
| **Deletions** | Expiring tombstones (risk resurrecting deleted items after 10y) | Standard **NIP-09 Deletions** (`kind: 5`) referencing coordinate tags (`["a", "<kind>:<pubkey>:<d-tag>"]`) |
| **Relay Footprint** | Accumulates thousands of redundant revisions and renew events | Minimal; relays store exactly one latest event per `(pubkey, kind, d-tag)`. |
| **Offline Safety** | Data wiped by relays if user is inactive > 10 years | Safe; permanent user ownership without artificial countdowns. |

---

## Event Kinds & Schema

Trackstr uses allocated custom kind ranges:
- **Mutable State (Parameterized Replaceable, NIP-33: `30000 <= n < 40000`)**: Range `35400..35402`

| Item | Category | Kind | Content / key tags |
| --- | --- | --- | --- |
| **User Rating & Written Review** (Current score & review) | Mutable State (NIP-33) | `35400` | `content` = optional written review; `["d", "<d-tag>"]`, `["contentid", "<64-hex>"]`, `["rating", "8"]` (1–10 scale, optional if review content present), `["spoiler", "1"]` optional |
| **Similar Item Suggestion** (Community recommendations) | Mutable State (NIP-33) | `35401` | `content` = optional recommender note; `["d", "<source_contentid>"]`, `["contentid", "<source_contentid>"]`, `["similar", "<target_cid>", "<type>", "<name>", "<year>"]`, `["s", "<target_cid>"]` |
| **Watch / Listening Status** (Current state) | Mutable State (NIP-33) | `35402` | `content` = optional detail/JSON; `["d", "<d-tag>"]`, `["contentid", "<64-hex>"]`, `["status", "plan-to-watch\|watching\|completed\|on-hold\|dropped\|listening\|plan-to-listen"]`, `["progress", "…"]` optional |

### Kind Rules & Identity Keys

1. **Mutable State (`35400`, `35401`, `35402`)**:
   - Addressable/Replaceable by `(kind, pubkey, d-tag)` per NIP-33.
   - **`d-tag` Construction**:
     - Movies, shows, or music albums: `["d", "<contentid>"]`.
     - Individual episodes (for 35400 and 35402): `["d", "<contentid>:s<season>e<episode>"]` (e.g. `<contentid>:s1e3`), ensuring episode records do not clobber the parent show or sibling episodes.
     - Similar suggestions (35401): `["d", "<source_contentid>"]`, mapping each user's suggestions for that source media item.
   - Relays automatically deduplicate and store only the latest event per `(kind, pubkey, d-tag)`.
   - **Updates**: Publish a new event with the same `d-tag` and a fresh `created_at`.
2. **Deletions (NIP-09)**:
   - To delete an item, publish a standard NIP-09 deletion event (`kind: 5`) referencing the coordinate `a` tag (`<kind>:<pubkey>:<d-tag>`).
   - Clients filter out deleted events upon processing the NIP-09 notice.
3. **App Attribution**:
   - Every Trackstr event carries exactly one `["trackstr", "<app-id>"]` app tag (e.g. `["trackstr", "web"]`).
4. **No Redundant `t` Tags**:
   - Events are strictly namespaced by kind; omit `["t", "trackstr-..."]` to optimize wire size.
5. **Social Graph & Profiles**:
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

1. **Mutable State (`35400`, `35401`, `35402`)**:
   - Built as NIP-33 parameterized replaceable events with `["d", "<d-tag>"]`.
   - To create or edit: Publish with the current timestamp (`created_at = now`). Relays replace any previous event with matching `(pubkey, kind, d)`.
   - No custom anchor tag, no auto-renew background jobs, and no NIP-40 expiration.

Example Mutable Rating & Review Event (`kind: 35400`):
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
    ["rating", "8"],
    ["spoiler", "0"]
  ],
  "content": "Still holds up remarkably well. Rewatched director's cut."
}
```

Example Mutable Similar Suggestion Event (`kind: 35401`):
```json
{
  "kind": 35401,
  "created_at": 1788900000,
  "tags": [
    ["d", "5d974f7d08efef728f3e77f6f910291782d657b47a37374045b89301c6ee1f30"],
    ["contentid", "5d974f7d08efef728f3e77f6f910291782d657b47a37374045b89301c6ee1f30"],
    ["trackstr", "web"],
    ["type", "movie"],
    ["name", "Fight Club"],
    ["year", "1999"],
    ["similar", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "movie", "The Matrix", "1999"],
    ["s", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]
  ],
  "content": "Mind-bending reality questioning and anti-establishment themes."
}
```

### Deletion (NIP-09)

Instead of fragile, expiring client-side tombstones, Trackstr uses native Nostr **NIP-09 deletion requests** (`kind: 5`):
1. For replaceable events (`35400`, `35401`, `35402`): Emit a `kind: 5` event with an `["a", "<kind>:<pubkey>:<d-tag>"]` coordinate tag.
2. Compliant relays delete or suppress the referenced events; clients filter them out upon receiving the deletion notice.

---

### Taxonomy & Conventions (Ratings, Status, Suggestions, Sync)

- **Rating scale (`35400`)**: Standard scale is **1 to 10**. Expressed as numeric string (e.g. `"8"` or half-step `"8.5"`). Math is `sum(ratings) / count(ratings)` on a 10-point scale.
- **Activity status enum (`35402`)**:
  - Movies & Shows: `"plan-to-watch"`, `"watching"`, `"completed"`, `"on-hold"`, `"dropped"`.
  - Music: `"plan-to-listen"`, `"listening"`, `"completed"`.
- **Similar suggestions (`35401`)**:
  - Aggregated across Nostr relays by `source_contentid`. Distinct recommending authors act as community votes, ordering suggestions by consensus.
- **Local-first delta sync**:
  - Clients cache winning items in local storage (IndexedDB).
  - Background delta-sync queries relays with `{"kinds": [35400, 35401, 35402], "since": <last_synced_unix_timestamp>}` for instant UI loading without relay wait.

---

### Agent Checklist (Every Diff Touching Nostr)

- [ ] Use **NIP-33 Parameterized Replaceable Kinds (`35400`, `35401`, `35402`)** for all mutable state; ensure `["d", "<d-tag>"]` is set properly (`<contentid>` or `<contentid>:s<season>e<episode>`).
- [ ] No regular scrobble logs (5402) or NIP-40 expiration tags (`["expiration", ...]`) are emitted.
- [ ] Every event carries exactly one `["trackstr", "<app-id>"]` app attribution tag.
- [ ] Every event with a media ref carries a valid `contentid` computed per the scheme (`norm()` byte-exact) and a matching `["d", "<contentid>"]` tag for relay filtering.
- [ ] No proprietary IDs (TMDB, IMDb, MBID) are tagged on Nostr events; join strictly on `contentid`.
- [ ] No redundant `t` tags are emitted (`kind` + `trackstr` tag fully namespace the event).
- [ ] Activity events use canonical status strings (`plan-to-watch`, `watching`, `completed`, `on-hold`, `dropped`, `plan-to-listen`, `listening`).
- [ ] Deletions use standard **NIP-09 (`kind: 5`)** deletion events referencing the addressable coordinate.

