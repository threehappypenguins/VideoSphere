# YouTube Live — Comments and ratings (Studio vs. public API)

Research date: **2026-06-20**. Sources: [YouTube Data API v3](https://developers.google.com/youtube/v3), [YouTube Live Streaming API — `liveBroadcasts`](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts), [`videos`](https://developers.google.com/youtube/v3/docs/videos), [`videos.update`](https://developers.google.com/youtube/v3/docs/videos/update), [`commentThreads`](https://developers.google.com/youtube/v3/docs/commentThreads), [`liveChatMessages`](https://developers.google.com/youtube/v3/live/docs/liveChatMessages), and [API revision history](https://developers.google.com/youtube/v3/revision_history) (deprecation of `brandingSettings.channel.moderateComments`, March 7, 2024).

YouTube Studio’s live-broadcast scheduler exposes a **Comments and ratings** section with five controls. VideoSphere does **not** expose these in the livestream editor today because none are reliably schedulable through the public API for our workflow.

| Studio control | API-controllable? | Notes |
| --- | --- | --- |
| **Comments** (on / disable / hold for review) | **No** | Not exposed by the public API as of 2026-06-20. `liveBroadcasts` has no comment-mode or live-chat enable/disable field. |
| **Moderation** (hold potentially inappropriate messages — Basic / Strict) | **No** | Studio-only channel/community setting. |
| **Who can comment** | **No** | Studio-only. |
| **Sort by** | **No** | Studio-only. |
| **Show how many viewers like this stream** | **Unreliable** | Maps in theory to `videos.status.publicStatsViewable`, but VideoSphere removed this control after manual testing showed YouTube Studio did not reflect API updates consistently for scheduled live broadcasts. Configure in YouTube Studio instead. |

## Implications for VideoSphere

- **Not sent from VideoSphere:** all Comments and ratings settings, including public like-count visibility.
- **Configure in YouTube Studio** after scheduling, or adjust channel defaults there.

## Related API resources (runtime, not scheduling)

These support **during-live** moderation, not Studio scheduling defaults:

- `snippet.liveChatId` on `liveBroadcast` → `liveChatMessages.list` / `insert` / `delete`
- `liveChatModerators.insert` / `delete` — assign moderators
- `liveChatBans.insert` — ban participants
