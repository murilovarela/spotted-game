"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DEFAULT_RADIUS } from "@/components/canvas/geometry";
import { MarkerCanvas, type CanvasMarker } from "@/components/canvas/marker-canvas";
import { updateObjectAction } from "@/lib/games/actions";
import { normalized, type GameImage, type Normalized, type ObjectForMaster } from "@/lib/types";

type Position = { readonly x: Normalized; readonly y: Normalized; readonly radius: Normalized };

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

  // Latest position this component has sent per object. A second gesture that lands before
  // router.refresh() re-renders must build on what we just saved, not on the stale prop. This
  // is state, not a ref: the repo's lint config (react-hooks/refs) forbids reading a ref during
  // render, and the reconciliation below has to run during render to avoid a stale-forever cache.
  // A failed send is forgotten immediately (see `save`) rather than left cached: the server
  // geometry never changed, so waiting for the reconciliation loop below to match it would never
  // happen and the marker would stay at the unsaved position forever.
  const [sent, setSent] = useState<ReadonlyMap<string, Position>>(new Map());
  // Adjust state during render (React's documented alternative to an effect for this): once the
  // objects prop actually changes identity, drop any cached entry the fresh props now agree
  // with. Guarded by `objectsSeenAt` so this only runs when `objects` itself changes, not on
  // every local re-render (selecting a chip, a save's own setSent, etc.).
  const [objectsSeenAt, setObjectsSeenAt] = useState(objects);
  if (objects !== objectsSeenAt) {
    setObjectsSeenAt(objects);
    const next = new Map(sent);
    let changed = false;
    for (const o of objects) {
      const s = next.get(o.id);
      if (s && o.x === s.x && o.y === s.y && o.radius === s.radius) {
        next.delete(o.id);
        changed = true;
      }
    }
    if (changed) setSent(next);
  }

  const current = (id: string): Position | null => {
    const s = sent.get(id);
    if (s) return s;
    const o = objects.find((obj) => obj.id === id);
    if (!o || o.x === null || o.y === null || o.radius === null) return null;
    return { x: o.x, y: o.y, radius: o.radius };
  };

  const placed: CanvasMarker[] = objects.flatMap((o) => {
    const c = current(o.id);
    return c ? [{ id: o.id, ...c, label: o.label, confirmed: sent.has(o.id) ? false : o.confirmed }] : [];
  });
  const selectedUnplaced = objects.find((o) => o.id === selectedId && o.x === null) ?? null;

  function save(objectId: string, input: Position) {
    setSent((m) => new Map(m).set(objectId, input));
    start(async () => {
      setError(null);
      const r = await updateObjectAction(gameId, objectId, input);
      if (!r.ok) {
        setError(r.message);
        setSent((m) => {
          if (!m.has(objectId)) return m;
          const next = new Map(m);
          next.delete(objectId);
          return next;
        });
      }
      router.refresh();
    });
  }

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
          const c = current(id);
          if (c) save(id, { x: p.x, y: p.y, radius: c.radius });
        }}
        onResize={(id, radius) => {
          const c = current(id);
          if (c) save(id, { x: c.x, y: c.y, radius });
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
