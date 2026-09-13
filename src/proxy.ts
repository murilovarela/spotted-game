import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Play pages are public: the server decides per game whether to 404 (SPEC §3.3.1).
// `/api/generate` is NOT public: browser polling carries a Clerk session, and a webhook
// (if one is ever added) must be whitelisted here explicitly rather than by leaving the
// whole prefix open.
const isPublic = createRouteMatcher(["/", "/g/(.*)", "/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
