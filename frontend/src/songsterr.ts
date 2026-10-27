// deno-lint-ignore-file no-explicit-any
// Converts Songsterr's per-track note data into an AlphaTab score,
// for Songsterr revisions that have no Guitar Pro file.
// The data format is undocumented, this covers what is commonly used.
import * as alphaTab from "@coderline/alphatab";

const model = alphaTab.model;

const drumInstrumentID = 1024;
const durations = [1, 2, 4, 8, 16, 32, 64, 128];

const harmonicTypes: Record<string, alphaTab.model.HarmonicType> = {
    natural: model.HarmonicType.Natural,
    artificial: model.HarmonicType.Artificial,
    pinch: model.HarmonicType.Pinch,
    tap: model.HarmonicType.Tap,
    semi: model.HarmonicType.Semi,
    feedback: model.HarmonicType.Feedback,
};

const clefs: Record<string, alphaTab.model.Clef> = {
    G2: model.Clef.G2,
    F4: model.Clef.F4,
    C3: model.Clef.C3,
    C4: model.Clef.C4,
    neutral: model.Clef.Neutral,
};

/**
 * @param song Title and artist from Songsterr
 * @param tracks Songsterr track JSON, one per track
 */
export function songsterrToScore(song: { title: string; artist: string }, tracks: any[]): alphaTab.model.Score {
    const score = new model.Score();
    score.title = song.title;
    score.artist = song.artist;

    const first = tracks[0];
    const measureCount = Math.max(...tracks.map((t: any) => t.measures?.length ?? 0));
    if (!first || measureCount === 0) {
        throw new Error("Songsterr track data is empty");
    }

    // The score tempo is taken from the first bar's tempo automation
    const tempos = [...(first.automations?.tempo ?? [])];
    if (!tempos.some((t: any) => t.measure === 0)) {
        tempos.unshift({ measure: 0, bpm: tempos[0]?.bpm ?? 120 });
    }

    // Master bars (time signature, repeats, sections, tempo) come from the first track
    let numerator = 4;
    let denominator = 4;
    for (let i = 0; i < measureCount; i++) {
        const measure = first.measures[i] ?? {};
        const masterBar = new model.MasterBar();

        if (Array.isArray(measure.signature)) {
            [numerator, denominator] = measure.signature;
        }
        masterBar.timeSignatureNumerator = numerator;
        masterBar.timeSignatureDenominator = denominator;

        if (measure.repeatStart) {
            masterBar.isRepeatStart = true;
        }
        if (measure.repeat > 0) {
            masterBar.repeatCount = measure.repeat;
        }
        masterBar.alternateEndings = alternateEndingBits(measure.alternateEnding);

        if (measure.marker?.text) {
            const section = new model.Section();
            section.text = measure.marker.text;
            masterBar.section = section;
        }

        for (const tempo of tempos) {
            if (tempo.measure === i) {
                masterBar.tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0, tempo.bpm, 2));
            }
        }

        if (i === 0 && first.anacrusis) {
            masterBar.isAnacrusis = true;
        }

        score.addMasterBar(masterBar);
    }

    let channel = 0;
    for (const data of tracks) {
        const isDrums = data.instrumentId === drumInstrumentID;

        // Vocal / non-fretted tracks without tuning can't be shown as tab, skip them
        if (!isDrums && !Array.isArray(data.tuning)) {
            continue;
        }

        const track = new model.Track();
        track.name = data.name || data.instrument || "Track";
        track.shortName = data.instrument || "";
        score.addTrack(track);

        if (isDrums) {
            track.playbackInfo.primaryChannel = 9;
            track.playbackInfo.secondaryChannel = 9;
            track.playbackInfo.program = 0;
        } else {
            // Channel 9 is reserved for drums
            if (channel === 9) {
                channel++;
            }
            track.playbackInfo.primaryChannel = channel % 16;
            track.playbackInfo.secondaryChannel = channel % 16;
            track.playbackInfo.program = data.instrumentId >= 0 && data.instrumentId < 128 ? data.instrumentId : 25;
            channel++;
        }

        track.ensureStaveCount(1);
        const staff = track.staves[0];
        if (isDrums) {
            staff.isPercussion = true;
            staff.showTablature = false;
        } else {
            staff.stringTuning = new model.Tuning("", [...data.tuning], false);
        }

        addBars(staff, data, measureCount, isDrums);
    }

    if (score.tracks.length === 0) {
        throw new Error("This Songsterr tab has no tracks that can be imported");
    }

    score.finish(new alphaTab.Settings());
    return score;
}

