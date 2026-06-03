import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthSessionSync } from "@/modules/auth/ui/auth-session-sync";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta-sans",
});

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
        className={`${plusJakartaSans.variable} bg-background text-foreground antialiased transition-colors duration-200`}
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
              className: "bg-background border-muted shadow-none",
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
