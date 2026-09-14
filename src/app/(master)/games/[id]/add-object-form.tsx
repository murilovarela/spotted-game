"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/shell/submit-button";
import { UploadField } from "./upload-field";

/** label + prompt + an object-image upload; disabled until the upload has produced a key. */
export function AddObjectForm({ gameId, action }: { gameId: string; action: (formData: FormData) => void | Promise<void> }) {
  const [sourceImageKey, setSourceImageKey] = useState<string | null>(null);
  return (
    <form action={action} className="flex flex-col gap-4 border-t pt-4">
      <div className="grid gap-2">
        <Label htmlFor="label">Label</Label>
        <Input id="label" name="label" required maxLength={60} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="prompt">Prompt</Label>
        <Input id="prompt" name="prompt" maxLength={500} />
      </div>
      <UploadField gameId={gameId} kind="object" label="Object image" onUploaded={async (key) => setSourceImageKey(key)} />
      <input type="hidden" name="sourceImageKey" value={sourceImageKey ?? ""} />
      <SubmitButton variant="secondary" disabled={!sourceImageKey} className="self-start">
        Add object
      </SubmitButton>
    </form>
  );
}