/**
 * Export a score to Guitar Pro 7 (.gp) bytes
 */
export function scoreToGp(score: alphaTab.model.Score): Uint8Array {
    return new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings());
}

function alternateEndingBits(value: unknown): number {
    const list = Array.isArray(value) ? value : typeof value === "number" ? [value] : [];
    let bits = 0;
    for (const n of list) {
        if (n >= 1 && n <= 8) {
            bits |= 1 << (n - 1);
        }
    }
    return bits;
}

function addBars(staff: alphaTab.model.Staff, data: any, measureCount: number, isDrums: boolean) {
    const stringCount = isDrums ? 0 : data.tuning.length;
    let keySignature: alphaTab.model.KeySignature = model.KeySignature.C;
    let keySignatureType: alphaTab.model.KeySignatureType = model.KeySignatureType.Major;
    let clef: alphaTab.model.Clef = isDrums ? model.Clef.Neutral : model.Clef.G2;
    let dynamics: alphaTab.model.DynamicValue = model.DynamicValue.F;
    // Last fret per string, for tied notes without a fret
    const lastFret = new Map<number, number>();
    // AlphaTab expects the same voice count in every bar of a staff
    const voiceCount = Math.max(1, ...data.measures.map((m: any) => m.voices?.length ?? 0));

    for (let i = 0; i < measureCount; i++) {
        const measure = data.measures[i] ?? { voices: [{ beats: [{ type: 1, rest: true, notes: [] }] }] };

        const bar = new model.Bar();
        staff.addBar(bar);

        if (measure.keySignature) {
            const count = Math.min(7, Math.max(0, measure.keySignature.accidentalCount ?? 0));
            keySignature = (measure.keySignature.transposeAs === "b" ? -count : count) as alphaTab.model.KeySignature;
            keySignatureType = measure.keySignature.mode === "minor" ? model.KeySignatureType.Minor : model.KeySignatureType.Major;
        }
        bar.keySignature = keySignature;
        bar.keySignatureType = keySignatureType;

        if (measure.clef && clefs[measure.clef] !== undefined) {
            clef = clefs[measure.clef];
        }
        bar.clef = clef;

        for (let v = 0; v < voiceCount; v++) {
            const voice = new model.Voice();
            bar.addVoice(voice);

            const beatList = measure.voices?.[v]?.beats ?? [];
            if (beatList.length === 0) {
                // Unused voice: a single empty beat, like AlphaTab's own importers
                const empty = new model.Beat();
                empty.isEmpty = true;
                voice.addBeat(empty);
                continue;
            }

            for (const beatData of beatList) {
                if (beatData.velocity) {
                    const value = model.DynamicValue[String(beatData.velocity).toUpperCase() as keyof typeof model.DynamicValue];
                    if (value !== undefined) {
                        dynamics = value;
                    }
                }
                const beat = createBeat(beatData, dynamics);
                voice.addBeat(beat);

                if (beatData.rest) {
                    continue;
                }

                for (const noteData of beatData.notes ?? []) {
                    if (noteData.rest) {
                        continue;
                    }
                    const note = createNote(noteData, beatData, stringCount, isDrums, lastFret);
                    if (note) {
                        beat.addNote(note);
                    }
                }

                if (beatData.chord?.text) {
                    const id = beatData.chord.text;
                    if (!staff.hasChord(id)) {
                        const chord = new model.Chord();
                        chord.name = id;
                        chord.showDiagram = false;
                        staff.addChord(id, chord);
                    }
                    beat.chordId = id;
                }
            }
        }
    }
}

