import { redirect } from "next/navigation";
import { createGameAction } from "@/lib/games/actions";

export default async function NewGamePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  async function create(formData: FormData) {
    "use server";
    const r = await createGameAction({
      title: String(formData.get("title") ?? ""),
      generalPrompt: String(formData.get("generalPrompt") ?? ""),
    });
    if (!r.ok) redirect(`/games/new?error=${encodeURIComponent(r.message)}`);
    redirect(`/games/${r.data.id}`);
  }

  return (
    <form action={create} className="flex max-w-lg flex-col gap-4">
      <h1 className="text-2xl font-semibold">New game</h1>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-2 text-red-700">
          {error}
        </p>
      )}
      <label className="flex flex-col gap-1">
        Title
        <input name="title" required maxLength={120} className="rounded border p-2" />
      </label>
      <label className="flex flex-col gap-1">
        Style / difficulty prompt
        <textarea name="generalPrompt" maxLength={500} className="rounded border p-2" />
      </label>
      <button type="submit" className="self-start rounded bg-black px-3 py-2 text-white">
        Create
      </button>
    </form>
  );
}
