"use client";

import { ChevronDown, LogIn, MapPin, Menu, MessageCircle, Phone, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { InstallHeaderButton } from "@/components/pwa";
import { office, services } from "@/lib/office";
import { whatsappNumber } from "@/lib/text";

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const close = () => {
    setOpen(false);
    setServicesOpen(false);
  };
  return (
    <header className="site-header">
      <Link href="/" className="site-brand" onClick={close}><Brand subtitle="شريكك في العمل القانوني" size={52} /></Link>
      <button className="site-burger" aria-label="القائمة" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
      <nav className={open ? "open" : ""} aria-label="القائمة الرئيسية">
        <Link className="active" href="/" onClick={close}>الرئيسية</Link>
        <Link href="/#features" onClick={close}>المميزات</Link>
        <div className="site-drop" onMouseEnter={() => setServicesOpen(true)} onMouseLeave={() => setServicesOpen(false)}>
          <button aria-expanded={servicesOpen} onClick={() => setServicesOpen(!servicesOpen)}>خدماتنا <ChevronDown size={15} /></button>
          {servicesOpen && <div className="site-drop-menu">{services.map(({ slug, title }) => <Link key={slug} href={`/services/${slug}`} onClick={close}>{title}</Link>)}</div>}
        </div>
        <Link href="/#about" onClick={close}>من نحن</Link>
        <Link href="/#contact" onClick={close}>تواصل معنا</Link>
      </nav>
      <div className="site-actions">
        <InstallHeaderButton />
        <Link className="site-header-login" href="/login" aria-label="تسجيل الدخول" onClick={close}><LogIn size={17} /><span>تسجيل الدخول</span></Link>
      </div>
    </header>
  );
}

type Contact = { whatsapp: string; phone: string; address: string; mapUrl: string | null };

/** Contact details are edited in settings, so they are read live rather than built into the page. */
function useContact() {
  const [contact, setContact] = useState<Contact>({ whatsapp: office.whatsapp, phone: office.phone, address: office.address, mapUrl: null });
  useEffect(() => {
    fetch("/api/office/public").then((response) => response.json()).then(setContact).catch(() => undefined);
  }, []);
  return contact;
}

const mapLink = ({ mapUrl, address }: Contact) =>
  mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || `${office.name} الأردن`)}`;

export function QuickContactLinks() {
  const contact = useContact();
  return (
    <nav className="quick-contact" aria-label="روابط التواصل السريع">
      <a
        className="quick-contact-card quick-whatsapp"
        href={contact.whatsapp ? `https://wa.me/${whatsappNumber(contact.whatsapp)}` : "/#contact"}
        target={contact.whatsapp ? "_blank" : undefined}
        rel={contact.whatsapp ? "noreferrer" : undefined}
      >
        <MessageCircle size={21} />
        <span><b>واتساب المكتب</b><small>راسلنا مباشرة</small></span>
      </a>
      <a className="quick-contact-card quick-location" href={mapLink(contact)} target="_blank" rel="noreferrer">
        <MapPin size={21} />
        <span><b>موقع المكتب</b><small>{contact.address || "الأردن"}</small></span>
      </a>
      <a
        className="quick-contact-card quick-phone"
        href={contact.phone ? `tel:${contact.phone.replace(/\s/g, "")}` : "/#contact"}
      >
        <Phone size={21} />
        <span><b>اتصل بنا</b><small dir={contact.phone ? "ltr" : undefined}>{contact.phone || "تواصل مع المكتب"}</small></span>
      </a>
    </nav>
  );
}

export function ContactLines() {
  const contact = useContact();
  return (
    <>
      {contact.phone && <p className="contact-line"><a href={`tel:${contact.phone.replace(/\s/g, "")}`} dir="ltr">{contact.phone}</a></p>}
      {contact.address && <p className="contact-line"><a href={mapLink(contact)} target="_blank" rel="noreferrer">{contact.address}</a></p>}
    </>
  );
}

export function PublicFooter() {
  const contact = useContact();
  return (
    <footer className="site-footer">
      <b>{office.slogan}</b>
      <span>جميع الحقوق محفوظة © {office.name} {new Date().getFullYear()} · <Link href="/login">دخول المكتب</Link></span>
      <div>
        {contact.whatsapp
          ? <a href={`https://wa.me/${whatsappNumber(contact.whatsapp)}`} target="_blank" rel="noreferrer" aria-label="واتساب"><MessageCircle size={18} /></a>
          : <Link href="/#contact" aria-label="واتساب"><MessageCircle size={18} /></Link>}
        {contact.phone
          ? <a href={`tel:${contact.phone}`} aria-label="اتصل بنا"><Phone size={18} /></a>
          : <Link href="/#contact" aria-label="اتصل بنا"><Phone size={18} /></Link>}
        <a href={mapLink(contact)} target="_blank" rel="noreferrer" aria-label="موقع المكتب"><MapPin size={18} /></a>
      </div>
    </footer>
  );
}
