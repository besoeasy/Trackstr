# Trackstr

**Track everything you love. Own your taste.**

Trackstr is an open, Nostr-powered media tracking and social platform for movies, shows, and music.

## ✨ Features

* 🎬 Track movies and shows
* 🎵 Track music and listening history
* ⭐ Rate and review media
* 📋 Create watchlists
* 👥 Follow friends and discover their activity
* 🔐 Nostr-based identity
* 🌐 Open and portable user data
* 🔌 Connect services like Spotify, Plex, Jellyfin, and more

## 🧩 Supported Media

* Movies
* Shows
* Music

## 🏛️ Architecture & Nostr Event Design

Trackstr adopts a clean separation between **mutable state** and **immutable historical logs**, avoiding artificial expiration countdowns and relay bloat:

| Data Category | Purpose | Nostr Event Pattern | Why |
|---|---|---|---|
| **Mutable State** (Watch status, current rating, watchlists, metadata) | Current status or latest value per media item | **NIP-33 Parameterized Replaceable Events** (`kind: 30000..39999`) | Relays automatically overwrite older versions per `(pubkey, kind, d-tag)`. Zero relay bloat, zero auto-renew needed. |
| **Immutable Logs** (Listening history, scrobbles, check-ins, written reviews) | Point-in-time historical diary entries | **Regular Kinds** (`kind: 1000..9999`) with **NO expiration** | Scrobbles and reviews are historical diary entries; they remain permanent forever without maintenance. |
| **Deletions** | Removing an event | **NIP-09 Deletion Requests** (`kind: 5`) | Native protocol deletion standard across relays and clients. |

### Architectural Evolution

| Aspect | Previous Expiry Model (Flawed) | Trackstr Modern Architecture |
|---|---|---|
| **Mutable State (Watch status, current rating)** | Regular kinds (5400) + custom anchor + 10y expiry + auto-renew loop | **NIP-33 Parameterized Replaceable Events** (`kind: 30000..39999`) — relays automatically overwrite older versions per `(pubkey, kind, d-tag)`. Zero relay bloat, zero auto-renew needed. |
| **Immutable Logs (Listening history, scrobbles, reviews)** | Regular kinds + 10y expiry + auto-renew | **Regular Kinds** (`kind: 1000..9999`) with **NO expiration** — scrobbles and reviews are historical diary entries; they remain permanent forever without maintenance. |
| **Deletions** | Expiring tombstones (risk resurrecting deleted items after 10y) | Standard **NIP-09 Deletions** (`kind: 5`) |
| **Relay Footprint** | Accumulates thousands of redundant revisions and renew events | Minimal; relays store current state for mutable items and true history for logs |
| **Offline Safety** | Data wiped by relays if user is inactive > 10 years | Safe; permanent user ownership without artificial countdowns |

## 🛠️ Built With

* **Vue.js**
* **Vite**
* **Nostr**
* **TypeScript**
* **[Originless](https://github.com/besoeasy/Originless)** — decentralized IPFS storage backend for media assets
* **TMDB** — movie & TV metadata (client UI presentation)
* **MusicBrainz** — music metadata (client UI presentation)

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

## 🚧 Status

Trackstr is currently in early development.

Expect things to change.

## 🤝 Contributing

Contributions, ideas, and feedback are welcome.

More details coming soon.

## 📜 License

TBD
