import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { addObjectAction, publishGameAction, setWindowAction, unpublishGameAction, updateGameAction } from "@/lib/games/actions";
import { loadGameForMasterById } from "@/lib/games/queries";
import { MAX_OBJECTS_PER_GAME } from "@/lib/types";
import { AddObjectForm } from "./add-object-form";
import { AuthorCanvas } from "./author-canvas";
import { masterErrorCopy } from "./error-copy";
import { ObjectRow } from "./object-row";
import { redirectBack } from "./redirect-back";
import { UploadField } from "./upload-field";
import { WindowFields } from "./window-fields";

export default async function EditGamePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error: errorCode }] = await Promise.all([params, searchParams]);
  const error = masterErrorCopy(errorCode);
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const game = await loadGameForMasterById(getDb(), id, user.id, new Date());
  if (!game) notFound();
  const editable = game.status === "draft";

  async function saveBackground(key: string) {
    "use server";
    redirectBack(id, await updateGameAction(id, { backgroundKey: key }));
  }
  async function addObject(formData: FormData) {
    "use server";
    redirectBack(
      id,
      await addObjectAction(id, {
        label: String(formData.get("label") ?? ""),
        prompt: String(formData.get("prompt") ?? ""),
        sourceImageKey: String(formData.get("sourceImageKey") ?? ""),
      }),
    );
  }
  async function saveWindow(formData: FormData) {
    "use server";
    redirectBack(
      id,
      await setWindowAction(id, {
        startsAt: new Date(String(formData.get("startsAt"))),
        endsAt: new Date(String(formData.get("endsAt"))),
      }),
    );
  }
  async function publish() {
    "use server";
    redirectBack(id, await publishGameAction(id));
  }
  async function unpublish() {
    "use server";
    redirectBack(id, await unpublishGameAction(id));
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{game.title}</h1>
        <span className="rounded bg-neutral-100 px-2 py-1 text-xs uppercase">{game.status}</span>
      </header>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-2 text-red-700">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 font-medium">Background</h2>
        {game.backgroundUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={game.backgroundUrl} alt="" className="max-h-64 rounded" />
        ) : (
          <p className="text-neutral-500">None yet.</p>
        )}
        {editable && <UploadField gameId={id} kind="background" label="Upload background" onUploaded={saveBackground} />}
      </section>

      {game.image && (
        <section>
          <h2 className="mb-2 font-medium">Positions</h2>
          <AuthorCanvas gameId={id} image={game.image} objects={game.objects} editable={editable} />
        </section>
      )}

      <section>
        <h2 className="mb-2 font-medium">
          Objects ({game.objects.length}/{MAX_OBJECTS_PER_GAME})
        </h2>
        <ul className="divide-y">
          {game.objects.map((o) => (
            <ObjectRow key={o.id} gameId={id} object={o} editable={editable} />
          ))}
        </ul>
        {editable && game.objects.length < MAX_OBJECTS_PER_GAME && <AddObjectForm gameId={id} action={addObject} />}
      </section>

      <section>
        <h2 className="mb-2 font-medium">Window</h2>
        <form action={saveWindow} className="flex flex-col gap-3">
          <WindowFields
            startsAt={game.startsAt?.toISOString() ?? null}
            endsAt={game.endsAt?.toISOString() ?? null}
            disabled={!editable}
          />
          {editable && <button className="self-start rounded border px-3 py-2">Save window</button>}
        </form>
      </section>

      <section className="flex gap-3">
        {editable ? (
          <form action={publish}>
            <button className="rounded bg-black px-3 py-2 text-white">Publish</button>
          </form>
        ) : game.status === "scheduled" ? (
          <form action={unpublish}>
            <button className="rounded border px-3 py-2">Unpublish</button>
          </form>
        ) : null}
        <a href={`/g/${game.publicId}`} className="self-center text-sm underline">
          /g/{game.publicId}
        </a>
      </section>
    </div>
  );
}
