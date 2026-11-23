// Public office details. Phone, WhatsApp and address stay empty until the office supplies
// them; the footer buttons then fall back to the booking form rather than a made-up number.
export const office = {
  name: "مكتب ريزونكس للمحاماة والاستشارات القانونية",
  shortName: "ريزونكس",
  tagline: "للمحاماة والاستشارات القانونية",
  slogan: "معك .. نحو عدالة أرقى",
  city: "الأردن",
  phone: process.env.NEXT_PUBLIC_OFFICE_PHONE ?? "",
  whatsapp: process.env.NEXT_PUBLIC_OFFICE_WHATSAPP ?? "",
  address: process.env.NEXT_PUBLIC_OFFICE_ADDRESS ?? "",
};

export const services = [
  {
    slug: "civil-commercial",
    title: "القضايا المدنية والتجارية",
    short: "تمثيل قانوني احترافي في القضايا المدنية والتجارية بجميع أنواعها.",
    icon: "scale",
    intro: "نرافقك في النزاعات المدنية والتجارية من دراسة الملف حتى تنفيذ الحكم.",
    items: ["المطالبات المالية والعقود", "النزاعات التجارية بين الشركاء والشركات", "صياغة العقود ومراجعتها", "التنفيذ ومتابعة الأحكام"],
  },
  {
    slug: "criminal",
    title: "القضايا الجزائية",
    short: "دفاع قوي وحماية لحقوقك في القضايا الجزائية.",
    icon: "gavel",
    intro: "نحرص على حماية حقوقك في كل مراحل الدعوى الجزائية.",
    items: ["الحضور أثناء التحقيق", "الدفاع أمام المحاكم الجزائية", "طلبات التكفيل", "الطعن في الأحكام الجزائية"],
  },
  {
    slug: "personal-status",
    title: "الأحوال الشخصية",
    short: "حلول قانونية متكاملة في قضايا الأحوال الشخصية.",
    icon: "family",
    intro: "نتعامل مع قضايا الأسرة بخصوصية تامة وبما يحفظ حقوق جميع الأطراف.",
    items: ["الطلاق والتفريق", "النفقة والحضانة والمشاهدة", "التركات والميراث", "حجج الوصاية والولاية"],
  },
  {
    slug: "legal-consultations",
    title: "الاستشارات القانونية",
    short: "استشارات قانونية دقيقة من خبراء مختصين.",
    icon: "note",
    intro: "استشارة واضحة تساعدك على معرفة موقفك القانوني قبل أي خطوة.",
    items: ["استشارات للأفراد", "استشارات للشركات", "مراجعة المستندات والعقود", "تقييم الموقف القانوني للنزاع"],
  },
] as const;
