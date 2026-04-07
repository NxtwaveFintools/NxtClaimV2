import { Suspense } from "react";
import { PolicyGate } from "@/components/layout/PolicyGate";
import { getPolicyGateState } from "@/modules/policies/server/get-policy-gate-state";

function DashboardGroupLayoutFallback() {
  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-8 dark:bg-[#0B0F1A]">
      <main className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
          <div className="space-y-2">
            <div className="shimmer-sweep h-8 w-44 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-4 w-64 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`dashboard-layout-fallback-row-${index}`}
                className="shimmer-sweep h-4 w-full rounded-md bg-zinc-200 dark:bg-gray-800/40"
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

async function DashboardGroupPolicyGate({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const policyGateState = await getPolicyGateState();

  return <PolicyGate initialState={policyGateState}>{children}</PolicyGate>;
}

export default function DashboardGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Suspense fallback={<DashboardGroupLayoutFallback />}>
      <DashboardGroupPolicyGate>{children}</DashboardGroupPolicyGate>
    </Suspense>
  );
}
