# YouTube Live — Comments and ratings (Studio vs. public API)

Research date: **2026-06-20**. Sources: [YouTube Data API v3](https://developers.google.com/youtube/v3), [YouTube Live Streaming API — `liveBroadcasts`](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts), [`videos`](https://developers.google.com/youtube/v3/docs/videos), [`videos.update`](https://developers.google.com/youtube/v3/docs/videos/update), [`commentThreads`](https://developers.google.com/youtube/v3/docs/commentThreads), [`liveChatMessages`](https://developers.google.com/youtube/v3/live/docs/liveChatMessages), and [API revision history](https://developers.google.com/youtube/v3/revision_history) (deprecation of `brandingSettings.channel.moderateComments`, March 7, 2024).

YouTube Studio’s live-broadcast scheduler exposes a **Comments and ratings** section with five controls. VideoSphere maps them to `YouTubeLivestreamFields` in `types/index.ts`. This note records which settings the **public API can read or write today**.

| Studio control | VideoSphere field | API-controllable? | Public API surface |
| --- | --- | --- | --- |
| **Comments** (on / disable / hold for review) | `commentsMode` | **No** | Not exposed by the public API as of 2026-06-20. `liveBroadcasts` has no comment-mode or live-chat enable/disable field in `contentDetails` or `status` ([resource schema](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts)). Live chat is created automatically when a broadcast is scheduled ([`liveChatMessage` docs](https://developers.google.com/youtube/v3/live/docs/liveChatMessages)); runtime chat can be managed via `liveChatMessages`, `liveChatModerators`, and `liveChatBans`, but not the Studio tri-state (on / off / hold for review). `videos.status` has no writable comment-enable flag on [`videos.update`](https://developers.google.com/youtube/v3/docs/videos/update). Comment disabled state is only inferable indirectly (e.g. `commentThreads.list` → `403 commentsDisabled`), not as a schedulable broadcast property. |
| **Moderation** (hold potentially inappropriate messages — Basic / Strict) | `moderateComments` | **No** | Not exposed by the public API as of 2026-06-20. Studio moderation level is a channel/community setting ([YouTube Help — Moderate live chat](https://support.google.com/youtube/answer/9826490)). The deprecated channel field `brandingSettings.channel.moderateComments` was removed from API support on **March 7, 2024** ([revision history](https://developers.google.com/youtube/v3/revision_history)). No per-broadcast moderation-level field exists on `liveBroadcasts`. |
| **Who can comment** | `whoCanComment` | **No** | Not exposed by the public API as of 2026-06-20. Restrictions such as “Subscribers only” or “Approved users only” are configured in YouTube Studio / Community settings only ([YouTube Help](https://support.google.com/youtube/answer/9826490)). No corresponding property on `liveBroadcasts`, `videos`, or `liveChatMessages`. |
| **Sort by** | `commentsSortOrder` | **No** | Not exposed by the public API as of 2026-06-20. `liveChatMessages.list` returns messages in API order; display sort is client-side / Studio-only. No broadcast or video metadata field for comment sort order. |
| **Show how many viewers like this stream** | `showViewerLikeCount` | **Yes (read/write)** | Maps to **`videos.status.publicStatsViewable`** (boolean). Readable via `videos.list` (`part=status`) and writable via `videos.update` (`part=status`) on the underlying video id (same id as the `liveBroadcast`). Docs: [`videos#status.publicStatsViewable`](https://developers.google.com/youtube/v3/docs/videos#status.publicStatsViewable). When `false`, extended watch-page statistics (including public like counts) are hidden; view count remains visible. |

## Implications for VideoSphere

- **Functional via API today:** only `showViewerLikeCount` ↔ `videos.status.publicStatsViewable`.
- **Local preferences only (Prompt 14 UI):** `commentsMode`, `moderateComments`, `whoCanComment`, `commentsSortOrder` — stored on the livestream document for user reference; **not sent to YouTube** until Google exposes equivalent API fields.
- **Defaults endpoint:** `GET /api/platforms/youtube/live-comment-options` returns `showViewerLikeCount` when discoverable from the channel’s recent live broadcast or latest upload, plus an `unsupported` list naming the four Studio-only keys.

## Related API resources (runtime, not scheduling)

These support **during-live** moderation, not Studio scheduling defaults:

- `snippet.liveChatId` on `liveBroadcast` → `liveChatMessages.list` / `insert` / `delete`
- `liveChatModerators.insert` / `delete` — assign moderators
- `liveChatBans.insert` — ban participants
