"use client";
import { useRouter } from "next/navigation";
import { useReducer, useRef, useState, useTransition } from "react";
import { MarkerCanvas } from "@/components/canvas/marker-canvas";
import { canSubmit, EMPTY_MARKERS, markerReducer, type MarkerAction, type MarkerState } from "@/components/canvas/marker-state";
import { ObjectRail } from "@/components/canvas/object-rail";
import { Timer } from "@/components/canvas/timer";
import { TrashZone } from "@/components/canvas/trash-zone";
import { submitAttemptAction } from "@/lib/games/actions";
import type { GameImage, ObjectThumbnail } from "@/lib/types";

export function PlayScreen({
  publicId,
  title,
  image,
  objects,
  startedAtMs,
  serverNowMs,
}: {
  publicId: string;
  title: string;
  image: GameImage;
  objects: readonly ObjectThumbnail[];
  startedAtMs: number;
  serverNowMs: number;
}) {
  const total = objects.length;
  const router = useRouter();
  const trashRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);
  const [state, dispatch] = useReducer((s: MarkerState, a: MarkerAction) => markerReducer(s, a, total), EMPTY_MARKERS);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = canSubmit(state, total);

  function submit() {
    start(async () => {
      setError(null);
      const r = await submitAttemptAction(publicId, state.markers.map(({ x, y }) => ({ x, y })));
      if (r.ok || r.error === "ALREADY_SUBMITTED" || r.error === "NOT_ACTIVE") {
        router.refresh(); // the server decides what this player sees next
        return;
      }
      setConfirming(false);
      setError(r.message);
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        <Timer startedAtMs={startedAtMs} serverNowMs={serverNowMs} />
      </header>
      <div className="grid gap-4 md:grid-cols-[1fr_8rem]">
        <MarkerCanvas
          image={image}
          mode="play"
          markers={state.markers}
          selectedId={state.selected}
          canAdd={state.markers.length < total}
          trashRef={trashRef}
          onAdd={(point) => dispatch({ type: "add", id: `m${nextId.current++}`, point })}
          onMove={(id, point) => dispatch({ type: "move", id, point })}
          onRemove={(id) => dispatch({ type: "remove", id })}
          onSelect={(id) => dispatch({ type: "select", id })}
        />
        <aside className="flex flex-col gap-3">
          <ObjectRail objects={objects} />
        </aside>
      </div>
      <TrashZone ref={trashRef} active={state.selected !== null} />
      <footer className="flex items-center justify-between">
        <span data-testid="marker-count" className="text-sm text-neutral-600">
          {state.markers.length} / {total} markers
        </span>
        <button data-testid="submit" disabled={!ready || pending} onClick={() => setConfirming(true)} className="rounded bg-black px-4 py-2 text-white disabled:opacity-40">
          Submit
        </button>
      </footer>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-2 text-red-700">
          {error}
        </p>
      )}
      {confirming && (
        <div role="dialog" aria-modal="true" data-testid="confirm-submit" className="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-w-sm flex-col gap-4 rounded bg-white p-6 text-black">
            <p className="font-medium">Submit your {total} markers?</p>
            <p className="text-sm">You get one submission for this game. After this you cannot play again.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} disabled={pending} className="rounded border px-3 py-2">
                Keep looking
              </button>
              <button data-testid="confirm-submit-yes" onClick={submit} disabled={pending} className="rounded bg-black px-3 py-2 text-white">
                {pending ? "Submitting…" : "Submit — I understand"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
