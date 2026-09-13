import type { ObjectForMaster } from "@/lib/types";
import { confirmObjectAction, removeObjectAction } from "@/lib/games/actions";

export function ObjectRow({ gameId, object, editable }: { gameId: string; object: ObjectForMaster; editable: boolean }) {
  const objectId = object.id;
  async function confirm() {
    "use server";
    await confirmObjectAction(gameId, objectId);
  }
  async function remove() {
    "use server";
    await removeObjectAction(gameId, objectId);
  }
  const pos = object.x === null ? "no position yet" : `x ${object.x.toFixed(3)} · y ${object.y?.toFixed(3)} · r ${object.radius?.toFixed(3)}`;
  return (
    <li className="flex items-center gap-4 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={object.sourceImageUrl} alt={object.label} className="h-12 w-12 rounded object-cover" />
      <div className="flex-1">
        <div className="font-medium">{object.label}</div>
        <div className="text-xs text-neutral-500">{pos}</div>
      </div>
      <span className={`rounded px-2 py-1 text-xs ${object.confirmed ? "bg-green-100" : "bg-amber-100"}`}>
        {object.confirmed ? "confirmed" : "unconfirmed"}
      </span>
      {editable && (
        <>
          <form action={confirm}>
            <button disabled={object.x === null || object.confirmed} className="rounded border px-2 py-1 text-sm disabled:opacity-40">
              Confirm
            </button>
          </form>
          <form action={remove}>
            <button className="rounded border px-2 py-1 text-sm">Remove</button>
          </form>
        </>
      )}
    </li>
  );
}
