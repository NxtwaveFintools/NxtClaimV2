import { redirect } from "next/navigation";
import { resolveRootRoute } from "@/modules/auth/server/resolve-root-route";

export default async function Home() {
  const destination = await resolveRootRoute();
  redirect(destination);
}
