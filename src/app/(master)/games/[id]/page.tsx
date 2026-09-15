import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { addObjectAction, publishGameAction, setWindowAction, unpublishGameAction, updateGameAction } from "@/lib/games/actions";
import { loadGameForMasterById } from "@/lib/games/queries";
import { deriveGenerationState } from "@/lib/generation/status";
import { MAX_OBJECTS_PER_GAME } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SubmitButton } from "@/components/shell/submit-button";
import { AddObjectForm } from "./add-object-form";
import { AuthorCanvas } from "./author-canvas";
import { CopyLink } from "./copy-link";
import { masterErrorCopy } from "./error-copy";
import { GenerationPanel } from "./generation-panel";
import { ObjectRow } from "./object-row";
import { redirectBack } from "./redirect-back";
import { PublishBar } from "./publish-bar";
import { deriveSteps, publishBlockers, type StepKey } from "./steps";
import { StepCard } from "./step-card";
import { UploadField } from "./upload-field";
import { WindowFields } from "./window-fields";

// Server actions from this page — the generation loop runs in `after()` — may take up to 5 minutes.
export const maxDuration = 300;

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
  const generation = deriveGenerationState(game.generationRuns, new Date());
  const steps = deriveSteps(game);
  const blockers = publishBlockers(game);
  const step = (key: StepKey) => steps.find((s) => s.key === key) ?? steps[0];

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
    <div className="flex flex-col gap-6 pb-44 sm:pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">{game.title}</h1>
          {game.generalPrompt && <p className="text-sm text-muted-foreground">{game.generalPrompt}</p>}
        </div>
        {game.status !== "draft" && (
          <div className="flex items-center gap-2">
            <a href={`/g/${game.publicId}`} className="text-sm underline underline-offset-4">
              /g/{game.publicId}
            </a>
            <CopyLink path={`/g/${game.publicId}`} />
          </div>
        )}
      </header>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <StepCard n={1} step={step("background")} locked={!editable}>
        {game.backgroundUrl ? (
          <div className="h-64">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={game.backgroundUrl} alt="" className="h-full w-auto rounded-lg object-contain" />
          </div>
        ) : null}
        {editable && <UploadField gameId={id} kind="background" label={game.backgroundUrl ? "Replace background" : "Upload background"} onUploaded={saveBackground} />}
      </StepCard>

      <StepCard n={2} step={step("objects")} locked={!editable}>
        <ul className="divide-y">
          {game.objects.map((o) => (
            <ObjectRow key={o.id} gameId={id} object={o} editable={editable} />
          ))}
        </ul>
        {/* Keyed on the count so the form remounts — and drops the previous upload key — after each add. */}
        {editable && game.objects.length < MAX_OBJECTS_PER_GAME && <AddObjectForm key={game.objects.length} gameId={id} action={addObject} />}
      </StepCard>

      {editable && (
        <StepCard n={3} step={step("generate")} locked={false}>
          <GenerationPanel gameId={id} state={generation} runs={game.generationRuns} canGenerate={game.backgroundUrl !== null && game.objects.length > 0} />
        </StepCard>
      )}

      {game.image && (
        <StepCard n={4} step={step("positions")} locked={!editable}>
          <AuthorCanvas gameId={id} image={game.image} objects={game.objects} editable={editable} />
        </StepCard>
      )}

      <StepCard n={5} step={step("window")} locked={!editable}>
        <form action={saveWindow} className="flex flex-col gap-4">
          <WindowFields startsAt={game.startsAt?.toISOString() ?? null} endsAt={game.endsAt?.toISOString() ?? null} disabled={!editable} />
          {editable && (
            <SubmitButton variant="secondary" className="self-start" pendingLabel="Saving…">
              Save window
            </SubmitButton>
          )}
        </form>
      </StepCard>

      <PublishBar status={game.status} blockers={blockers} publish={publish} unpublish={unpublish} />
    </div>
  );
}
