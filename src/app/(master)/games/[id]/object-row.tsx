import { Trash2 } from "lucide-react";
import type { ObjectForMaster } from "@/lib/types";
import { confirmObjectAction, removeObjectAction } from "@/lib/games/actions";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/shell/submit-button";
import { redirectBack } from "./redirect-back";

export function ObjectRow({ gameId, object, editable }: { gameId: string; object: ObjectForMaster; editable: boolean }) {
  const objectId = object.id;
  async function confirm() {
    "use server";
    redirectBack(gameId, await confirmObjectAction(gameId, objectId));
  }
  async function remove() {
    "use server";
    redirectBack(gameId, await removeObjectAction(gameId, objectId));
  }
  const pos = object.x === null ? "no position yet" : `x ${object.x.toFixed(3)} · y ${object.y?.toFixed(3)} · r ${object.radius?.toFixed(3)}`;
  return (
    <li className="flex items-center gap-4 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={object.sourceImageUrl} alt={object.label} className="size-14 shrink-0 rounded-lg object-cover" />
      <div className="flex-1">
        <div className="font-medium">{object.label}</div>
        <div className="text-xs text-muted-foreground">{pos}</div>
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
        <>
          <form action={confirm}>
            <SubmitButton size="sm" disabled={object.x === null || object.confirmed}>
              Confirm
            </SubmitButton>
          </form>
          <form action={remove}>
            <SubmitButton size="sm" variant="ghost">
              <Trash2 aria-hidden />
              Remove
            </SubmitButton>
          </form>
        </>
      )}
    </li>
  );
}
