"use client";
import { ImagePlus, Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { requestUploadUrl } from "@/lib/games/upload";
import type { AssetKind } from "@/lib/storage";
import { cn } from "@/lib/utils";

/** Browser → presigned PUT. On success calls `onUploaded(key)`; the server never sees the bytes. */
export function UploadField({ gameId, kind, onUploaded, label }: { gameId: string; kind: AssetKind; label: string; onUploaded: (key: string) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  function upload(file: File) {
    start(async () => {
      setError(null);
      const r = await requestUploadUrl({ gameId, kind, contentType: file.type });
      if (!r.ok) return setError(r.message);
      const put = await fetch(r.data.url, { method: "PUT", body: file, headers: { "content-type": file.type } });
      if (!put.ok) return setError(`Upload failed (${put.status})`);
      await onUploaded(r.data.key);
    });
  }
  function choose(file: File) {
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    upload(file);
  }
  return (
    <div className="flex flex-col gap-2">
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-sm text-muted-foreground transition-colors",
          over ? "border-primary bg-primary/5" : "border-border hover:border-primary/60",
          pending && "pointer-events-none opacity-60",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files[0];
          if (file) choose(file);
        }}
      >
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="max-h-40 rounded-lg object-contain" />
        )}
        {pending ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <ImagePlus className="size-6" aria-hidden />}
        <span className="font-medium text-foreground">{label}</span>
        <span>{preview ? "Drop another image to replace it" : "Drop an image here or click to choose · PNG, JPEG, WebP"}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={pending}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) choose(file);
          }}
        />
      </label>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
