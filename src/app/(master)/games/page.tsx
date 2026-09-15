import { ImageIcon, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { listGamesForMaster } from "@/lib/games/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LocalTimeRange } from "./local-time-range";
import { StatusBadge } from "./status-badge";

export const metadata = { title: "My games" };

export default async function GamesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const list = await listGamesForMaster(getDb(), user.id, new Date());
  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-bold">My games</h1>
        <Button asChild>
          <Link href="/games/new">
            <Plus aria-hidden /> New game
          </Link>
        </Button>
      </div>
      {list.length === 0 ? (
        <Card className="py-12 text-center">
          <CardHeader>
            <CardTitle className="font-display text-xl">No games yet</CardTitle>
          </CardHeader>
          <CardContent className="mx-auto max-w-sm text-muted-foreground">Upload a background, add a few objects, and let the model hide them.</CardContent>
          <CardFooter className="justify-center">
            <Button asChild>
              <Link href="/games/new">Make your first game</Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((g) => (
            <li key={g.id}>
              <Link href={`/games/${g.id}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
                <Card className="h-full gap-3 overflow-hidden pt-0 transition-shadow hover:shadow-md">
                  <div className="aspect-[4/3] w-full bg-muted">
                    {g.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center text-muted-foreground">
                        <ImageIcon className="size-8" aria-hidden />
                      </div>
                    )}
                  </div>
                  <CardHeader>
                    <CardTitle className="flex items-start justify-between gap-2">
                      <span className="line-clamp-2">{g.title}</span>
                      <StatusBadge status={g.status} />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    <LocalTimeRange startsAt={g.startsAt?.toISOString() ?? null} endsAt={g.endsAt?.toISOString() ?? null} />
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
