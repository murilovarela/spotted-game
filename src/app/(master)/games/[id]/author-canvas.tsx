"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DEFAULT_RADIUS } from "@/components/canvas/geometry";
import { MarkerCanvas, type CanvasMarker } from "@/components/canvas/marker-canvas";
import { updateObjectAction } from "@/lib/games/actions";
import { normalized, type GameImage, type Normalized, type ObjectForMaster } from "@/lib/types";

/**
 * SPEC §3.1.6 / §5.4: the master adjusts proposals by dragging and confirms. Every gesture
 * ends in one `updateObjectAction` call, which resets `confirmed` (Phase 1 rule), so the
 * confirmed badge always reflects the geometry on screen.
 */
export function AuthorCanvas({ gameId, image, objects, editable }: { gameId: string; image: GameImage; objects: readonly ObjectForMaster[]; editable: boolean }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const placed: CanvasMarker[] = objects.flatMap((o) =>
    o.x === null || o.y === null || o.radius === null ? [] : [{ id: o.id, x: o.x, y: o.y, radius: o.radius, label: o.label, confirmed: o.confirmed }],
  );
  const selectedUnplaced = objects.find((o) => o.id === selectedId && o.x === null) ?? null;

  function save(objectId: string, input: { x: Normalized; y: Normalized; radius: Normalized }) {
    start(async () => {
      setError(null);
      const r = await updateObjectAction(gameId, objectId, input);
      if (!r.ok) setError(r.message);
      router.refresh();
    });
  }
  const byId = (id: string) => objects.find((o) => o.id === id);

  return (
    <div className="flex flex-col gap-3">
      <MarkerCanvas
        image={image}
        mode={editable ? "author" : "reveal"}
        markers={placed}
        selectedId={selectedId}
        canAdd={editable && selectedUnplaced !== null}
        onSelect={setSelectedId}
        onAdd={(p) => selectedUnplaced && save(selectedUnplaced.id, { x: p.x, y: p.y, radius: normalized(DEFAULT_RADIUS) })}
        onMove={(id, p) => {
          const o = byId(id);
          if (o?.radius != null) save(id, { x: p.x, y: p.y, radius: o.radius });
        }}
        onResize={(id, radius) => {
          const o = byId(id);
          if (o?.x != null && o.y != null) save(id, { x: o.x, y: o.y, radius });
        }}
      />
      {editable && (
        <div className="flex flex-wrap gap-2">
          {objects.map((o) => (
            <button
              key={o.id}
              type="button"
              data-testid="object-chip"
              aria-pressed={selectedId === o.id}
              onClick={() => setSelectedId(o.id)}
              className="rounded border px-2 py-1 text-sm aria-pressed:bg-black aria-pressed:text-white"
            >
              {o.label}
              {o.x === null ? " — select, then click the image to place" : o.confirmed ? " ✓" : " (unconfirmed)"}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-neutral-500">Drag a circle to move it, drag its handle to resize. Any change needs a fresh Confirm.</p>
      {pending && <p className="text-xs text-neutral-500">Saving…</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
