"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import type { SavedWhat } from "./redirect-back";

const COPY: Record<SavedWhat, string> = {
  window: "Play window saved",
  position: "Position saved",
  object: "Object added",
  background: "Background uploaded",
};

/** Fires one toast for `?ok=<what>` and strips the query so a refresh does not repeat it. */
export function SavedToast({ ok }: { ok: SavedWhat | null }) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!ok) return;
    toast.success(COPY[ok]);
    router.replace(pathname, { scroll: false });
  }, [ok, pathname, router]);
  return null;
}
