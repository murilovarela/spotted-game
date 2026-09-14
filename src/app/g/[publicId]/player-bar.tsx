import { Wordmark } from "@/components/shell/wordmark";

/** Minimal top bar for player pages: wordmark left, whatever the screen needs right. */
export function PlayerBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-5xl items-center justify-between px-4">
        <Wordmark />
        <div className="flex items-center gap-3">{children}</div>
      </div>
    </div>
  );
}
