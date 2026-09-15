import Link from "next/link";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

/** The brand mark. Links home; `size` scales for the landing hero. */
export function Wordmark({ href = "/", className, size = "md" }: { href?: string; className?: string; size?: "md" | "lg" }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 font-display font-extrabold tracking-tight", size === "lg" ? "text-4xl" : "text-xl", className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Eye className={size === "lg" ? "size-6" : "size-5"} aria-hidden />
      </span>
      Spotted
    </Link>
  );
}
