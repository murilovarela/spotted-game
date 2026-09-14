import { redirect } from "next/navigation";
import { createGameAction } from "@/lib/games/actions";
import { getCurrentUser } from "@/lib/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/shell/submit-button";
import { masterErrorCopy } from "../[id]/error-copy";

export const metadata = { title: "New game" };

export default async function NewGamePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: errorCode } = await searchParams;
  const error = masterErrorCopy(errorCode);
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  async function create(formData: FormData) {
    "use server";
    const r = await createGameAction({
      title: String(formData.get("title") ?? ""),
      generalPrompt: String(formData.get("generalPrompt") ?? ""),
    });
    if (!r.ok) redirect(`/games/new?error=${r.error}`);
    redirect(`/games/${r.data.id}`);
  }

  return (
    <form action={create} className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl">New game</CardTitle>
          <CardDescription>Name it and describe the look you want. You add the background and objects next.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required maxLength={120} autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="generalPrompt">Style / difficulty prompt</Label>
            <Textarea id="generalPrompt" name="generalPrompt" maxLength={500} rows={3} placeholder="e.g. a sunny beach, objects small and half-hidden" />
            <p className="text-xs text-muted-foreground">Optional. Sent to the model with every generation.</p>
          </div>
        </CardContent>
        <CardFooter>
          <SubmitButton pendingLabel="Creating…">Create</SubmitButton>
        </CardFooter>
      </Card>
    </form>
  );
}
