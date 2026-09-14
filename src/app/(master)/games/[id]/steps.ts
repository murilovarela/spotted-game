import { MAX_OBJECTS_PER_GAME, type MasterGameView } from "@/lib/types";

export type StepKey = "background" | "objects" | "generate" | "positions" | "window";
export type Step = { readonly key: StepKey; readonly title: string; readonly done: boolean; readonly hint: string };

/**
 * What the master has done and what is left, derived from the row on every render — no
 * stored state (mirrors invariant 3's "derive on read"). The publish transaction still
 * decides (invariant 4); this only explains its answer ahead of time.
 */
export function deriveSteps(game: MasterGameView): readonly Step[] {
  const unplaced = game.objects.filter((o) => o.x === null).length;
  const unconfirmed = game.objects.filter((o) => !o.confirmed).length;
  return [
    { key: "background", title: "Background", done: game.backgroundUrl !== null, hint: "The scene the objects hide in." },
    {
      key: "objects",
      title: "Objects",
      done: game.objects.length > 0,
      hint: `${game.objects.length} of ${MAX_OBJECTS_PER_GAME}. Each one needs a picture and a name.`,
    },
    { key: "generate", title: "Generate", done: game.image !== null, hint: "The model hides the objects in the scene and reports where." },
    {
      key: "positions",
      title: "Confirm positions",
      done: game.objects.length > 0 && unplaced === 0 && unconfirmed === 0,
      hint: unplaced > 0 ? `${unplaced} not placed yet.` : unconfirmed > 0 ? `${unconfirmed} to confirm.` : "Every circle checked.",
    },
    { key: "window", title: "Play window", done: game.startsAt !== null && game.endsAt !== null, hint: "When players may start. Shown in your local time." },
  ];
}

/** Why Publish is disabled, in the order the master should fix things. Empty means publishable. */
export function publishBlockers(game: MasterGameView): readonly string[] {
  const out: string[] = [];
  if (game.backgroundUrl === null) out.push("Upload a background");
  if (game.objects.length === 0) out.push("Add at least one object");
  if (game.image === null) out.push("Generate the image");
  const unconfirmed = game.objects.filter((o) => !o.confirmed).length;
  if (game.objects.length > 0 && unconfirmed > 0) out.push(`Confirm ${unconfirmed} object${unconfirmed === 1 ? "" : "s"}`);
  if (game.startsAt === null || game.endsAt === null) out.push("Set the play window");
  return out;
}
