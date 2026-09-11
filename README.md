<img width="1646" height="1613" alt="image" src="https://github.com/user-attachments/assets/d31353e8-94ab-48d6-84d0-04ab8eac5e04" />


# Trackstr

> **The Open-Source Media Tracker & Decentralized Media Database.**  
> Replacing Letterboxd, Trakt, and Last.fm for tracking — and replacing IMDb and TMDB with an open, permissionless protocol for developers.

[![Live Demo](https://img.shields.io/badge/demo-trackstr.besoeasy.com-blue?style=flat-square)](https://trackstr.besoeasy.com/)
[![Protocol](https://img.shields.io/badge/protocol-nostr-purple?style=flat-square)](https://nostr.com/)
[![Stack](https://img.shields.io/badge/stack-Vue%203%20%7C%20Vite-emerald?style=flat-square)](https://vuejs.org/)
[![Tests](https://img.shields.io/badge/tests-155%20passing-brightgreen?style=flat-square)](#-testing)
[![License](https://img.shields.io/badge/license-MIT%20%2F%20Open-lightgrey?style=flat-square)](#-license)

Trackstr unites personal media tracking and an open social layer into a single decentralized stack:

1. **For Users:** A unified personal tracker for **movies, TV shows & episodes, and music**. Track watchlists, rate (1–10), write spoiler-tagged reviews, discover community similar suggestions, and follow friends. You own your identity, library, and social graph via **Nostr** cryptographic keys.
2. **For Developers & The Open Web:** An open, permissionless protocol. Your media library, ratings, suggestions, and social interactions live on Nostr relays, accessible to any developer without API keys or vendor lock-in.

---

## ⚡ The Shift: Centralized vs Trackstr

| Dimension | Legacy Trackers (Letterboxd, Trakt, Last.fm) | Commercial DBs (IMDb, TMDB) | **Trackstr** |
| :--- | :--- | :--- | :--- |
| **Scope** | Siloed (separate apps for movies, TV, music) | Metadata catalogs only | **All-in-one** (Movies, TV series, episodes, music) |
| **Data Ownership** | Proprietary servers; locked-in diaries | Proprietary datasets | **Self-sovereign** (owned by your Nostr pubkey) |
| **Developer API** | Heavily restricted or non-existent | Paywalled tiers, rate limits, commercial licenses | **100% Free & Permissionless** (query any Nostr relay) |
| **Content ID** | Proprietary internal identifiers | `tt...`, `tmdb_id` vendor lock-in | **Deterministic SHA-256** (`sha256(canonical_string)`) |
| **Media Metadata** | Proprietary & locked | Proprietary image CDNs & paywalls | **Open & Direct** (Wikipedia, TVMaze, TMDB, MusicBrainz) |

---

## ✨ Features

- 🎬 **Unified Media Tracking:** Track films, follow TV series season-by-season and episode-by-episode, and track music albums and tracks.
- ⭐ **Ratings & Reviews:** 1–10 scale ratings (half-steps supported) and permanent, spoiler-tagged reviews.
- 💡 **Community Similar Suggestions:** Crowd-sourced recommendation graph (Kind 35401) where users suggest similar titles, creating a decentralized feedback loop without black-box algorithms.
- 📋 **Flexible Libraries:** Manage statuses (`plan-to-watch`, `watching`, `completed`, `on-hold`, `dropped`, `plan-to-listen`, `listening`).
- 🌐 **Open Media Presentation:** Client-side integration with open sources like Wikipedia, TVMaze, and MusicBrainz without proprietary vendor lock-in.
- 🔐 **Cryptographic Auth:** Log in with NIP-07 browser extensions (Alby, nos2x) or local `nsec` keys. Zero email/password dependencies.
- 🔌 **Open Aggregation:** Fallbacks and imports for Wikipedia, TVMaze, and MusicBrainz, with support for Spotify, Plex, and Jellyfin history.

---

## 🛠️ Developer Protocol & Architecture

Trackstr replaces centralized REST APIs with open Nostr event kinds and deterministic content addressing. Any client can read and build on this data without authentication or API tokens.

### 1. Nostr Event Kinds

| Kind | Type | NIP | Purpose |
| :--- | :--- | :--- | :--- |
| **`35400`** | Parameterized Replaceable | NIP-33 | Mutable user rating (1–10) & written reviews (with spoiler flags). Keyed by `d` tag (`contentid` or `contentid:s{season}e{episode}`). |
| **`35401`** | Parameterized Replaceable | NIP-33 | Mutable similar title suggestions (community recommendation feedback loop). Keyed by `d` tag (`source_contentid`). |
| **`35402`** | Parameterized Replaceable | NIP-33 | Mutable watch/listen status and episode progress. |
| **`5`** | Deletion | NIP-09 | Cryptographic deletion notices referencing replaceable coordinates. |

### 2. Provider-Free Canonical Content ID

To avoid dependency on IMDb IDs (`tt1234567`) or TMDB IDs, Trackstr computes a deterministic SHA-256 hash from normalized metadata:

```javascript
// Movies & TV Shows
canonicalString = `${norm(type)}|${norm(title)}|${norm(year)}`

// Music Releases
canonicalString = `music|${norm(artist)}|${norm(title)}|${norm(year)}`

// Deterministic 64-character hex ID:
contentId = sha256(canonicalString)
```

*Normalization applies Unicode NFKC normalization, lowercase conversion, trimmed whitespace, and delimiter escaping (`\|`).*

### 3. Querying Ratings & Watch History (Zero API Keys)

Any developer or client can query user ratings, watch status, and reviews directly from standard Nostr relays without accounts, tokens, or rate limits:

```javascript
import { SimplePool } from 'nostr-tools'

const pool = new SimplePool()
const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

// Query all ratings and reviews for any title by contentId
const events = await pool.querySync(relays, {
  kinds: [35400],
  '#d': [contentId]
})
```

---

## 🚀 Quickstart

### Prerequisites
- Node.js `22+` (or Podman / Docker)

### Run with Node
```bash
# Clone the repository
git clone https://github.com/besoeasy/Trackstr.git
cd Trackstr

# Install dependencies & start dev server
npm install
npm run dev
```

### Run with Podman (Containerized)
All workflows run in Node LTS containers — no host Node or npm required:
```bash
# Development server (http://localhost:5173)
npm run dev:podman

# Run test suite
npm run test:podman

# Static production build
npm run build:podman

# Preview production build (http://localhost:4173)
npm run preview:podman
```

---

## 🧪 Testing

The Vitest suite covers Nostr event builders, canonical content ID hashing, local key signing, and metadata parsers:

```bash
npm test
# Or containerized:
npm run test:podman
```

---

## 📦 Production Deployment

Trackstr compiles to a 100% static, client-side bundle with zero backend dependencies (your data lives on Nostr relays):

```bash
npm run build
```

The output in `dist/` can be served by any static host (Cloudflare Pages, Vercel, GitHub Pages, Nginx). A production-ready [Dockerfile](./Dockerfile) and [nginx.conf](./nginx.conf) are provided.

---

## 🤙 Vibe Coders & AI Builders Welcome

Building with Cursor, Claude, ChatGPT, Copilot, or Antigravity? **You're in the right place.**

Trackstr is engineered to be an ideal playground for AI-assisted development:
- **Zero Backend Friction:** No database servers, no microservices, and no credentials to configure. Run `npm run dev` and your frontend connects directly to open Nostr relays.
- **No API Keys or Paywalls:** Build media features without waiting for TMDB API approvals or paying IMDb enterprise licensing fees. Query and publish freely.
- **Agent-Ready Context:** Hand [AGENTS.md](./AGENTS.md) directly to your AI coding agent — it contains the complete event schema, deterministic content ID hashing rules, and validation checklists.
- **Sub-Second Test Feedback:** 150+ Vitest unit tests run in under 1 second (`npm test` or `npm run test:podman`), enabling fast, automated AI iteration loops.

Have an idea for a custom theme, a mini player, a Raycast extension, a Discord bot, or a CLI? Fork it, prompt your favorite model, and ship it.

---

## 🤝 Contributing

Contributions are welcome! Whether you are building client applications on top of Trackstr's open data, improving metadata curation, or adding scrobbler integrations:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/open-metadata`)
3. Commit your changes (`git commit -m 'feat: open metadata enhancement'`)
4. Push to the branch (`git push origin feature/open-metadata`)
5. Open a Pull Request

---

## 📜 License

Open source under the [MIT License](https://opensource.org/licenses/MIT).

