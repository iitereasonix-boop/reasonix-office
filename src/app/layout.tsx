import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "مكتب ريزونكس | محاماة واستشارات قانونية في الأردن",
  description: "شراكة قانونية تجمع الخبرة الإنسانية مع أدوات المستقبل. احجز استشارتك مع مكتب ريزونكس للمحاماة والاستشارات القانونية في الأردن.",
};

// Runs before paint so the saved theme never flashes the wrong colors.
const themeScript = `try{document.documentElement.dataset.theme=localStorage.getItem("reasonix-theme")||"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
