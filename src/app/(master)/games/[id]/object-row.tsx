import { Trash2 } from "lucide-react";
import type { ObjectForMaster } from "@/lib/types";
import { removeObjectAction } from "@/lib/games/actions";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/shell/submit-button";
import { redirectBack } from "./redirect-back";

export function ObjectRow({ gameId, object, editable }: { gameId: string; object: ObjectForMaster; editable: boolean }) {
  const objectId = object.id;
  async function remove() {
    "use server";
    redirectBack(gameId, await removeObjectAction(gameId, objectId));
  }
  return (
    <li className="flex items-center gap-4 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={object.sourceImageUrl} alt={object.label} className="size-14 shrink-0 rounded-lg object-cover" />
      <div className="flex-1">
        <div className="font-medium">{object.label}</div>
        <div className="line-clamp-2 text-xs text-muted-foreground">{object.prompt || "No prompt"}</div>
      </div>
      <Badge
        variant="outline"
        className={
          object.confirmed
            ? "border-transparent bg-success text-success-foreground"
            : "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100"
        }
      >
        {object.confirmed ? "confirmed" : "unconfirmed"}
      </Badge>
      {editable && (
        <form action={remove}>
          <SubmitButton size="sm" variant="ghost">
            <Trash2 aria-hidden />
            Remove
          </SubmitButton>
        </form>
      )}
    </li>
  );
}
