// Songsterr import helpers.
// These Songsterr endpoints are unofficial and undocumented, so they may change without notice.

const site = "https://www.songsterr.com";
const gpHost = "gp.songsterr.com";

export interface SongsterrVideo {
    videoID: string;
    // Seconds, one per played bar start (repeats unrolled)
    points: number[];
}

export interface SongsterrSong {
    songID: number;
    revisionID: number;
    title: string;
    artist: string;
    hasGp: boolean;
    video: SongsterrVideo | null;
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

async function getVideo(songID: number, revisionID: number): Promise<SongsterrVideo | null> {
    try {
        const res = await songsterrFetch(`${site}/api/video-points/${songID}/${revisionID}/list`);
        const list = await res.json();
        if (!Array.isArray(list)) {
            return null;
        }
        // deno-lint-ignore no-explicit-any
        const video = list.find((v: any) => v.status === "done" && typeof v.videoId === "string" && Array.isArray(v.points) && v.points.length > 0);
        if (!video) {
            return null;
        }
        return {
            videoID: video.videoId,
            points: video.points.map(Number),
        };
    } catch (e) {
        // Video sync is optional, the tab can still be imported without it
        console.warn("Songsterr video points unavailable:", e);
        return null;
    }
}

export async function getSongsterrSong(songID: number): Promise<SongsterrSong> {
    const res = await songsterrFetch(`${site}/api/meta/${songID}`);
    const meta = await res.json();

    const revisionID = Number(meta?.revisionId);
    if (!revisionID) {
        throw new Error("Songsterr song has no revision");
    }

    const [revision, video] = await Promise.all([
        getRevision(revisionID),
        getVideo(songID, revisionID),
    ]);

    return {
        songID,
        revisionID,
        title: meta.title || "Unknown",
        artist: meta.artist || "",
        hasGp: typeof revision?.source === "string" && revision.source.length > 0,
        video,
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
