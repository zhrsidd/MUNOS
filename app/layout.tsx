import type { Metadata } from "next";
import "./globals.css";
import localFont from "next/font/local";
const dmSans = localFont({
  src: "./fonts/DMSans.ttf",
  variable: "--font-dm",
  display: "swap",
});
const manrope = localFont({
  src: "./fonts/Manrope.ttf",
  variable: "--font-manrope",
  display: "swap",
});
import { OfflineShell } from "@/components/offline-shell";
import { ConferenceShell } from "@/components/conference-shell";
export const metadata: Metadata = {
  title: "Conference OS · A calmer conference day",
  description: "One conference. Every team in sync.",
  icons: { icon: "/dcmun-logo.jpg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${manrope.variable}`}>
        <ConferenceShell>{children}</ConferenceShell>
        <OfflineShell />
      </body>
    </html>
  );
}
