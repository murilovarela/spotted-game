import { SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { getCurrentActor } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Wordmark } from "./wordmark";

/** Role-aware navigation for public and authoring pages. Authorization remains server-side. */
export async function Header() {
  const actor = await getCurrentActor();
  const canAuthor = actor?.role === "game_master";

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Wordmark href={canAuthor ? "/games" : "/"} />
        <nav className="flex items-center gap-2">
          {actor ? (
            <>
              {canAuthor && (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/games">My games</Link>
                </Button>
              )}
              <UserButton />
            </>
          ) : (
            <SignInButton>
              <Button size="sm">Sign in</Button>
            </SignInButton>
          )}
        </nav>
      </div>
    </header>
  );
}
