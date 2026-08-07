import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ProvedorToast } from "@/components/ui";

const fonte = Inter({
  subsets: ["latin"],
  variable: "--fonte-app",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "PRICALL — Central de atendimento no WhatsApp",
    template: "%s · PRICALL",
  },
  description:
    "Organize os atendimentos da sua equipe de vendas no WhatsApp em uma caixa de entrada compartilhada, com distribuição, histórico e relatórios.",
  applicationName: "PRICALL",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "PRICALL", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#16A34A" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1120" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={fonte.variable} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <a
          href="#conteudo-principal"
          className="apenas-leitor-tela focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-[var(--superficie)] focus:px-4 focus:py-2 focus:shadow-lg"
        >
          Ir para o conteúdo principal
        </a>
        <ProvedorToast>{children}</ProvedorToast>
      </body>
    </html>
  );
}
