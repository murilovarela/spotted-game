import { Badge } from "@/components/ui/badge";
import type { GameStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLE: Record<GameStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  active: "bg-success text-success-foreground",
  finished: "bg-foreground text-background",
};

export function StatusBadge({ status, className }: { status: GameStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-transparent capitalize", STYLE[status], className)}>
      {status}
    </Badge>
  );
}
