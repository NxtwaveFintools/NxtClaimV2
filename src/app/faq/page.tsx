import { redirect } from "next/navigation";
import { AppShellHeader } from "@/components/app-shell-header";
import { ROUTES } from "@/core/config/route-registry";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { faqData } from "@/modules/faq/data/faq-data";
import { FaqAccordion } from "@/modules/faq/ui/faq-accordion";
import { FaqBackButton } from "@/modules/faq/ui/faq-back-button";
import { pageBodyFont, pageDisplayFont } from "@/lib/fonts";

export const metadata = {
  title: "Frequently Asked Questions | NxtClaim V2",
};

export default async function FaqPage() {
  const currentUserResult = await getCachedCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    redirect(ROUTES.login);
  }

  const currentEmail = currentUserResult.user?.email ?? null;

  return (
    <div
      className={`${pageBodyFont.variable} ${pageDisplayFont.variable} dashboard-font-body nxt-page-bg`}
    >
      <AppShellHeader currentEmail={currentEmail} />

      <main className="mx-auto max-w-400 px-4 py-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-4xl border border-zinc-200/80 bg-white/92 shadow-[0_24px_80px_-28px_rgba(15,23,42,0.18)] backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/30">
          <div className="px-6 py-6">
            <div className="flex flex-wrap items-center gap-3">
              <FaqBackButton />
            </div>

            <div className="mt-4">
              <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                Frequently Asked Questions
              </h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Find answers to common questions.
              </p>
            </div>

            <div className="mt-6">
              <FaqAccordion items={faqData} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
