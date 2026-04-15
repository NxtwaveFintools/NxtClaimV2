import { redirect } from "next/navigation";
import { ROUTES } from "@/core/config/route-registry";

type SearchParamsValue = string | string[] | undefined;

type ClaimsLegacyPageProps = {
  searchParams?: Record<string, SearchParamsValue>;
};

function buildQueryString(searchParams?: Record<string, SearchParamsValue>): string {
  if (!searchParams) {
    return "";
  }

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.length > 0) {
          params.append(key, entry);
        }
      }
      continue;
    }

    if (typeof value === "string" && value.length > 0) {
      params.set(key, value);
    }
  }

  return params.toString();
}

export default async function LegacyClaimsPage({ searchParams }: ClaimsLegacyPageProps) {
  const query = buildQueryString(searchParams);
  const targetPath = query ? `${ROUTES.claims.myClaims}?${query}` : ROUTES.claims.myClaims;

  redirect(targetPath);
}
