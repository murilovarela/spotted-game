import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Wordmark } from "./wordmark";

/** Master-side header: wordmark, "My games", account. Player pages render their own minimal bar. */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Wordmark href="/games" />
        <nav className="flex items-center gap-2">
          <Show when="signed-in">
            <Button asChild variant="ghost" size="sm">
              <Link href="/games">My games</Link>
            </Button>
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton>
              <Button size="sm">Sign in</Button>
            </SignInButton>
          </Show>
        </nav>
      </div>
    </header>
  );
}
