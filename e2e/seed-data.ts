import { readFileSync } from "node:fs";

type Ref = { id: string; publicId: string };
export type SeedData = {
  masterId: string;
  mine: Record<"draft" | "scheduled" | "active" | "finished", Ref>;
  theirs: Record<"scheduled" | "active" | "finished", Ref>;
  user: { id: string; email: string };
};

/** Written by global-setup; one seed per run so every spec plays fresh games. */
export function seed(): SeedData {
  return JSON.parse(readFileSync("e2e/.auth/seed.json", "utf8")) as SeedData;
}
