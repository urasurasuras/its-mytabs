import * as alphaTab from "@coderline/alphatab";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function noteName(midi: number): string {
    return NAMES[((midi % 12) + 12) % 12];
}

// Letter names are written into beat.lyrics, which alphaTab draws on the tab staff only.
// The beat's own lyrics are remembered here so turning names off restores them.
const originalLyrics = new WeakMap<alphaTab.model.Beat, string[] | null>();

/**
 * Show or hide letter note names (A, C#, …) under every beat of the track.
 * Tied and dead notes are skipped; chords list each pitch class once, low to high.
 */
export function setNoteNames(track: alphaTab.model.Track, on: boolean) {
    for (const staff of track.staves) {
        if (staff.isPercussion) {
            continue;
        }
        for (const bar of staff.bars) {
            for (const voice of bar.voices) {
                for (const beat of voice.beats) {
                    if (!originalLyrics.has(beat)) {
                        originalLyrics.set(beat, beat.lyrics);
                    }
                    const notes = beat.notes.filter((n) => !n.isTieDestination && !n.isDead);
                    if (on && notes.length > 0) {
                        const names = [...notes].sort((a, b) => a.realValue - b.realValue).map((n) => noteName(n.realValue));
                        beat.lyrics = [[...new Set(names)].join(" ")];
                    } else {
                        beat.lyrics = originalLyrics.get(beat) ?? null;
                    }
                }
            }
        }
    }
}
