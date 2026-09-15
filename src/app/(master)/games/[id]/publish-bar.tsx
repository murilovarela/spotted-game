import { StatusBadge } from "../status-badge";
import { SubmitButton } from "@/components/shell/submit-button";
import type { GameStatus } from "@/lib/types";

export function PublishBar({
  status,
  blockers,
  publish,
  unpublish,
}: {
  status: GameStatus;
  blockers: readonly string[];
  publish: (formData: FormData) => Promise<void>;
  unpublish: (formData: FormData) => Promise<void>;
}) {
  const canPublish = status === "draft" && blockers.length === 0;
  return (
    <div className="sticky bottom-0 z-30 -mx-4 border-t bg-background/90 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          {status === "draft" && blockers.length > 0 && (
            <ul data-testid="publish-blockers" className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
              {blockers.map((b) => (
                <li key={b}>· {b}</li>
              ))}
            </ul>
          )}
          {status === "scheduled" && <span className="text-sm text-muted-foreground">Players can start once the window opens.</span>}
        </div>
        {status === "draft" && (
          <form action={publish}>
            <SubmitButton size="lg" disabled={!canPublish} pendingLabel="Publishing…">
              Publish
            </SubmitButton>
          </form>
        )}
        {status === "scheduled" && (
          <form action={unpublish}>
            <SubmitButton variant="outline" pendingLabel="Unpublishing…">
              Unpublish
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
