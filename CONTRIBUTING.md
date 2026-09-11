# Contributing to Trackstr 🎬✨

Welcome! We are thrilled that you are interested in contributing to **Trackstr**.

Trackstr is building the open-source media tracking and decentralized media database layer for the web — combining the tracking power of Letterboxd, Trakt, and Last.fm with an open, permissionless protocol on Nostr.

Whether you want to fix a typo, design a feature, expand metadata sources, build scrobbler integrations, or experiment with AI vibe coding, **your contributions are welcomed and appreciated!**

---

## 🌟 Why Contribute to Trackstr?

- **Zero Backend Friction:** No Postgres, Redis, or microservices to set up. Trackstr is a 100% static client-side Vue 3 application that speaks directly to open Nostr relays and caches locally in IndexedDB.
- **No API Keys or Paywalls Required:** Everything works out-of-the-box using public relays and open metadata providers (Wikipedia, TVMaze, MusicBrainz).
- **Vibe Coding & Agent-Ready:** We love AI-assisted development! Our repository is pre-configured with [AGENTS.md](./AGENTS.md) so you can pair program seamlessly with Cursor, Claude Code, Antigravity, or Copilot.
- **Lightning-Fast Test Feedback:** Over 170+ unit tests run in ~1 second via Vitest (`npm test` or `npm run test:podman`).

---

## 🚀 Getting Started

### Prerequisites
- Node.js `22+` (or [Podman](https://podman.io/) / [Docker](https://www.docker.com/))
- Git

### 1. Fork and Clone
```bash
# Clone your fork
git clone https://github.com/<your-username>/Trackstr.git
cd Trackstr
```

### 2. Install & Start Development

#### With Local Node:
```bash
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

#### With Podman (No local Node/npm needed):
```bash
npm run dev:podman
```

### 3. Running the Test Suite
```bash
# With Node
npm test

# With Podman
npm run test:podman
```

---

## 🗺️ Where to Contribute

Here are exciting areas where help is always wanted:

### 🎨 1. UI & User Experience
- [ ] Mobile navigation and gesture refinements (swipe-to-rate, quick shelf access).
- [ ] Custom themes (OLED black, retro synthwave, high contrast).
- [ ] Keyboard navigation shortcuts for power users.
- [ ] Rich media presentation (trailers, backdrop carousels, cast & crew views).

### 🌐 2. Metadata & Database Sources
- [ ] Enhanced Wikipedia page parser for obscure films and indie music.
- [ ] TVMaze seasonal fallback heuristics and episode guide enrichments.
- [ ] MusicBrainz release group discography enhancements.
- [ ] Open community-driven metadata corrections without proprietary lock-in.

### 🔌 3. Scrobblers & Integrations
- [ ] Importers: Letterboxd CSV, Trakt JSON, Last.fm history, GoodReads exports.
- [ ] Streaming sync: Plex webhooks, Jellyfin sync, Spotify web API bridge.
- [ ] Desktop/mobile scrobbling companion tools or Raycast/Alfred extensions.

### ⚡ 4. Protocol & Nostr Engineering
- [ ] NIP-46 remote signing (Bunker) support for frictionless key management.
- [ ] Dynamic relay discovery and latency-based relay pooling.
- [ ] Decentralized recommendation graph tuning (Kind 35401 community suggestions).
- [ ] Offline-first sync resilience and local IndexedDB optimizations.

### 🌍 5. Internationalization & Docs
- [ ] Multi-language translation support (i18n).
- [ ] Tutorial guides, developer documentation, and walkthrough videos.

---

## 🤖 AI Builders & Vibe Coders Welcome

We actively encourage using AI coding agents (Claude, Cursor, Antigravity, ChatGPT, Copilot). 

To ensure high-quality code when using AI:
1. **Feed [AGENTS.md](./AGENTS.md) to your model:** It contains our architecture philosophy, NIP-33 mutable state rules, canonical content ID hashing specifications, and protocol constraints.
2. **Respect the Content ID Scheme:** All media IDs are deterministic SHA-256 hashes generated from byte-exact normalized strings (`norm(type)|norm(title)|norm(year)`). Never tag proprietary database IDs (TMDB, IMDb) in Nostr events.
3. **Run the Test Suite:** Before submitting a PR, make sure all tests pass:
   ```bash
   npm test # or npm run test:podman
   ```
4. **Add Tests for New Logic:** If you add an event builder, parser, or store mutation, include corresponding unit tests in `src/**/__tests__/`.

---

## 📋 Pull Request Process

1. **Create a feature branch:**
   ```bash
   git checkout -b feat/my-cool-feature
   ```
2. **Make your changes** following our architectural principles.
3. **Verify tests and build:**
   ```bash
   npm test
   npm run build
   ```
4. **Commit with descriptive conventional messages:**
   ```bash
   git commit -m "feat(importer): add Letterboxd CSV watchlist import"
   ```
5. **Push and open a PR** against the `main` branch of `besoeasy/Trackstr`.
6. Explain what your PR achieves, reference any related issues, and include screenshots or GIFs for UI updates!

---

## 📜 Architectural Cheatsheet

If you are touching Nostr events, keep these rules in mind (see [AGENTS.md](./AGENTS.md) for full details):
- **Mutable State (NIP-33):**
  - Kind `35400`: Ratings (1–10 scale) and written reviews (keyed by `d` = `<contentid>` or `<contentid>:s<season>e<episode>`).
  - Kind `35401`: Similar suggestions community graph (keyed by `d` = `<source_contentid>`).
  - Kind `35402`: Watch / listening status and progress (`plan-to-watch`, `watching`, `completed`, `on-hold`, `dropped`, `plan-to-listen`, `listening`).
- **Deletions (NIP-09):** Kind `5` referencing coordinate `a` tags (`<kind>:<pubkey>:<d-tag>`).
- **App Attribution:** Every event carries `["trackstr", "web"]`.

---

## 💬 Community & Questions

- **GitHub Discussions & Issues:** [github.com/besoeasy/Trackstr/issues](https://github.com/besoeasy/Trackstr/issues)
- **Live Demo App:** [trackstr.besoeasy.com](https://trackstr.besoeasy.com/)
- **Repository:** [github.com/besoeasy/Trackstr](https://github.com/besoeasy/Trackstr)

Thank you for helping build an open, self-sovereign media ecosystem! 🚀
