/**
 * Runs the pipeline on the golden set and reports a pass rate. On demand only; never CI.
 *
 *   npm run eval:generation [-- --backend gemini|paste] [--threshold 0.8] [--out <dir>]
 *
 * `--out` writes every generated scene (`<case>-attempt-N.png`) and a `<case>.json` trace
 * (prompt, candidates, labels, failures, adjustments — no image data) for the record.
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attemptOnce } from "@/lib/generation/attempt";
import { backendFromEnv, type GenerationBackend } from "@/lib/generation/backend";
import { createPasteBackend } from "@/lib/generation/paste";
import { formatAdjustments, formatFailures } from "@/lib/generation/prompt";
import type { Adjustment, GameInput } from "@/lib/generation/types";
import { MAX_GENERATION_ATTEMPTS } from "@/lib/types";

loadEnvConfig(process.cwd());

const args = new Map(process.argv.slice(2).map((a, i, all) => [a, all[i + 1]] as const));
const mode = args.get("--backend") ?? "gemini";
const threshold = Number(args.get("--threshold") ?? "0.8");
const outDir = args.get("--out") ?? null;
const root = join(process.cwd(), "evals/generation/golden");

type CaseSpec = { title: string; generalPrompt: string; objects: { file: string; label: string; prompt: string; requestedScale: number | null }[] };

function loadCase(dir: string): GameInput {
  const spec = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as CaseSpec;
  return {
    id: dir,
    title: spec.title,
    generalPrompt: spec.generalPrompt,
    background: new Uint8Array(readFileSync(join(dir, "background.png"))),
    objects: spec.objects.map((o, i) => ({ id: `o${i}`, label: o.label, prompt: o.prompt, requestedScale: o.requestedScale, sortOrder: i, image: new Uint8Array(readFileSync(join(dir, o.file))) })),
  };
}

type AttemptTrace = {
  attempt: number;
  ms: number;
  size: { width: number; height: number };
  prompt: string;
  candidates: readonly unknown[];
  labels: readonly unknown[];
  visionRaw: unknown;
  result: string;
  added: string | null;
};
type CaseResult = { passed: boolean; attempts: number; last: string; trace: AttemptTrace[] };

async function runCase(backend: GenerationBackend, game: GameInput, name: string): Promise<CaseResult> {
  let adjustments: readonly Adjustment[] = [];
  let last = "";
  const trace: AttemptTrace[] = [];
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const started = Date.now();
    const out = await attemptOnce(backend, game, adjustments);
    const ms = Date.now() - started;
    const result = out.result.ok ? `pass: ${out.result.proposals.map((p) => `${p.objectId}@(${p.x.toFixed(2)},${p.y.toFixed(2)}) r${p.radius.toFixed(3)}`).join(", ")}` : formatFailures(out.result.failures, game.objects).replaceAll("\n", "; ");
    trace.push({ attempt, ms, size: { width: out.image.width, height: out.image.height }, prompt: out.prompt, candidates: out.candidates, labels: out.labels, visionRaw: out.visionRaw, result, added: formatAdjustments(out.added) });
    if (outDir) writeFileSync(join(outDir, `${name}-attempt-${attempt}.png`), out.image.png);
    const conf = out.labels.map((l) => `${l.objectId ?? "null"}:${l.confidence.toFixed(2)}`).join(" ");
    console.log(`  attempt ${attempt}  ${ms}ms  ${out.image.width}×${out.image.height}  candidates=${out.candidates.length}  labels=[${conf}]  ${result}`);
    if (out.added.length > 0) console.log(`    adjustment: ${formatAdjustments(out.added)?.replaceAll("\n", " | ")}`);
    if (out.result.ok) return { passed: true, attempts: attempt, last: "pass", trace };
    last = result;
    adjustments = out.adjustments;
  }
  return { passed: false, attempts: MAX_GENERATION_ATTEMPTS, last, trace };
}

async function main(): Promise<void> {
  const selection = mode === "paste" ? { ok: true as const, backend: createPasteBackend() } : backendFromEnv();
  if (!selection.ok) throw new Error(selection.reason);
  if (outDir) mkdirSync(outDir, { recursive: true });
  const cases = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(root, d.name));
  const lines: string[] = [];
  let passed = 0;
  for (const dir of cases) {
    const name = dir.split("/").at(-1) ?? dir;
    console.log(`${name}:`);
    const r = await runCase(selection.backend, loadCase(dir), name);
    passed += r.passed ? 1 : 0;
    lines.push(`${r.passed ? "PASS" : "FAIL"}  ${name}  attempts=${r.attempts}  ${r.last}`);
    if (outDir) writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify({ backend: selection.backend.name, ...r }, null, 2)}\n`);
  }
  const rate = cases.length === 0 ? 0 : passed / cases.length;
  console.log(`\n${lines.join("\n")}`);
  console.log(`\n${passed}/${cases.length} passed (${(rate * 100).toFixed(0)}%) with backend=${selection.backend.name}; threshold ${threshold * 100}%`);
  if (rate < threshold) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
