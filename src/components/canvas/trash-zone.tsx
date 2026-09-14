"use client";
import type { Ref } from "react";

/** Drop target for play mode: `MarkerCanvas` tests the pointer against this element on release. */
export function TrashZone({ ref, active }: { ref: Ref<HTMLDivElement>; active: boolean }) {
  return (
    <div
      ref={ref}
      data-testid="trash-zone"
      aria-label="Drag a marker here to remove it"
      className={`flex h-16 items-center justify-center rounded border-2 border-dashed text-sm ${active ? "border-red-500 bg-red-50 text-red-700" : "border-neutral-300 text-neutral-500"}`}
    >
      🗑 Drag a marker here to remove it
    </div>
  );
}
