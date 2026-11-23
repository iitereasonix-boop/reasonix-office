import { ArrowRight, CalendarDays, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingButton } from "@/components/BookingModal";
import { PublicFooter, PublicHeader } from "@/components/PublicChrome";
import { services } from "@/lib/office";

type Props = { params: Promise<{ slug: string }> };

export const generateStaticParams = () => services.map(({ slug }) => ({ slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${services.find((service) => service.slug === slug)?.title ?? "خدماتنا"} | ريزونكس` };
}

export default async function ServicePage({ params }: Props) {
  const { slug } = await params;
  const service = services.find((item) => item.slug === slug);
  if (!service) notFound();
  return (
    <div className="site">
      <PublicHeader />
      <main className="service-page">
        <Link href="/#services" className="back-link"><ArrowRight size={16} /> كل الخدمات</Link>
        <h1>{service.title}</h1>
        <p className="service-intro">{service.intro}</p>
        <ul>{service.items.map((item) => <li key={item}><CheckCircle2 size={19} />{item}</li>)}</ul>
        <BookingButton className="btn btn-gold btn-lg" topic={service.title}><CalendarDays size={19} /> احجز استشارة في هذا المجال</BookingButton>
      </main>
      <PublicFooter />
    </div>
  );
}
