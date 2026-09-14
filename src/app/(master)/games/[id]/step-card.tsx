import { Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Step } from "./steps";

export function StepCard({ n, step, locked, children }: { n: number; step: Step; locked: boolean; children: React.ReactNode }) {
  return (
    <Card id={step.key} className="scroll-mt-20">
      <CardHeader className="flex-row items-start gap-4">
        <span
          aria-hidden
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full font-display text-sm font-bold",
            step.done ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {step.done ? <Check className="size-4" /> : n}
        </span>
        <div className="flex-1">
          <CardTitle className="flex items-center gap-2 font-display text-xl">
            {step.title}
            {locked && <Badge variant="secondary">locked after publish</Badge>}
          </CardTitle>
          <CardDescription>{step.hint}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}
