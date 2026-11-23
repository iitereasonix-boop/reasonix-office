import { ArrowDown, ArrowLeft, CalendarDays, Handshake, Landmark, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { BookingButton } from "@/components/BookingModal";
import { ContactLines, PublicFooter, PublicHeader, QuickContactLinks } from "@/components/PublicChrome";
import { ScaleLogo } from "@/components/brand";
import { office, services } from "@/lib/office";

const serviceIcons = { scale: "service-civil", gavel: "service-criminal", family: "service-family", note: "service-consult" };

const values = [
  { icon: ShieldCheck, title: "خصوصية تحترمك", text: "سرية تامة ومصداقية عالية" },
  { icon: Landmark, title: "رؤية قانونية", text: "خبرة قانونية واسعة" },
  { icon: Handshake, title: "شراكة حقيقية", text: "تمثيل فعال أمام المحاكم" },
  { icon: MapPin, title: "قريبون منك", text: "في الأردن" },
];

export default function PublicHome() {
  return (
    <div className="site">
      <PublicHeader />
      <main>
        <section className="hero hero-future">
          <div className="hero-main">
            <div className="hero-copy">
              <div className="hero-eyebrow"><Sparkles size={15} /> <span>استشارات وتمثيل قانوني في الأردن</span></div>
              <h1><span>مكتب ريزونكس</span><strong>شريكك في العمل القانوني</strong></h1>
              <div className="hero-rule" aria-hidden="true"><i /><span>خبرة · وضوح · ثقة</span><i /></div>
              <p>نرافقك بخبرة قانونية واضحة وخصوصية تحفظ حقوقك، من أول استشارة وحتى اكتمال خطوات قضيتك.</p>
              <div className="hero-cta">
                <BookingButton className="btn btn-gold btn-lg"><CalendarDays size={19} /> ابدأ الآن</BookingButton>
                <Link className="btn btn-outline btn-lg" href="/#features">اكتشف المزيد <ArrowDown size={18} /></Link>
              </div>
              <div className="hero-signals" aria-label="قيم المكتب">
                <span><i /> خصوصية موكليك</span>
                <span><i /> متابعة قانونية واضحة</span>
              </div>
            </div>
            <div className="hero-visual">
              <div className="hero-halo" aria-hidden="true" />
              <div className="hero-portrait">
                <Image src="/api/office/photo" alt="صورة المكتب" fill priority unoptimized sizes="(max-width: 900px) 100vw, 48vw" />
                <span className="hero-image-shine" aria-hidden="true" />
              </div>
              <div className="hero-orbit" aria-hidden="true"><i /><i /><i /></div>
              <div className="hero-hud hero-hud-cases"><Landmark size={21} /><span><b>إدارة القضايا</b><small>بخطوات أوضح</small></span></div>
              <div className="hero-hud hero-hud-privacy"><ShieldCheck size={21} /><span><b>خصوصية عالية</b><small>أمان لكل ملف</small></span></div>
              <div className="hero-stamp"><ScaleLogo size={25} /><span><b>مكتب ريزونكس</b><small>شريكك القانوني</small></span></div>
            </div>
          </div>
          <div className="values values-future hero-benefits" id="features" aria-label="قيم المكتب">
            {values.map(({ icon: Icon, title, text }) => <div key={title}><span className="value-icon"><Icon size={21} /></span><span><b>{title}</b><small>{text}</small></span></div>)}
          </div>
        </section>

        <QuickContactLinks />

        <section className="services" id="services">
          <div className="section-heading">
            <span className="section-eyebrow">خبرة ترافقك في كل مرحلة</span>
            <h2 className="section-title">مساحتك الآمنة <em>للحلول القانونية</em></h2>
            <p>نبدأ بالاستماع، ونبني معك الخطوة القانونية الأنسب.</p>
          </div>
          <div className="service-grid">
            {services.map(({ slug, title, short, icon }, index) => {
              return (
                <Link key={slug} href={`/services/${slug}`} className="service-card">
                  <div className="service-card-top"><span>{String(index + 1).padStart(2, "0")}</span><em><Image src={`/images/${serviceIcons[icon]}.jpg`} alt="" width={56} height={56} /></em></div>
                  <h3>{title}</h3>
                  <p>{short}</p>
                  <span className="service-link">اكتشف الخدمة <ArrowLeft size={15} /></span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="about" id="about">
          <div className="about-orb" aria-hidden="true"><ScaleLogo size={74} /></div>
          <div className="about-copy">
            <span className="section-eyebrow">عن مكتب ريزونكس</span>
            <h2>قانونٌ يواكب المستقبل،<br /><em>ويضع الإنسان أولاً.</em></h2>
            <p>{office.name} مكتب أردني يقدم التمثيل والاستشارة في القضايا المدنية والتجارية والجزائية وقضايا الأحوال الشخصية. نعمل بوضوح مع موكلينا، ونبقيهم على اطلاع بسير قضاياهم في كل مرحلة.</p>
            <div className="about-promise"><ShieldCheck size={19} /><span>خطوات واضحة. تواصل مباشر. عناية بكل تفصيل.</span></div>
          </div>
          <div className="team-note" id="team">
            <span className="team-mark"><Handshake size={24} /></span>
            <span className="section-eyebrow">فريق يعمل لأجلك</span>
            <h3>كل قضية تستحق اهتماماً حقيقياً.</h3>
            <p>يقود العمل المحامي صاحب المكتب بمساندة فريق يتابع كل ملف من لحظة استلامه حتى إنجازه.</p>
          </div>
        </section>

        <section className="contact" id="contact">
          <div>
            <span className="section-eyebrow">خطوتك الأولى تبدأ هنا</span>
            <h2>خلّينا نسمع قصتك.</h2>
            <p>أرسل طلب استشارة، وسيتواصل معك فريق المكتب لتأكيد الموعد.</p>
            <ContactLines />
          </div>
          <BookingButton className="btn btn-gold btn-lg"><CalendarDays size={19} /> احجز استشارتك <ArrowLeft size={18} /></BookingButton>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