function createBeat(data: any, dynamics: alphaTab.model.DynamicValue): alphaTab.model.Beat {
    const beat = new model.Beat();

    beat.duration = durations.includes(data.type) ? data.type : model.Duration.Quarter;
    beat.dots = data.dots ?? 0;
    beat.dynamics = dynamics;

    if (data.tuplet > 1) {
        beat.tupletNumerator = data.tuplet;
        beat.tupletDenominator = tupletDenominator(data.tuplet);
    }

    if (data.graceNote === "beforeBeat") {
        beat.graceType = model.GraceType.BeforeBeat;
    } else if (data.graceNote) {
        beat.graceType = model.GraceType.OnBeat;
    }

    if (data.text?.text) {
        beat.text = data.text.text;
    }

    if (data.pickStroke === "up") {
        beat.pickStroke = model.PickStroke.Up;
    } else if (data.pickStroke === "down") {
        beat.pickStroke = model.PickStroke.Down;
    }

    if (data.brushStroke?.direction === "up") {
        beat.brushType = model.BrushType.BrushUp;
    } else if (data.brushStroke?.direction === "down") {
        beat.brushType = model.BrushType.BrushDown;
    }

    // [1, 32] = 32nd note tremolo picking
    if (Array.isArray(data.tremolo)) {
        const marks = Math.round(Math.log2(data.tremolo[1] || 8)) - 2;
        if (marks > 0) {
            const tremolo = new model.TremoloPickingEffect();
            tremolo.marks = Math.min(5, marks);
            beat.tremoloPicking = tremolo;
        }
    }

    if (Array.isArray(data.tremoloBar?.points)) {
        for (const p of data.tremoloBar.points) {
            beat.addWhammyBarPoint(new model.BendPoint(clamp(p.position, 0, 60), Math.round(p.tone / 25)));
        }
    }

    if (data.vibratoWithTremoloBar) {
        beat.vibrato = data.vibratoWithTremoloBar === "wide" ? model.VibratoType.Wide : model.VibratoType.Slight;
    }

    return beat;
}

function createNote(data: any, beatData: any, stringCount: number, isDrums: boolean, lastFret: Map<number, number>): alphaTab.model.Note | null {
    const note = new model.Note();

    if (isDrums) {
        if (typeof data.fret !== "number") {
            return null;
        }
        note.percussionArticulation = data.fret;
    } else {
        // Songsterr: string 0 = highest. AlphaTab: string 1 = lowest.
        if (typeof data.string !== "number" || data.string < 0 || data.string >= stringCount) {
            return null;
        }
        note.string = stringCount - data.string;

        let fret = data.fret;
        if (typeof fret !== "number") {
            fret = data.tie ? lastFret.get(data.string) ?? 0 : 0;
        }
        note.fret = fret;
        lastFret.set(data.string, fret);
    }

    note.isTieDestination = !!data.tie;
    note.isDead = !!data.dead;
    note.isGhost = !!data.ghost;
    note.isStaccato = !!data.staccato;
    note.isHammerPullOrigin = !!data.hp;
    note.isPalmMute = !!beatData.palmMute;
    note.isLetRing = !!beatData.letRing;

    if (data.accentuated === 2) {
        note.accentuated = model.AccentuationType.Heavy;
    } else if (data.accentuated) {
        note.accentuated = model.AccentuationType.Normal;
    }

    if (data.leftHandVibrato) {
        note.vibrato = data.leftHandVibrato === "wide" ? model.VibratoType.Wide : model.VibratoType.Slight;
    }

    if (data.harmonic) {
        note.harmonicType = harmonicTypes[data.harmonic] ?? model.HarmonicType.Natural;
        note.harmonicValue = data.harmonicFret ?? note.fret;
    }

    if (typeof data.slide === "string") {
        const slide = data.slide.toLowerCase();
        if (slide.includes("intofrombelow")) {
            note.slideInType = model.SlideInType.IntoFromBelow;
        } else if (slide.includes("intofromabove")) {
            note.slideInType = model.SlideInType.IntoFromAbove;
        } else if (slide === "shift") {
            note.slideOutType = model.SlideOutType.Shift;
        } else if (slide === "legato") {
            note.slideOutType = model.SlideOutType.Legato;
        } else if (slide.includes("up")) {
            note.slideOutType = model.SlideOutType.OutUp;
        } else if (slide.includes("down")) {
            note.slideOutType = model.SlideOutType.OutDown;
        }
    }

    // Songsterr bend tones: 100 = full step. AlphaTab: quarter tones.
    if (Array.isArray(data.bend?.points)) {
        for (const p of data.bend.points) {
            note.addBendPoint(new model.BendPoint(clamp(p.position, 0, 60), Math.round(p.tone / 25)));
        }
    }

    return note;
}

function tupletDenominator(n: number): number {
    if (n === 2) {
        return 3;
    }
    // Largest power of two below n: 3:2, 5:4, 6:4, 7:4, 9:8 ...
    return 2 ** Math.floor(Math.log2(n - 1));
}

function clamp(value: unknown, min: number, max: number): number {
    return Math.min(max, Math.max(min, Number(value) || 0));
}
