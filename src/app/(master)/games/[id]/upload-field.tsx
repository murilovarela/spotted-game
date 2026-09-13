"use client";
import { useState, useTransition } from "react";
import { requestUploadUrl } from "@/lib/games/upload";
import type { AssetKind } from "@/lib/storage";

/** Browser → presigned PUT. On success calls `onUploaded(key)`; the server never sees the bytes. */
export function UploadField({
  gameId,
  kind,
  onUploaded,
  label,
}: {
  gameId: string;
  kind: AssetKind;
  label: string;
  onUploaded: (key: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <label className="flex flex-col gap-1">
      {label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={pending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          start(async () => {
            setError(null);
            const r = await requestUploadUrl({ gameId, kind, contentType: file.type });
            if (!r.ok) return setError(r.message);
            const put = await fetch(r.data.url, { method: "PUT", body: file, headers: { "content-type": file.type } });
            if (!put.ok) return setError(`Upload failed (${put.status})`);
            await onUploaded(r.data.key);
          });
        }}
      />
      {error && (
        <span role="alert" className="text-sm text-red-700">
          {error}
        </span>
      )}
    </label>
  );
}
