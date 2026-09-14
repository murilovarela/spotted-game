"use client";
import { useRouter } from "next/navigation";
import { useReducer, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarkerCanvas } from "@/components/canvas/marker-canvas";
import { canSubmit, EMPTY_MARKERS, markerReducer, type MarkerAction, type MarkerState } from "@/components/canvas/marker-state";
import { ObjectRail } from "@/components/canvas/object-rail";
import { Timer } from "@/components/canvas/timer";
import { TrashZone } from "@/components/canvas/trash-zone";
import { submitAttemptAction } from "@/lib/games/actions";
import type { GameImage, ObjectThumbnail } from "@/lib/types";
import { PlayerBar } from "./player-bar";

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
    <div className="flex min-h-dvh flex-col">
      <PlayerBar>
        <span className="text-sm text-muted-foreground">{title}</span>
        <Badge data-testid="marker-count" variant="secondary" className="tabular-nums">
          {state.markers.length} / {total} markers
        </Badge>
        <Timer startedAtMs={startedAtMs} serverNowMs={serverNowMs} />
      </PlayerBar>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 pb-20 lg:grid lg:grid-cols-[1fr_9rem] lg:gap-4 lg:px-4 lg:py-4">
        {/* Letterboxed at lg: sized from the image's own ratio so the whole image — and every
            marker on it — stays visible and clickable within the height budget, instead of
            being cropped by a fixed-height, full-width box (a portrait or squarish background,
            like the seeded 4:3 fixture, would otherwise have its bottom cut off and unclickable). */}
        <div
          className="lg:mx-auto lg:w-auto lg:max-w-full lg:max-h-[calc(100dvh-10rem)] lg:justify-self-center lg:overflow-hidden lg:rounded-xl"
          style={{ aspectRatio: `${image.width} / ${image.height}` }}
        >
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
        </div>
        <aside className="lg:flex lg:flex-col lg:gap-3">
          <ObjectRail objects={objects} variant="strip" />
        </aside>
      </main>
      {error && (
        <div className="px-4">
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}
      <footer className="sticky bottom-0 z-30 border-t bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3">
          <TrashZone ref={trashRef} active={state.selected !== null} className="h-12 flex-1" />
          <Button data-testid="submit" size="lg" disabled={!ready || pending} onClick={() => setConfirming(true)}>
            Submit
          </Button>
        </div>
      </footer>
      <Dialog open={confirming} onOpenChange={(v) => !pending && setConfirming(v)}>
        <DialogContent data-testid="confirm-submit">
          <DialogHeader>
            <DialogTitle>Submit your {total} markers?</DialogTitle>
            <DialogDescription>You get one submission for this game. After this you cannot play again.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              Keep looking
            </Button>
            <Button data-testid="confirm-submit-yes" onClick={submit} disabled={pending}>
              {pending ? "Submitting…" : "Submit — I understand"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
