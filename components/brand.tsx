import Image from "next/image";
import Link from "next/link";

/** The one place the seal and wordmark appear (docs/BRAND.md §1). The text names the link; the seal is decoration. */
export function Brand({ href = "/", size = 36 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="brand">
      <Image className="brand-logo" src="/dcmun-logo.jpg" alt="" width={size} height={size} priority />
      <span>
        DCMUN<span className="brand-os"> Conference OS</span>
      </span>
    </Link>
  );
}
