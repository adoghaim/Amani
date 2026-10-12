#!/usr/bin/env node
// YouTube: public channel statistics + recent uploads via an API key (read-only).
// Docs: https://developers.google.com/youtube/v3/getting-started
import { missing, skip, run, fetchJson, settle } from "./lib.mjs";

const SRC = "youtube";
const need = missing("YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID");
if (need.length) skip(SRC, need, "YouTube not configured yet (channel still to be created).");
const key = process.env.YOUTUBE_API_KEY, ch = process.env.YOUTUBE_CHANNEL_ID;
const yt = (p) => fetchJson(`https://www.googleapis.com/youtube/v3/${p}&key=${encodeURIComponent(key)}`);

await run(SRC, () => settle({
  channel: () => yt(`channels?part=snippet,statistics&id=${encodeURIComponent(ch)}`).then((r) => r.items?.[0] && ({ title: r.items[0].snippet.title, ...r.items[0].statistics })),
  recent_videos: async () => {
    const s = await yt(`search?part=snippet&channelId=${encodeURIComponent(ch)}&order=date&type=video&maxResults=10`);
    const ids = (s.items || []).map((i) => i.id.videoId).join(",");
    if (!ids) return [];
    const v = await yt(`videos?part=snippet,statistics&id=${ids}`);
    return (v.items || []).map((x) => ({ id: x.id, title: x.snippet.title, publishedAt: x.snippet.publishedAt, ...x.statistics }));
  },
}));
