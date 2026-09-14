import Link from "next/link";
import { redirect } from "next/navigation";
import { ObjectRail } from "@/components/canvas/object-rail";
import { startAttemptAction } from "@/lib/games/actions";
import type { ObjectThumbnail } from "@/lib/types";

/**
 * Rendered before Start. By construction this tree never receives `image` — the prop type
 * has no such field — so the generated image cannot reach the HTML until the server has
 * written `started_at` (handoff "image before Start"). Task 7 asserts it on the wire.
 */
export function StartScreen({
  publicId,
  title,
  objects,
  signedIn,
  error,
}: {
  publicId: string;
  title: string;
  objects: readonly ObjectThumbnail[];
  signedIn: boolean;
  /** Already resolved to fixed copy by the page; never raw query text. */
  error: string | null;
}) {
  async function start() {
    "use server";
    const r = await startAttemptAction(publicId);
    // Carry the code, not the message: the page maps it to fixed copy (error-copy.ts).
    redirect(`/g/${publicId}${r.ok ? "" : `?error=${r.error}`}`);
  }
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-2 text-red-700">
          {error}
        </p>
      )}
      <section>
        <h2 className="mb-2 font-medium">Find these {objects.length} objects</h2>
        <ObjectRail objects={objects} />
      </section>
      <section className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
        <p className="font-medium">Before you start</p>
        <ul className="mt-1 list-disc pl-5">
          <li>The timer starts the moment you press Start and does not pause — not if you close the tab, not if you walk away.</li>
          <li>You get one submission. An unsubmitted attempt never reaches the leaderboard.</li>
        </ul>
      </section>
      {signedIn ? (
        <form action={start}>
          <button className="rounded bg-black px-5 py-3 text-lg text-white">Start</button>
        </form>
      ) : (
        <Link href={`/sign-in?redirect_url=${encodeURIComponent(`/g/${publicId}`)}`} className="w-fit rounded bg-black px-5 py-3 text-lg text-white">
          Sign in to start
        </Link>
      )}
    </main>
  );
}
