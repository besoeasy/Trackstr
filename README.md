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

[![Live Demo](https://img.shields.io/badge/demo-trackstr.besoeasy.com-blue?style=flat-square)](https://trackstr.besoeasy.com/)
[![Nostr Protocol](https://img.shields.io/badge/protocol-nostr-purple?style=flat-square)](https://nostr.com/)
[![IPFS](https://img.shields.io/badge/storage-IPFS%20via%20Originless-cyan?style=flat-square)](https://originless.gupt.app/)
[![Vue 3](https://img.shields.io/badge/vue-3-emerald?style=flat-square)](https://vuejs.org/)

## 🛠️ Built With

* **Vue.js 3** + **Vite** (Pure JavaScript)
* **Custom CSS Design System** (Zero bloated CSS frameworks)
* **Nostr Protocol**:
  * **NIP-33** Parameterized Replaceable Events (`kinds 35400–35403`) for mutable state (zero relay bloat)
  * **NIP-01** Regular Kinds (`kinds 5401–5402`) for permanent historical logs (reviews & scrobbles without expiration)
  * **NIP-07** Browser extension signing (Alby, nos2x)
* **[Originless](https://github.com/besoeasy/Originless)** — decentralized IPFS storage backend for media assets (`ipfs://<CID>`)
* **Multi-Source Metadata Engine**:
  * **TMDB** — movies & series metadata, credits & high-res artwork
  * **TVMaze** — TV series schedules, networks & episode status (100% open)
  * **Wikipedia REST API** — theatrical film synopses (100% open)
  * **MusicBrainz** — music releases, tracks & artists (100% open)

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
