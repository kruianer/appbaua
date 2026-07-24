import type { Metadata, Viewport } from "next";
import "./nocturne.css";

export const metadata: Metadata = {
  title: "appbaua — Coding-Worker",
  description: "Repos verwalten, die der autonome Worker bearbeitet.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#161826",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
