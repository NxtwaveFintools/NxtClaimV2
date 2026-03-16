import { redirect } from "next/navigation";
import { ROUTES } from "@/core/config/route-registry";

export default function DashboardClaimsCompatPage() {
  redirect(ROUTES.claims.list);
}
