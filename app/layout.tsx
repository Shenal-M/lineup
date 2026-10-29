import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Lineup — Your next watch, all lined up",
  description: "Your personal theatrical and streaming release tracker.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
