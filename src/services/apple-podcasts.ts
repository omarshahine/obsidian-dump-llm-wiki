import { requestUrl } from "obsidian";

export interface PodcastEpisode {
  title: string;
  podcastName: string;
  audioUrl: string;
  releaseDate: string;
  duration: number;
  description: string;
}

/**
 * Resolves an Apple Podcasts URL to episode metadata and audio URL.
 * URL format: https://podcasts.apple.com/.../id<collectionId>?i=<trackId>
 */
export async function resolveApplePodcastsURL(
  url: string
): Promise<PodcastEpisode> {
  const collectionMatch = url.match(/id(\d+)/);
  const trackMatch = url.match(/i=(\d+)/);

  if (!collectionMatch) {
    throw new Error("Could not extract podcast ID from URL");
  }

  const collectionId = collectionMatch[1];
  const trackId = trackMatch ? parseInt(trackMatch[1], 10) : null;

  const apiUrl = `https://itunes.apple.com/lookup?id=${collectionId}&media=podcast&entity=podcastEpisode&limit=200`;
  const response = await requestUrl({ url: apiUrl, method: "GET" });
  const data = response.json;

  const results = data.results || [];

  if (trackId) {
    const episode = results.find(
      (r: { trackId?: number; episodeUrl?: string }) =>
        r.trackId === trackId && r.episodeUrl
    );
    if (!episode) {
      throw new Error(`Episode ${trackId} not found in podcast feed`);
    }
    return toEpisode(episode);
  }

  // No specific episode, return most recent
  const episode = results.find(
    (r: { kind?: string; episodeUrl?: string }) =>
      r.kind === "podcast-episode" && r.episodeUrl
  );
  if (!episode) {
    throw new Error("No episodes with audio URL found");
  }
  return toEpisode(episode);
}

/**
 * Detect if a URL is a podcast that needs special handling.
 */
export function isPodcastURL(url: string): boolean {
  const podcastHosts = [
    "podcasts.apple.com",
    "open.spotify.com/episode",
    "overcast.fm",
    "pocketcasts.com",
  ];
  return podcastHosts.some((host) => url.includes(host));
}

function toEpisode(data: Record<string, unknown>): PodcastEpisode {
  return {
    title: (data.trackName as string) || "Unknown Episode",
    podcastName: (data.collectionName as string) || "Unknown Podcast",
    audioUrl: data.episodeUrl as string,
    releaseDate: ((data.releaseDate as string) || "").split("T")[0],
    duration: Math.round(((data.trackTimeMillis as number) || 0) / 1000),
    description: (data.description as string) || "",
  };
}
