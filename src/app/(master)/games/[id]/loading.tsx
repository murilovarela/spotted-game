import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6 pb-24">
      <Skeleton className="h-9 w-64" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-40 w-full rounded-xl" />
      ))}
    </div>
  );
}
