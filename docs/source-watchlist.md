# Source Watchlist

The Source Watchlist tracks specific URLs you publish — blog posts, landing pages, docs — and tells you exactly when LLMs start citing them in responses.

Every analysis run checks each LLM's citations against your watchlist. URLs you add show as *Not yet cited* until they appear in a response, then flip to show the run they debuted in, per-model citation counts, and every response that cited them.

## Adding a URL

Open **Sources → Watchlist**, paste the URL, optionally give it a title, and click **Add**.

![Source Watchlist](/docs/images/source-watchlist.png)

Citations update on the next analysis run. Run filters let you scope results to a specific run or LLM provider.

Tick **Ignore query strings when matching** if the URL's query params are noise (e.g. `?page=2`, `?ref=social`) and you want every variant to count as the same citation.

## Automatically watch every URL on your site

In **Settings → Brand**, the **Automatically watch all brand URLs** checkbox (on by default) tells TraceAIO to fetch your sitemap (`<brand>/sitemap.xml` unless you provide a custom URL) before every analysis run and add every listed URL to the watchlist. Auto-discovered URLs have query strings ignored so any cited variant counts as a match. They show up in the *Auto-discovered* section of the Watchlist, separate from entries you added by hand.

If the checkbox is off, or the sitemap fetch fails, analysis still runs — it just won't pick up new URLs automatically.

## URL matching

URLs are matched on a canonical form — these all collapse to the same watched entry:

- `http://` vs `https://`
- With or without `www.`
- Trailing slashes and path casing
- Tracking query params: `utm_*`, `gclid`, `fbclid`, `msclkid`, `mc_cid`, `_hsenc`, and other common ad-click and analytics identifiers

With **Ignore query strings** enabled, *all* remaining query params are dropped too — so `/blog/post?page=2` and `/blog/post?ref=social` both match `/blog/post`.

Adding `https://yourbrand.com/blog/post` without the flag matches citations to `http://www.yourbrand.com/blog/post/?utm_source=chatgpt` but NOT `https://yourbrand.com/blog/post?page=2`. With the flag it matches both.

## Automating with webhooks

To get notified the moment a watched URL is first cited, pair the run-completion webhook with the polling endpoint:

1. In **Settings → Integrations**, enable the run-completion webhook and point it at your receiver (n8n, Zapier, a Slack-bot endpoint, etc.).
2. When the webhook fires, call:

   ```
   GET /api/watched-urls/new-citations?sinceRunId=<last-seen-run-id>
   ```

3. The endpoint returns only watched URLs *first* cited in a run newer than `sinceRunId` — no duplicates for URLs that were already cited before.

Persist the latest run ID on your side and pass it back as `sinceRunId` on the next poll.

## Claude & MCP

The same filter is exposed to Claude through MCP. Ask Claude:

> *"What did we get newly cited since run 42?"*

And it will call `list-watched-urls` with `sinceRunId=42` and summarize the debut citations for you.

## REST API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/watched-urls` | List watched URLs. Optional `?source=manual\|sitemap`, `?page=1&pageSize=20`, `?citations=true` |
| `GET` | `/api/watched-urls/new-citations?sinceRunId=X` | URLs first cited in a run after `X` |
| `GET` | `/api/watched-urls/:id/citations` | Full citation detail for one URL |
| `POST` | `/api/watched-urls` | Add a URL (`{ url, title?, notes?, ignoreQueryStrings? }`) |
| `PUT` | `/api/watched-urls/:id` | Update title or notes |
| `DELETE` | `/api/watched-urls/:id` | Remove from watchlist |
| `POST` | `/api/sources/extract-sitemap` | Fetch a sitemap and return the listed URLs (`{ url }`). Read-only — does not persist. |

See the [API reference](/docs/api.html) for full request and response schemas.
