import type { Metadata, Viewport } from "next";
import { es } from "@/i18n/es";
import "./globals.css";

// Mientras no haya dominio propio, las imágenes para compartir se resuelven contra la URL de Vercel.
const SITE_URL = "https://avecina-ec.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: es.app.name,
  description: es.app.description,
  manifest: "/site.webmanifest",
  icons: {
    // El .ico lo toma Next de src/app/favicon.ico.
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: es.app.name,
    description: es.app.description,
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    locale: "es_EC",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#1D3557",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
