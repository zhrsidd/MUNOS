import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { AboutContent } from "@/components/about-content";
export const metadata: Metadata = { title: `About · ${BRAND.conference} ${BRAND.product}` };
/** Public: no staff session or device storage (components/conference-shell.tsx). Reached from every workspace footer. */
export default function AboutPage() {
  return (
    <main className="about-page">
      <section className="panel about-card" aria-labelledby="about-title">
        <Image src={BRAND.logo} alt={BRAND.logoAlt} width={96} height={96} className="about-logo" />
        <p className="eyebrow">About</p>
        <h1 id="about-title">
          {BRAND.conference} {BRAND.product}
        </h1>
        <AboutContent />
        <p>
          <Link href="/">Back to {BRAND.product}</Link>
        </p>
      </section>
    </main>
  );
}
