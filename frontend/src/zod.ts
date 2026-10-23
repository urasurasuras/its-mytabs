import * as z from "zod";
import { ScrollMode } from "@coderline/alphatab";

export const SettingSchema = z.object({
    scoreStyle: z.enum(["tab", "score-tab", "score", "auto", "horizontal-tab"]).default("tab"),
    scoreColor: z.enum(["light", "dark"]).default("dark"),
    noteColor: z.enum(["rocksmith", "louis-bass-v", "none"]).default("rocksmith"),
    // Letter note names (A, C#, …) under each beat; drawn on the tab staff
    noteNames: z.boolean().default(false),
    cursor: z.enum(["animated", "instant", "bar", "invisible"]).default(
        "animated",
    ),
    scrollMode: z.enum(ScrollMode).default(ScrollMode.Continuous),
    groupByArtist: z.boolean().default(false),
    showKeySignature: z.boolean().default(false),
    showSyncOffset: z.boolean().default(true),
    scale: z.number().min(0.1).default(1),
    toolbarAutoHide: z.boolean().default(false),
    preferredInstrument: z.enum(["none", "bass", "guitar"]).default("none"),
});
export type Setting = z.infer<typeof SettingSchema>;
