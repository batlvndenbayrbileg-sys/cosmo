import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/i18n/I18nProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CosmoConfigProvider } from "@/components/cosmo/CosmoConfig";
import { AppFrame } from "@/components/shell/AppFrame";
import { LilCosmoStroll } from "@/components/pet/LilCosmoStroll";

// Inter covers Latin and Cyrillic, so Mongolian text renders in the same face as English.
// The plain "cyrillic" subset lacks the Mongolian letters Ө/ө (U+04E8/04E9) and Ү/ү (U+04AE/04AF);
// they live in "cyrillic-ext", so both subsets are required.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cosmo - health companion",
  description:
    "Voice-first daily health check-in with the Cosmo companion. Prototype, not a medical device.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side only: is the Rive mascot file shipped? (Decided at render/build time.)
  const rive = fs.existsSync(path.join(process.cwd(), "public", "cosmo.riv"));

  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col">
        <I18nProvider>
          <TooltipProvider>
            <CosmoConfigProvider rive={rive}>
              <AppFrame>{children}</AppFrame>
              {/* lil cosmo strolling along the bottom of the screen (src/components/pet/LilCosmoStroll.tsx) */}
              <LilCosmoStroll />
            </CosmoConfigProvider>
          </TooltipProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
