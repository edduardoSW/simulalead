import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "simulaLEAD — Treinamento de SDR com IA",
  description: "Plataforma de simulação comercial para SDRs praticarem conversas, objeções e qualificação com feedback objetivo.",
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
