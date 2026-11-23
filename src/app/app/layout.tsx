import { AppShell } from "@/components/AppShell";

export const metadata = { title: "ريزونكس | نظام إدارة مكتب المحاماة" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
