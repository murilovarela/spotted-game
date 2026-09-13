"use client";
import { useState } from "react";
import { UploadField } from "./upload-field";

/** label + prompt + an object-image upload; disabled until the upload has produced a key. */
export function AddObjectForm({ gameId, action }: { gameId: string; action: (formData: FormData) => void | Promise<void> }) {
  const [sourceImageKey, setSourceImageKey] = useState<string | null>(null);
  return (
    <form action={action} className="mt-4 flex flex-col gap-3 border-t pt-4">
      <label className="flex flex-col gap-1">
        Label
        <input name="label" required maxLength={60} className="rounded border p-2" />
      </label>
      <label className="flex flex-col gap-1">
        Prompt
        <input name="prompt" maxLength={500} className="rounded border p-2" />
      </label>
      <UploadField gameId={gameId} kind="object" label="Object image" onUploaded={async (key) => setSourceImageKey(key)} />
      <input type="hidden" name="sourceImageKey" value={sourceImageKey ?? ""} />
      <button type="submit" disabled={!sourceImageKey} className="self-start rounded border px-3 py-2 disabled:opacity-40">
        Add object
      </button>
    </form>
  );
}
