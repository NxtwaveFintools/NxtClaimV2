export function getUserDisplayName(email?: string | null): string {
  if (!email) return "User";

  const localPart = email.split("@")[0] || "";
  const cleaned = localPart
    .replace(/[._-]+/g, " ")
    .replace(/\d+/g, "")
    .trim();

  if (!cleaned) return "User";

  return cleaned
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function getUserFirstName(email?: string | null): string {
  return getUserDisplayName(email).split(" ")[0] || "User";
}

export function getUserInitials(email?: string | null): string {
  const displayName = getUserDisplayName(email);

  return displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function getEmailDomain(email?: string | null): string {
  if (!email || !email.includes("@")) return "";
  return email.split("@")[1] || "";
}
