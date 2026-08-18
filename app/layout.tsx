import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fila da Marmita",
  description: "Fila para aquecer marmitas no micro-ondas do escritório",
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
