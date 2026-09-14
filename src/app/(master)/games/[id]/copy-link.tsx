"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(`${location.origin}${path}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
