import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterSW, InstallButton } from "@/components/pwa";

export const metadata: Metadata = {
  title: "مكتب ريزونكس ونهار | محاماة واستشارات قانونية في الأردن",
  description: "شراكة قانونية تجمع الخبرة الإنسانية مع أدوات المستقبل. احجز استشارتك مع مكتب ريزونكس ونهار للمحاماة والاستشارات القانونية في الأردن.",
  manifest: "/manifest.webmanifest",
  applicationName: "ريزونكس ونهار",
  appleWebApp: {
    capable: true,
    title: "ريزونكس ونهار",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1526",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Runs before paint so the saved theme never flashes the wrong colors.
const themeScript = `try{document.documentElement.dataset.theme=localStorage.getItem("reasonix-theme")||"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        {children}
        <RegisterSW />
        <InstallButton />
      </body>
    </html>
  );
}
