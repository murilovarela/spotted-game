import { UserButton } from "@clerk/nextjs";
import Link from "next/link";

export default function MasterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/games" className="font-semibold">
          Spotted
        </Link>
        <UserButton />
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">{children}</main>
    </div>
  );
}
