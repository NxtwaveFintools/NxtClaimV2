import Link from "next/link";
import { ROUTES } from "@/core/config/route-registry";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 py-10">
      <main className="w-full max-w-xl rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">NxtClaim V2</p>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">Page Not Found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The page you are looking for does not exist or has moved.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href={ROUTES.dashboard}
            className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover active:scale-[0.98]"
          >
            Go to Dashboard
          </Link>
          <Link
            href={ROUTES.claims.myClaims}
            className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background-secondary active:scale-[0.98]"
          >
            Claims
          </Link>
        </div>
      </main>
    </div>
  );
}
