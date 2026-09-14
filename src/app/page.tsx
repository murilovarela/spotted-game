import { ImageUp, Share2, Sparkles } from "lucide-react";
import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { Header } from "@/components/shell/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  { icon: ImageUp, title: "Upload", body: "A background scene and up to five object photos." },
  { icon: Sparkles, title: "Generate", body: "The model hides the objects in the scene and finds them again to prove it." },
  { icon: Share2, title: "Share", body: "Publish a window, send the link, watch the leaderboard fill." },
] as const;

export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-16">
        <section className="grid items-center gap-10 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <h1 className="font-display text-5xl font-extrabold tracking-tight">Hide it. Share it. Race the clock.</h1>
            <p className="max-w-md text-lg text-muted-foreground">Spotted turns any photo into a hidden-object game. You pick what to hide; the model hides it; your friends hunt.</p>
            <div className="flex flex-wrap gap-3">
              <Show when="signed-out">
                <Button asChild size="lg"><Link href="/sign-in">Sign in to make a game</Link></Button>
              </Show>
              <Show when="signed-in">
                <Button asChild size="lg"><Link href="/games">My games</Link></Button>
              </Show>
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/sample-frame.png" width={1024} height={768} alt="A sample generated scene with hidden objects" className="w-full rounded-2xl border shadow-lg" />
        </section>
        <section className="grid gap-4 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <Card key={title}>
              <CardHeader>
                <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><Icon aria-hidden /></span>
                <CardTitle className="font-display text-xl">{i + 1}. {title}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">{body}</CardContent>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}
