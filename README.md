# Trackstr — Open-Source Media Tracker (Letterboxd + Trakt + Last.fm Alternative)

**Track everything you love. Own your taste.**

Trackstr is a free, open-source media tracker for **movies, TV shows, and music** — a decentralized, privacy-first **Letterboxd alternative, Trakt alternative, and Last.fm alternative** in one app. Track your watchlist, rate, review, scrobble your listening history, and follow friends — with all ratings, reviews, and activity owned by your **Nostr** identity and media stored on **IPFS**, not locked in a walled garden.

👉 **Live demo:** https://trackstr.besoeasy.com/

[![Live Demo](https://img.shields.io/badge/demo-trackstr.besoeasy.com-blue?style=flat-square)](https://trackstr.besoeasy.com/)
[![Nostr Protocol](https://img.shields.io/badge/protocol-nostr-purple?style=flat-square)](https://nostr.com/)
[![IPFS](https://img.shields.io/badge/storage-IPFS%20via%20Originless-cyan?style=flat-square)](https://originless.gupt.app/)
[![Vue 3](https://img.shields.io/badge/vue-3-emerald?style=flat-square)](https://vuejs.org/)
[![License](https://img.shields.io/badge/license-TBD-lightgrey?style=flat-square)](#-license)

> If you like Trackstr, please ⭐ star this repo — it helps others discover a truly open media tracker.

## Table of Contents

- [Why Trackstr?](#-why-trackstr)
- [Features](#-features-movie-tracker--tv-show-tracker--music-tracker)
- [Letterboxd vs Trakt vs Last.fm vs Trackstr](#-letterboxd-vs-trakt-vs-lastfm-vs-trackstr)
- [Supported Media](#-supported-media)
- [Built With](#️-built-with)
- [How Your Data Stays Yours (Nostr + IPFS)](#-how-your-data-stays-yours-nostr--ipfs)
- [Vision](#️-vision)
- [Getting Started](#-getting-started)
- [Contributing](#-contributing)
- [License](#-license)

## 💡 Why Trackstr?

- **One tracker for everything:** movie tracker, TV show tracker (series + episode tracking), and music tracker with scrobbling — no need for three separate apps.
- **Own your data:** your watch history, ratings, reviews, watchlists, and social graph live on Nostr under your keys. Export anytime, never locked in.
- **Privacy-first & decentralized:** no ads, no data harvesting. Censorship-resistant relays + content-addressed IPFS media via Originless.
- **Social by design:** follow friends, discover what they're watching and listening to, build community-curated metadata.
- **Open source:** auditable Vue 3 + Vite JavaScript codebase. Self-host the frontend in minutes.

## ✨ Features (Movie Tracker + TV Show Tracker + Music Tracker)

* 🎬 **Movie tracking** — log watched films, plan-to-watch watchlists, per-status library (watching, completed, on-hold, dropped)
* 📺 **TV show & episode tracking** — follow series, track seasons/episodes, never ask “which episode were we on?” again
* 🎵 **Music tracking & scrobbling** — log albums/tracks, scrobble listening history, plan-to-listen lists
* ⭐ **Ratings (1–10)** — rate movies, shows, episodes, and music; half-steps supported
* ✍️ **Reviews with spoilers** — write permanent spoiler-tagged reviews
* 📋 **Watchlists & lists** — plan-to-watch / plan-to-listen queues and custom collections
* 👥 **Social discovery** — follow friends (NIP-02), activity feeds, community ratings consensus
* 🔐 **Nostr identity** — log in with NIP-07 browser extensions (Alby, nos2x); no passwords to leak
* 🌐 **Portable user data** — NIP-33 replaceable state + permanent NIP-01 logs; standard NIP-09 deletes
* 🔌 **Integrations** — connect Spotify, Plex, Jellyfin, and more; metadata from TMDB, TVMaze, Wikipedia & MusicBrainz
* 🖼️ **Decentralized artwork** — posters/banners pinned to IPFS via Originless (`ipfs://<CID>`), community-seeded

## 🆚 Letterboxd vs Trakt vs Last.fm vs Trackstr

| Need | Letterboxd | Trakt | Last.fm | **Trackstr** |
|---|---|---|---|---|
| Movie diary, ratings, reviews, watchlist | ✅ | partial | ❌ | ✅ |
| TV show + episode tracking | ❌ | ✅ | ❌ | ✅ |
| Music tracking + scrobbling | ❌ | ❌ | ✅ | ✅ |
| Open source | ❌ | ❌ | ❌ | ✅ |
| Own your data (no lock-in) | ❌ | ❌ | ❌ | ✅ Nostr keys |
| Decentralized, privacy-first | ❌ | ❌ | ❌ | ✅ Nostr + IPFS |
| Spotify / Plex / Jellyfin sync | partial | ✅ | ✅ | ✅ |

Looking for an **open-source Letterboxd alternative** that also covers TV, a **Trakt alternative** without the walled garden, or a **Last.fm alternative** that respects privacy? Trackstr is all three — with your history under your control.

## 🧩 Supported Media

* **Movies** — theatrical films, release year tracking, TMDB + Wikipedia synopses
* **TV Shows** — series, seasons & episodes (season `0` = specials), TVMaze schedules
* **Music** — artists, albums & tracks via MusicBrainz

## 🛠️ Built With

* **Vue.js 3** + **Vite** (Pure JavaScript) — fast, lightweight web app
* **Custom CSS Design System** (Zero bloated CSS frameworks)
* **Nostr Protocol**:
  * **NIP-33** Parameterized Replaceable Events (`kinds 35400–35403`) for mutable state — ratings, watch status, community metadata (zero relay bloat, zero auto-renew)
  * **NIP-01** Regular Kinds (`kinds 5401–5402`) for permanent historical logs — written reviews & scrobbles/check-ins without expiration
  * **NIP-09** Deletion Requests (`kind: 5`) for removals
  * **NIP-07** Browser extension signing (Alby, nos2x)
  * **NIP-02** Follows (`kind: 3`) + **NIP-01** Profiles (`kind: 0`)
* **[Originless](https://github.com/besoeasy/Originless)** — decentralized IPFS storage backend for media assets (`ipfs://<CID>`)
* **Multi-Source Metadata Engine** (presentation only — never stored on Nostr as proprietary IDs):
  * **TMDB** — movies & series metadata, credits & high-res artwork
  * **TVMaze** — TV series schedules, networks & episode status (100% open)
  * **Wikipedia REST API** — theatrical film synopses (100% open)
  * **MusicBrainz** — music releases, tracks & artists (100% open)

## 🔑 How Your Data Stays Yours (Nostr + IPFS)

* **Mutable state** (current rating `35400`, watch/listening status `35402`, community metadata `35403`) uses NIP-33 parameterized replaceable events keyed by `(kind, pubkey, d-tag)` — relays keep only the latest, so updates never bloat relays.
* **Immutable logs** (written reviews `5401`, scrobbles/check-ins `5402`) are permanent NIP-01 diary entries with no expiration tags.
* Every event carries one `["trackstr", "<app-id>"]` tag and joins on provider-free `contentid` (`sha256` of normalized `type|title|year`) — no TMDB/IMDb/MBIDs on relays.
* Deletions follow standard NIP-09 (`kind: 5`).
* Posters/banners use `ipfs://<CID>` via Originless — permanent, content-addressed, no S3/Imgur hotlinks.

See [AGENTS.md](./AGENTS.md) for the full event schema and contributor checklist.

## 🏗️ Vision

Trackstr aims to become a **portable social layer for your media life**.

Your activity, ratings, reviews, watchlists, and social graph belong to your Nostr identity — not to a centralized platform.

```text
Spotify ─────┐
Plex ────────┤
Jellyfin ────┤
             ▼
          Trackstr
             │
             ▼
           Nostr
             │
       ┌─────┼─────┐
       ▼     ▼     ▼
     Movies  Music  Shows
```

## 🚀 Getting Started

```bash
# 1. Clone the open-source media tracker
git clone https://github.com/besoeasy/Trackstr.git
cd Trackstr

# 2. Install & run (Node 22+)
npm install
npm run dev
```

```bash
# Run the automated test suite (Vitest unit tests)
npm test
```

Open http://localhost:5173, connect a Nostr extension (Alby / nos2x), and start tracking movies, shows, and music. To deploy, run `npm run build` and host the static `dist/` anywhere — your data still lives on Nostr relays you choose.

## 🤝 Contributing

Contributions, ideas, and feedback are welcome — especially around movie/TV/music tracking UX, Nostr relay behavior, metadata curation, and Spotify/Plex/Jellyfin sync.

More details coming soon. In the meantime, please ⭐ star the repo and open an issue with what you'd track first.

## 📜 License

TBD
