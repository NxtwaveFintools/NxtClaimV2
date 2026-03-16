export const ALLOWED_AUTH_DOMAINS = ["nxtwave.co.in", "nxtwave.in", "nxtwave.tech"] as const;

export function getEmailDomain(email: string): string {
  const [, domain = ""] = email.trim().toLowerCase().split("@");
  return domain;
}

export function isAllowedEmailDomain(email: string): boolean {
  return ALLOWED_AUTH_DOMAINS.includes(
    getEmailDomain(email) as (typeof ALLOWED_AUTH_DOMAINS)[number],
  );
}
