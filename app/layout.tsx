import type { Metadata } from "next";
import "./globals.css";

const title = "SpinCoatSim - GDS spin-coating cross-sections";
const description = "Simulate calibrated spin-coated film thickness over uniform, patterned and etched GDS cross-sections.";

export const metadata: Metadata = {
  metadataBase: new URL("https://jorpago2.github.io/spincoatsim/"),
  title,
  description,
  openGraph: { title, description, images: [{ url: "og.png", width: 1536, height: 1024 }] },
  twitter: { card: "summary_large_image", title, description, images: ["og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
