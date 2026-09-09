---
name: facebook-page-manager
description: "Build an autonomous Facebook page management agent in Node.js using the Graph API (content generation, scheduling, comment auto-replies, analytics, monetization readiness), plus the developer-app/token setup flow. Use when the user wants to automate or monetize a Facebook page."
---

# Facebook Page Manager Agent

Builds a standalone Node.js agent that manages a Facebook page: AI-drafted content,
scheduled posting cadence, comment auto-replies, analytics, and monetization
readiness tracking, controllable from Telegram.

## When to use

- User asks to "build a Facebook agent / automate a Facebook page / grow a page"
- User wants page management, scheduling, or comment auto-replies
- User wants monetization tracking or strategy for a page (Reels watch time, in-stream ads, subscribers)

## Required tools / APIs

- **Facebook Graph API** (free): page posting, scheduling, comments, insights. Requires a Facebook Developer app + user token.
- **Local LLM via ollama** (free, optional): content drafting. Any OpenAI-compatible endpoint works.
- **Telegraf** (free): optional Telegram control bot: `npm install telegraf`
- **node-cron** (free): scheduler tick: `npm install node-cron`

```bash
npm install telegraf node-cron dotenv
```

## Skills

### 1. Set up credentials (the 90% blocker)

1. Create a developer app at https://developers.facebook.com → My Apps → Create App → Business type. Add the **Facebook Login** product.
2. Grant the user token these permissions (work for pages you administer, no app review needed): `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement`, `read_insights`.
3. Get a token in the **Graph API Explorer** (select your app → permissions → Generate Access Token).
4. Exchange for a long-lived token (60 days) in a browser:
   ```
   https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=USER_TOKEN
   ```
5. Page ID is under the page's **About** tab (or resolve via `GET /me/accounts`).

### 2. Graph API client (Node.js)

```javascript
const BASE = "https://graph.facebook.com/v21.0";
const TOKEN = process.env.FB_USER_TOKEN;

async function graph(path, params = {}, method = "GET") {
  const url = new URL(`${BASE}/${path}`);
  if (method === "GET") Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("access_token", TOKEN);
  const opts = { method };
  if (method !== "GET") {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify({ ...params, access_token: TOKEN });
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (data.error) throw new Error(`Graph API ${data.error.code}: ${data.error.message}`);
  return data;
}

// list pages
const pages = await graph("me/accounts", { fields: "id,name,access_token" });
// post text
await graph("PAGE_ID/feed", { message: "hello" }, "POST");
// schedule (published:false + unix seconds)
await graph("PAGE_ID/feed", { message: "later", published: false, scheduled_publish_time: 1786500000 }, "POST");
// comment replies (needs pages_manage_engagement)
await graph("COMMENT_ID/replies", { message: "Thanks!" }, "POST");
// insights (cumulative day-period values)
await graph("PAGE_ID/insights", { metric: "page_fans,page_impressions,page_engaged_users,page_video_views", period: "day" });
```

Key facts:
- Page-scoped tokens (`/PAGE_ID?fields=access_token` or from `/me/accounts`) don't expire for pages you administer; the user token lasts ~60 days.
- `scheduled_publish_time` is **unix seconds**, not ms.
- Errors come back as `{error:{code,message}}`; 190 = expired token, 200 = missing permission, 429 = rate limit (retry with backoff).

### 3. Content + engagement loop

- Draft posts with a local model (ollama OpenAI-compatible endpoint: `POST {OLLAMA_URL}/v1/chat/completions` — note the `/v1` — with `{"model":"qwen2.5:1.5b","messages":[...],"stream":false}`; read the draft from `choices[0].message.content`). Health-check ollama with `GET {OLLAMA_URL}/api/tags`.
- Posting cadence: a minute-level cron tick that (a) fires due jobs, then (b) tops up the next 24h to `POSTS_PER_DAY` slots.
- Engagement: poll `GET PAGE_ID/feed?fields=comments.limit(10){id,message,from,created_time}`, reply once per unseen comment, track seen ids in a JSON store.
- **Always support a DRY_RUN mode** (`DRY_RUN=true`) so the whole pipeline runs and is testable before real credentials exist. Verify top-up idempotency: running the tick twice must schedule `0` additional posts (persist `scheduled`/`fired` flags per post, not just a published list).

### 4. Monetization focus

Track the classic in-stream-ads gates and drive them:
- 10,000 followers
- 30,000 × 1-minute video views in 60 days

Report progress % toward each gate, deltas vs last snapshot, and advice (3s hooks, captions, save/share CTAs, video cadence). Remind users that Meta's actual eligibility (e.g. "Ads on Reels") has its own rolling rules — verify in the page's Professional Dashboard.

## Output format

The agent should report:
- Page status: name, id, live/dry-run mode
- Analytics: followers, impressions, engaged users, video views + deltas
- Monetization: % toward each gate + concrete next actions
- Scheduled jobs: id, status, time, preview

Errors: `Graph API <code>: <message>` plus the fix (refresh token / grant permission).

## Rate limits / Best practices

- Back off on HTTP 429 / 5xx (retry up to 3x with exponential delay).
- Never reply to the same comment twice — persist seen ids.
- Keep a DRY_RUN flag and never hardcode tokens (`.env`, git-ignored).
- Graph API tokens are credentials — never commit them, redact in logs.

## Agent prompt

```text
You have Facebook Page Manager capability. When a user asks to build or run a Facebook page agent:
1. Confirm whether they already have a Facebook Developer app + user token. If not, walk them through the setup flow above.
2. Build the agent as a standalone Node service: Graph client, content generator (local ollama first), scheduler, engagement poller, analytics, monetization tracker.
3. Ship with DRY_RUN=true so it runs before credentials exist; only flip to live after `doctor` checks pass.
4. Track monetization gates and always verify eligibility rules in Meta's dashboard rather than promising monetization.
```

## Troubleshooting

**`Graph API error 190` / "token expired"**
- Re-run the `fb_exchange_token` step to refresh the long-lived user token.

**`Graph API error 200` permission**
- The token lacks a permission or the app needs review. Regenerate the token and re-approve permissions.

**`403` on comment replies**
- Missing `pages_manage_engagement`, or replying on a post you don't manage.

**`429` rate limit**
- Add exponential backoff and reduce poll frequency (Graph API ~600 calls/600s per token).

## See also

- [../using-telegram-bot/SKILL.md](../using-telegram-bot/SKILL.md) — Telegraf patterns used for the control bot
