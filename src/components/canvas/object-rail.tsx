import type { ObjectThumbnail } from "@/lib/types";

/** SPEC §3.3.4: the thumbnails of all N objects stay visible throughout play. */
export function ObjectRail({ objects }: { objects: readonly ObjectThumbnail[] }) {
  return (
    <ul data-testid="object-rail" className="flex flex-wrap gap-3">
      {objects.map((o) => (
        <li key={o.id} className="flex w-24 flex-col items-center gap-1 text-center text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={o.sourceImageUrl} alt={o.label} className="h-20 w-20 rounded border object-contain" />
          <span>{o.label}</span>
        </li>
      ))}
    </ul>
  );
}
