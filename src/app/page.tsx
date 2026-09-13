import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">Spotted</h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        Compose a hidden-object puzzle from a background and a handful of objects, then race your players against the
        clock.
      </p>
      <Link href="/games" className="rounded bg-black px-4 py-2 text-white dark:bg-white dark:text-black">
        Go to my games
      </Link>
    </div>
  );
}
