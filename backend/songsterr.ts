// Songsterr import helpers.
// These Songsterr endpoints are unofficial and undocumented, so they may change without notice.

const site = "https://www.songsterr.com";
const gpHost = "gp.songsterr.com";
// Per-track note data (gzipped JSON), used when a revision has no Guitar Pro file
const trackHost = "https://dqsljvtekg760.cloudfront.net";

export interface SongsterrVideo {
    videoID: string;
    // Seconds, one per played bar start (repeats unrolled)
    points: number[];
    // null = the song's main video; otherwise "alternative" (cover), "backing", "solo", ...
    feature: string | null;
}

export interface SongsterrSong {
    songID: number;
    revisionID: number;
    title: string;
    artist: string;
    hasGp: boolean;
    // Every synced video Songsterr has, in its order. Pick one with pickVideo().
    videos: SongsterrVideo[];
}

/**
 * Get the song ID from a Songsterr link, e.g. https://www.songsterr.com/a/wsa/caresizim-funda-tab-s1827554
 * Plain IDs ("1827554" or "s1827554") are accepted too.
 */
export function parseSongsterrSongID(input: string): number {
    input = input.trim();

    const plain = input.match(/^s?(\d+)$/);
    if (plain) {
        return Number(plain[1]);
    }

    let url: URL;
    try {
        url = new URL(input);
    } catch {
        throw new Error("Not a valid Songsterr link");
    }

    if (!/(^|\.)songsterr\.com$/.test(url.hostname)) {
        throw new Error("Not a songsterr.com link");
    }

    // Song links end with "-s<songID>", optionally followed by "t<trackIndex>"
    const m = url.pathname.match(/-s(\d+)(?:t\d+)?\/?$/);
    if (!m) {
        throw new Error("No song ID found in the Songsterr link");
    }
    return Number(m[1]);
}

async function songsterrFetch(url: string): Promise<Response> {
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; ItsMyTabs)",
        },
    });
    if (!res.ok) {
        // Drain the body to avoid resource leaks in Deno
        await res.body?.cancel();
        throw new Error(`Songsterr returned ${res.status}`);
    }
    return res;
}

async function getRevision(revisionID: number) {
    const res = await songsterrFetch(`${site}/api/revision/${revisionID}`);
    return await res.json();
}

async function getVideos(songID: number, revisionID: number): Promise<SongsterrVideo[]> {
    try {
        const res = await songsterrFetch(`${site}/api/video-points/${songID}/${revisionID}/list`);
        const list = await res.json();
        if (!Array.isArray(list)) {
            return [];
        }
        const videos: SongsterrVideo[] = [];
        for (const v of list) {
            if (v?.status !== "done" || typeof v.videoId !== "string" || !Array.isArray(v.points) || v.points.length === 0) {
                continue;
            }
            // The list often has the same video twice
            if (videos.some((x) => x.videoID === v.videoId)) {
                continue;
            }
            videos.push({
                videoID: v.videoId,
                points: v.points.map(Number),
                feature: typeof v.feature === "string" ? v.feature : null,
            });
        }
        return videos;
    } catch (e) {
        // Video sync is optional, the tab can still be imported without it
        console.warn("Songsterr video points unavailable:", e);
        return [];
    }
}

export async function getSongsterrSong(songID: number): Promise<SongsterrSong> {
    const res = await songsterrFetch(`${site}/api/meta/${songID}`);
    const meta = await res.json();

    const revisionID = Number(meta?.revisionId);
    if (!revisionID) {
        throw new Error("Songsterr song has no revision");
    }

    const [revision, videos] = await Promise.all([
        getRevision(revisionID),
        getVideos(songID, revisionID),
    ]);

    return {
        songID,
        revisionID,
        title: meta.title || "Unknown",
        artist: meta.artist || "",
        hasGp: typeof revision?.source === "string" && revision.source.length > 0,
        videos,
    };
}

/**
 * Download the Guitar Pro file of a revision.
 * Only the revision's own "source" is fetched, and only from Songsterr's GP host.
 */
export async function getSongsterrGp(revisionID: number): Promise<Uint8Array<ArrayBuffer>> {
    const revision = await getRevision(revisionID);
    if (typeof revision?.source !== "string" || !revision.source) {
        throw new Error("This Songsterr revision has no Guitar Pro file");
    }

    const url = new URL(revision.source);
    if (url.protocol !== "https:" || url.hostname !== gpHost) {
        throw new Error("Unexpected Guitar Pro file host: " + url.hostname);
    }

    const res = await songsterrFetch(url.toString());
    return new Uint8Array(await res.arrayBuffer());
}

/**
 * Get the note data of every track of a revision, for revisions without a Guitar Pro file.
 * The frontend converts it into a score (see frontend/src/songsterr.ts).
 */
export async function getSongsterrTracks(revisionID: number): Promise<unknown[]> {
    const revision = await getRevision(revisionID);
    const songID = Number(revision?.songId);
    const image = revision?.image;
    const trackCount = Array.isArray(revision?.tracks) ? revision.tracks.length : 0;

    if (!songID || typeof image !== "string" || !/^[\w-]+$/.test(image) || trackCount === 0) {
        throw new Error("This Songsterr revision has no track data");
    }

    const tracks = [];
    for (let i = 0; i < trackCount; i++) {
        const res = await songsterrFetch(`${trackHost}/${songID}/${revisionID}/${image}/${i}.json`);
        tracks.push(await readMaybeGzippedJSON(res));
    }
    return tracks;
}

// The track files are stored gzipped, but not always served with a Content-Encoding header
async function readMaybeGzippedJSON(res: Response) {
    let bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
}
