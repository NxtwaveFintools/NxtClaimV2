export function getEmailDomain(email: string): string {
  const [, domain = ""] = email.trim().toLowerCase().split("@");
  return domain;
}
