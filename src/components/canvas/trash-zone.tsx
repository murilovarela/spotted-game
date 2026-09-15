"use client";
import { Trash2 } from "lucide-react";
import type { Ref } from "react";
import { cn } from "@/lib/utils";

/** Drop target for play mode: `MarkerCanvas` tests the pointer against this element on release. */
export function TrashZone({ ref, active, className }: { ref: Ref<HTMLDivElement>; active: boolean; className?: string }) {
  return (
    <div
      ref={ref}
      data-testid="trash-zone"
      aria-label="Drag a marker here to remove it"
      className={cn(
        "flex h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm transition-colors",
        active ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground",
        className,
      )}
    >
      <Trash2 className="size-4" aria-hidden /> Drag a marker here to remove it
    </div>
  );
}
