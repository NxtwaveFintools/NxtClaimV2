import type { Metadata } from "next";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthSessionSync } from "@/modules/auth/ui/auth-session-sync";
import "./globals.css";

export const metadata: Metadata = {
  title: "NxtClaim V2",
  description: "Enterprise reimbursement platform authentication",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="bg-zinc-50 text-zinc-900 antialiased transition-colors duration-200 dark:bg-[#0B0F1A] dark:text-zinc-100"
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem={true}
          disableTransitionOnChange
        >
          <AuthSessionSync />
          {children}
          <Toaster
            position="top-center"
            richColors
            expand={true}
            toastOptions={{
              className: "backdrop-blur-md bg-background/90 shadow-lg border-muted",
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
