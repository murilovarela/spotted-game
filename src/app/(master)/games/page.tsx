import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { listGamesForMaster } from "@/lib/games/queries";

export default async function GamesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const list = await listGamesForMaster(getDb(), user.id, new Date());
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My games</h1>
        <Link href="/games/new" className="rounded bg-black px-3 py-2 text-white">
          New game
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="text-neutral-500">No games yet.</p>
      ) : (
        <ul className="divide-y">
          {list.map((g) => (
            <li key={g.id} className="flex items-center justify-between py-3">
              <Link href={`/games/${g.id}`}>{g.title}</Link>
              <span className="rounded bg-neutral-100 px-2 py-1 text-xs uppercase">{g.status}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
