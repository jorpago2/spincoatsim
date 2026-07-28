import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "SpinCoatSim · GDS spin-coating cross-sections";
const description = "Simulate calibrated spin-coated film thickness over uniform, patterned and etched GDS cross-sections.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    metadataBase,
    title,
    description,
    openGraph: { title, description, images: [{ url: "/og.png", width: 1536, height: 1024 }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
