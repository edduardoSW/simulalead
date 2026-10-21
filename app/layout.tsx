import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "simulaLEAD — Treinamento comercial com IA",
  description: "Pratique conversas comerciais, receba feedback objetivo e acompanhe sua evolução.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
