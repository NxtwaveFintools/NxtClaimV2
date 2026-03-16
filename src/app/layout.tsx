import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
        className={`${geistSans.variable} ${geistMono.variable} bg-slate-50 text-slate-900 antialiased transition-colors duration-200 dark:bg-[#0B0F1A] dark:text-slate-100`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem={true}
          disableTransitionOnChange
        >
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
