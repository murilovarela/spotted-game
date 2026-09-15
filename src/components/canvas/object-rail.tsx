"use client";
import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ObjectThumbnail } from "@/lib/types";
import { cn } from "@/lib/utils";

/** SPEC §3.3.4: the thumbnails of all N objects stay visible throughout play. Tap one for a closer look. */
export function ObjectRail({ objects, variant = "grid" }: { objects: readonly ObjectThumbnail[]; variant?: "grid" | "strip" }) {
  const [open, setOpen] = useState<ObjectThumbnail | null>(null);
  return (
    <>
      <ul data-testid="object-rail" className={cn("gap-3", variant === "strip" ? "flex overflow-x-auto px-4 py-2 [scrollbar-width:thin] lg:flex-col lg:overflow-visible lg:px-0" : "flex flex-wrap")}>
        {objects.map((o) => (
          <li key={o.id} className="shrink-0">
            <button type="button" onClick={() => setOpen(o)} className="flex w-24 flex-col items-center gap-1 rounded-lg p-1 text-center text-xs focus-visible:outline-2 focus-visible:outline-ring">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={o.sourceImageUrl} alt="" className="size-20 rounded-lg border bg-muted object-contain" />
              <span className="line-clamp-2">{o.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent side="bottom" className="items-center pb-8">
          <SheetHeader className="items-center">
            <SheetTitle>{open?.label}</SheetTitle>
            <SheetDescription>What you are looking for. It may be smaller or partly hidden in the scene.</SheetDescription>
          </SheetHeader>
          {open && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={open.sourceImageUrl} alt={open.label} className="max-h-[50vh] w-auto rounded-xl border object-contain" />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
