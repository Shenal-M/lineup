import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/browse.css";
import "./styles/details.css";
import "./styles/search.css";
import "./styles/following.css";
import "./styles/account.css";
import { Pwa } from "../src/components/pwa";
const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});
// The web app manifest (app/manifest.ts) and icons (app/icon.svg, app/apple-icon.png)
// are linked automatically from their file conventions.
export const metadata: Metadata = {
  title: "Lineup — Your next watch, all lined up",
  description: "Your personal theatrical and streaming release tracker.",
  applicationName: "Lineup",
  // iOS home-screen app: full screen, content under a translucent status bar.
  appleWebApp: {
    capable: true,
    title: "Lineup",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};
// viewport-fit=cover lets env(safe-area-inset-*) pad the tab bar and bottom sheet on iOS.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0b",
  colorScheme: "dark",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      {/* Browser extensions (e.g. Grammarly) add attributes to <body> before hydration. */}
      <body suppressHydrationWarning>
        {children}
        <Pwa />
      </body>
    </html>
  );
}
