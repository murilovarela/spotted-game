import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Play pages are public: the server decides per game whether to 404 (SPEC §3.3.1).
const isPublic = createRouteMatcher(["/", "/g/(.*)", "/sign-in(.*)", "/sign-up(.*)", "/api/generate/(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
