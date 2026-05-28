import Link from "next/link";
import { CompanyPolicyButton, type CompanyPolicyState } from "@/components/company-policy-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";
import { ROUTES } from "@/core/config/route-registry";
import { getPolicyGateState } from "@/modules/policies/server/get-policy-gate-state";

function NxtClaimLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="8" y="8" width="23" height="29" rx="4.5" fill="white" fillOpacity="0.14" />
      <rect x="11" y="5" width="23" height="29" rx="4.5" fill="white" fillOpacity="0.94" />
      <rect x="16" y="11" width="13" height="2.5" rx="1.25" fill="#4F46E5" fillOpacity="0.65" />
      <rect x="16" y="16.5" width="9" height="1.8" rx="0.9" fill="#4F46E5" fillOpacity="0.35" />
      <rect x="16" y="20.5" width="11" height="1.8" rx="0.9" fill="#4F46E5" fillOpacity="0.35" />
      <rect x="16" y="24.5" width="7" height="1.8" rx="0.9" fill="#4F46E5" fillOpacity="0.25" />
      <circle cx="35" cy="35" r="9" fill="#10B981" />
      <path
        d="M31 35L34 38L39 31.5"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type AppShellHeaderProps = {
  currentEmail?: string | null;
  actions?: React.ReactNode;
};

function toCompanyPolicyState(
  gateState: Awaited<ReturnType<typeof getPolicyGateState>>,
): CompanyPolicyState {
  return {
    policy: gateState.policy
      ? {
          id: gateState.policy.id,
          versionName: gateState.policy.versionName,
          fileUrl: gateState.policy.fileUrl,
          createdAt: gateState.policy.createdAt,
        }
      : null,
    accepted: gateState.accepted,
    acceptedAt: gateState.acceptedAt,
    message: gateState.errorMessage,
  };
}

export async function AppShellHeader({ currentEmail, actions }: AppShellHeaderProps) {
  const companyPolicyState =
    !actions && currentEmail ? toCompanyPolicyState(await getPolicyGateState()) : null;

  return (
    <header
      className="flex h-14 items-center border-b px-6"
      style={{
        backgroundColor: "var(--card)",
        borderColor: "var(--border)",
      }}
    >
      <Link href={ROUTES.dashboard} className="flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: "var(--accent)" }}
        >
          <NxtClaimLogo className="h-5 w-5" />
        </div>
        <span style={{ fontWeight: 600, fontSize: 15, color: "var(--foreground)" }}>
          NxtClaim V2
        </span>
      </Link>

      <div className="ml-auto flex items-center gap-3">
        {currentEmail ? (
          <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{currentEmail}</span>
        ) : null}
        <ThemeToggle />

        <div className="h-5 w-px" style={{ backgroundColor: "var(--border)" }} aria-hidden="true" />

        {actions ?? (
          <>
            <CompanyPolicyButton initialState={companyPolicyState} />
            <SignOutButton />
          </>
        )}
      </div>
    </header>
  );
}
