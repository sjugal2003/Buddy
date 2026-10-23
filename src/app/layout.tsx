import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Buddy: Customer Service Intelligence Hub",
  description: "Phase 1 prototype with fictional demo data.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
