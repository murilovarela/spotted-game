/**
 * 1. Resolve the Clerk test user (E2E_CLERK_USER_ID, else find-or-create e2e@spotted.test).
 * 2. Seed the database with that user as master → e2e/.auth/seed.json.
 * 3. Sign in through a Clerk sign-in token → e2e/.auth/user.json (storage state).
 */
import { createClerkClient } from "@clerk/backend";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { chromium, type FullConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const EMAIL = "e2e@spotted.test";

async function resolveUser(): Promise<{ id: string; email: string }> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set");
  const client = createClerkClient({ secretKey });
  const explicit = process.env.E2E_CLERK_USER_ID;
  if (explicit) {
    const u = await client.users.getUser(explicit);
    const primary = u.primaryEmailAddress?.emailAddress;
    if (primary) return { id: u.id, email: primary };
    // The app mirrors Clerk users by primary email (`toUserRow`), so a user created without one
    // is signed-out as far as the app is concerned. Promote a verified address rather than fail.
    const verified = u.emailAddresses.find((e) => e.verification?.status === "verified");
    if (!verified) throw new Error(`Clerk user ${explicit} has no primary or verified email`);
    await client.users.updateUser(u.id, { primaryEmailAddressID: verified.id });
    return { id: u.id, email: verified.emailAddress };
  }
  const found = (await client.users.getUserList({ emailAddress: [EMAIL] })).data[0];
  if (found) return { id: found.id, email: EMAIL };
  const created = await client.users.createUser({ emailAddress: [EMAIL], firstName: "E2E", lastName: "Player", skipPasswordRequirement: true });
  return { id: created.id, email: EMAIL };
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  await clerkSetup();
  const user = await resolveUser();

  const out = execFileSync("npm", ["run", "-s", "seed", "--", "--json"], {
    env: { ...process.env, SEED_MASTER_ID: user.id },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lastLine = out.trim().split("\n").at(-1) ?? "";
  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync("e2e/.auth/seed.json", JSON.stringify({ ...JSON.parse(lastLine), user }));

  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
  // waitUntil: "domcontentloaded" — this only has to prove the session is live, not render the
  // page; /games renders one full-size generated image per card, and waiting for "load" there
  // can exceed the navigation timeout well before the DOM (and thus the session) is confirmed.
  await page.goto("/games", { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/games");
  await page.context().storageState({ path: "e2e/.auth/user.json" });
  await browser.close();
}
