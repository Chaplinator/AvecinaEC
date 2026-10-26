import type { Metadata } from "next";
import { es } from "@/i18n/es";
import "./globals.css";

export const metadata: Metadata = {
  title: es.app.name,
  description: es.app.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
