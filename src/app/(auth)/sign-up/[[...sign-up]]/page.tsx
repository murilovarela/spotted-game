import { SignUp } from "@clerk/nextjs";
import { Wordmark } from "@/components/shell/wordmark";

export default function SignUpPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <Wordmark size="lg" />
      <SignUp />
    </main>
  );
}
