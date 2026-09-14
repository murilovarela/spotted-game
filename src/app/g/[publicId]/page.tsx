import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { getLeaderboardAction, getPlayerStateAction } from "@/lib/games/actions";
import { loadGameForViewer } from "@/lib/games/queries";
import { FinishedScreen } from "./finished-screen";
import { PlayScreen } from "./play-screen";
import { ResultScreen } from "./result-screen";
import { StartScreen } from "./start-screen";

export const dynamic = "force-dynamic";

/**
 * SPEC §3.3. `loadGameForViewer` already returns null for anything a player may not see
 * (draft/scheduled → 404) and a master view for the owner. Which screen a player gets is
 * decided here from server state only; the client never tells us where it is.
 */
export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ publicId }, { error }] = await Promise.all([params, searchParams]);
  const user = await getCurrentUser();
  const now = new Date();
  const view = await loadGameForViewer(getDb(), publicId, user?.id ?? null, now);
  if (!view) notFound();
  if (view.viewer === "master") redirect(`/games/${view.id}`); // masters review, they do not play (SPEC §11)

  if (view.status === "finished") {
    const lb = await getLeaderboardAction(publicId);
    return <FinishedScreen view={view} leaderboard={lb.ok ? lb.data : []} />;
  }

  const state = user ? await getPlayerStateAction(publicId) : null;
  const attempt = state?.ok ? state.data : { kind: "not_started" as const };
  const common = { publicId, title: view.title, objects: view.objects };

  switch (attempt.kind) {
    case "not_started":
      return <StartScreen {...common} signedIn={user !== null} error={error} />;
    case "in_progress":
      return <PlayScreen {...common} image={view.image} startedAtMs={attempt.startedAt.getTime()} serverNowMs={now.getTime()} />;
    case "submitted": {
      const lb = await getLeaderboardAction(publicId);
      return <ResultScreen title={view.title} image={view.image} total={view.objects.length} result={attempt.result} leaderboard={lb.ok ? lb.data : []} />;
    }
  }
}
