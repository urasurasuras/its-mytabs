// "deno task test" to run this test

import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.17";
import { playOrder, RepeatInfo, toAdvancedSync } from "./play_order.ts";
import { parseSongsterrSongID } from "./songsterr.ts";

const bar = (o: Partial<RepeatInfo> = {}): RepeatInfo => ({ isRepeatStart: false, repeatCount: 0, alternateEndings: 0, ...o });
const indexes = (bars: RepeatInfo[]) => playOrder(bars).map((b) => b.index);

Deno.test("playOrder - straight through without repeats", () => {
    assertEquals(indexes([bar(), bar(), bar()]), [0, 1, 2]);
});

Deno.test("playOrder - repeats a section and counts occurrences", () => {
    const order = playOrder([bar(), bar({ isRepeatStart: true }), bar({ repeatCount: 2 }), bar()]);
    assertEquals(order.map((b) => b.index), [0, 1, 2, 1, 2, 3]);
    assertEquals(order.map((b) => b.occurrence), [0, 0, 0, 1, 1, 0]);
});

Deno.test("playOrder - repeats from the start when no repeat start is marked", () => {
    assertEquals(indexes([bar(), bar({ repeatCount: 2 }), bar()]), [0, 1, 0, 1, 2]);
});

Deno.test("playOrder - repeat counts above two", () => {
    assertEquals(indexes([bar({ isRepeatStart: true, repeatCount: 3 })]), [0, 0, 0]);
});

Deno.test("playOrder - first and second endings", () => {
    const bars = [bar({ isRepeatStart: true }), bar({ alternateEndings: 0b01, repeatCount: 2 }), bar({ alternateEndings: 0b10 }), bar()];
    assertEquals(indexes(bars), [0, 1, 0, 2, 3]);
});

Deno.test("playOrder - two consecutive repeat sections", () => {
    const bars = [bar({ isRepeatStart: true, repeatCount: 2 }), bar({ isRepeatStart: true, repeatCount: 2 })];
    assertEquals(indexes(bars), [0, 0, 1, 1]);
});

Deno.test("toAdvancedSync - one line per played bar, in ms", () => {
    const bars = [bar(), bar({ isRepeatStart: true }), bar({ repeatCount: 2 })];
    assertEquals(
        toAdvancedSync(bars, [0.5, 2.25, 4, 5.7501, 7.5, 99]),
        "\\sync 0 0 500\n\\sync 1 0 2250\n\\sync 2 0 4000\n\\sync 1 1 5750\n\\sync 2 1 7500",
    );
});

Deno.test("parseSongsterrSongID", () => {
    assertEquals(parseSongsterrSongID("https://www.songsterr.com/a/wsa/caresizim-funda-tab-s1827554"), 1827554);
    assertEquals(parseSongsterrSongID("https://www.songsterr.com/a/wsa/caresizim-funda-bass-tab-s1827554t2"), 1827554);
    assertEquals(parseSongsterrSongID("s1827554"), 1827554);
    assertEquals(parseSongsterrSongID("1827554"), 1827554);
    assertThrows(() => parseSongsterrSongID("https://example.com/a/wsa/foo-tab-s1"));
    assertThrows(() => parseSongsterrSongID("https://www.songsterr.com/"));
    assertThrows(() => parseSongsterrSongID("not a link"));
});
