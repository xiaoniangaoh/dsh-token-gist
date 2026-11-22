# Token Usage Statistics · token用量统计

A DeepSeek Harness (DSH) plugin that keeps a **cumulative token usage total** and syncs it to a **GitHub gist**. The total lives in its own file and is folded from newly committed session events, so it is **not** derived from session logs — deleting, archiving, or compacting a conversation never reduces the total.

## What it does

- **Cumulative totals** across every conversation (including subagents), counted from provider-reported usage: input, output, cache-read, and cache-write tokens.
- **Survives conversation deletion** — the running total is independent of the session log. Only *new* model attempts are added, so a restored session is never double-counted.
- **Gist backup** — the total (plus a per-day breakdown) is pushed to a private GitHub gist. Auto-sync on an interval and one-click manual sync.
- **Sidebar card** — shows the running total and the last sync status, with a "sync" button.
- **Slash command** — `/token-usage` prints the totals; `/token-usage sync` pushes to gist immediately.
- **Local persistence** — state is written atomically to `$DSH_HOME/dsh-token-gist/state.json`.

## Install

From a local directory (this checkout):

```
plugin_manager  action: install_bundle  target: <absolute path to this directory>
```

## Configure

Configure in **Settings → Plugins** (the plugin's own page), or edit `cordis.patch.yml`:

| Field | Default | Meaning |
|---|---|---|
| `gistToken` | — | GitHub personal access token with **gist** write scope. A fine-grained PAT limited to "Gists → read and write" is recommended. |
| `gistId` | — | Existing gist id to update. Empty = create a new gist on the first sync. |
| `gistFilename` | `dsh-token-usage.json` | Filename inside the gist. |
| `autoSync` | `true` | Sync to gist automatically on an interval. |
| `syncIntervalMinutes` | `30` | Auto-sync interval (1–1440). |
| `description` | `DSH token usage total` | Gist description. |

You can also set the token through the environment variable `DSH_TOKEN_GIST_TOKEN`.

## Notes and limits

- Counting starts when the plugin is installed. Token usage from *before* installation is not back-filled (session history is not replayed into the counter).
- The total uses provider-reported usage. When a provider reports none, that attempt contributes zero (matching DSH's own token-meter).
- The gist stores totals and a per-day breakdown only — it never uploads conversation content.
- The token is stored in your local profile config. Use a narrowly-scoped, revocable token.

## License

MIT
