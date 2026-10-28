// Shared by the frontend (Songsterr import) and the tests.
// Unrolls repeats into the order bars are actually played.
// Not handled yet: D.S. / D.C. / coda jumps.

export interface RepeatInfo {
    isRepeatStart: boolean;
    // > 0 marks a repeat end
    repeatCount: number;
    // Bit n set = played on pass n
    alternateEndings: number;
}

export interface PlayedBar {
    // Master bar index
    index: number;
    // How many times this bar was played before (alphaTab's barOccurence)
    occurrence: number;
}

export function playOrder(bars: RepeatInfo[]): PlayedBar[] {
    const out: PlayedBar[] = [];
    const seen = new Map<number, number>();
    let repeatStart = 0;
    let pass = 0;
    let i = 0;

    // Hard limit, in case of a broken file
    while (i < bars.length && out.length < 10_000) {
        const bar = bars[i];

        if (bar.isRepeatStart && repeatStart !== i) {
            repeatStart = i;
            pass = 0;
        }

        // Alternate ending not played on this pass
        if (bar.alternateEndings && !(bar.alternateEndings & (1 << pass))) {
            i++;
            continue;
        }

        const occurrence = seen.get(i) ?? 0;
        seen.set(i, occurrence + 1);
        out.push({ index: i, occurrence });

        if (bar.repeatCount > 0) {
            if (pass < bar.repeatCount - 1) {
                pass++;
                i = repeatStart;
                continue;
            }
            pass = 0;
            repeatStart = i + 1;
        }
        i++;
    }

    return out;
}

/**
 * Convert per-played-bar timestamps (seconds) into alphaTex sync lines for "Advanced Sync".
 * Extra points beyond the played bars are ignored.
 */
export function toAdvancedSync(bars: RepeatInfo[], points: number[]): string {
    const order = playOrder(bars);
    const lines: string[] = [];

    order.forEach((bar, k) => {
        if (k >= points.length) {
            return;
        }
        lines.push(`\\sync ${bar.index} ${bar.occurrence} ${Math.round(points[k] * 1000)}`);
    });

    return lines.join("\n");
}

export interface SyncedVideo {
    points: number[];
    feature: string | null;
}

/**
 * Pick the video whose timestamps fit the score: one point per played bar.
 * Songsterr keeps videos synced to older revisions, whose bar count can differ; using one of
 * those drifts by the missing bars. Among fitting videos the main one (feature null) wins.
 * If none fits, returns the closest one with exact = false, so the caller can warn.
 */
export function pickVideo<T extends SyncedVideo>(videos: T[], playedBars: number): { video: T; exact: boolean } | null {
    if (videos.length === 0) {
        return null;
    }
    // A trailing end-of-song point is fine, toAdvancedSync ignores it
    const fits = (v: T) => v.points.length === playedBars || v.points.length === playedBars + 1;
    const mainFirst = (a: T, b: T) => Number(a.feature !== null) - Number(b.feature !== null);

    const fitting = videos.filter(fits).sort(mainFirst);
    if (fitting.length > 0) {
        return { video: fitting[0], exact: true };
    }

    const distance = (v: T) => Math.abs(v.points.length - playedBars);
    const closest = [...videos].sort((a, b) => distance(a) - distance(b) || mainFirst(a, b));
    return { video: closest[0], exact: false };
}
