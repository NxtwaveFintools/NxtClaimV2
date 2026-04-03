import { PolicyGate } from "@/components/layout/PolicyGate";
import { getPolicyGateState } from "@/modules/policies/server/get-policy-gate-state";

export default async function DashboardGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const policyGateState = await getPolicyGateState();

  return <PolicyGate initialState={policyGateState}>{children}</PolicyGate>;
}
