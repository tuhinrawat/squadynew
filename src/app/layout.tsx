import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/providers";

export const metadata: Metadata = {
  title: "Squady - Auction Management System",
  description: "Create, manage, and run live player auctions with real-time bidding, automated timers, and comprehensive team management. Everything you need for professional auction events.",
  keywords: "auction management, live bidding, player auction, team management, auction platform, sports auction",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
