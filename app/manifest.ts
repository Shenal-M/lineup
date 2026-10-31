import type { MetadataRoute } from "next";
// Served at /manifest.webmanifest. Android builds the installed app's launch splash from
// name, background_color and the icons, so the 512px icons keep it crisp.
const icon = (src: string, size: number, purpose: "any" | "maskable" | "monochrome") => ({
  src: `/icons/${src}`,
  sizes: `${size}x${size}`,
  type: "image/png",
  purpose,
});
const shortcut = (name: string, url: string, file: string) => ({
  name,
  url,
  icons: [icon(file, 96, "any")],
});
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Lineup",
    short_name: "Lineup",
    description: "Your personal theatrical and streaming release tracker.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    categories: ["entertainment"],
    icons: [
      icon("icon-192.png", 192, "any"),
      icon("icon-512.png", 512, "any"),
      icon("maskable-192.png", 192, "maskable"),
      icon("maskable-512.png", 512, "maskable"),
      icon("badge-96.png", 96, "monochrome"),
    ],
    shortcuts: [
      shortcut("Movies", "/", "shortcut-movies.png"),
      shortcut("TV shows", "/tv", "shortcut-tv.png"),
      shortcut("Following", "/following", "shortcut-following.png"),
      shortcut("Search", "/search", "shortcut-search.png"),
    ],
    // Opening the app (or a shortcut) reuses the open window instead of stacking another.
    launch_handler: { client_mode: "navigate-existing" },
  };
}
