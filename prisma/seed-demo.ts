// Fictional sample office for trying the system. Never run this against real data.
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { normalizeArabic } from "../src/lib/text";

const prisma = new PrismaClient();
const at = (date: string, time = "09:30") => new Date(`${date}T${time}:00+03:00`);

const orderText = [
  `المملكة الأردنية الهاشمية
محكمة بداية عمان
القضية الحقوقية رقم 2026/124

قرار

المدعي: أحمد محمد علي
المدعى عليها: شركة النور للمقاولات

في الجلسة المنعقدة بتاريخ 2026/10/28 طلب وكيل المدعى عليها إمهاله لتقديم بيناته الخطية، ولم يعترض وكيل المدعي.
قررت المحكمة إجابة الطلب وتأجيل الجلسة إلى يوم الأربعاء الموافق 2026/11/18 الساعة التاسعة والنصف صباحاً، وتكليف المدعى عليها بتقديم بيناتها الخطية قبل الموعد.`,
  `كما قررت المحكمة تكليف وكيل المدعي بتقديم كشف مفصل بالمبالغ المطالب بها مؤيداً بالفواتير، وإحضار الشاهد المسمى في قائمة بيناته في الجلسة القادمة.

قراراً قابلاً للمراجعة وفق الأصول.`,
].join("\f");

const contractText = `عقد مقاولة
رقم العقد: 2025/77

الفريق الأول: أحمد محمد علي
الفريق الثاني: شركة النور للمقاولات

المادة 1: يلتزم الفريق الثاني بتنفيذ أعمال تشطيب المبنى المملوك للفريق الأول في عمان.
المادة 2: بدل العقد الإجمالي 48,000 دينار أردني، يدفع منه 20,000 دينار عند التوقيع والباقي على دفعات حسب الإنجاز.
المادة 3: مدة التنفيذ ستة أشهر من تاريخ استلام الموقع، ويترتب على كل أسبوع تأخير غرامة قدرها 300 دينار.\fالمادة 4: تحال أي خلافات تنشأ عن هذا العقد إلى محاكم عمان المختصة.
المادة 5: حُرر هذا العقد من نسختين بيد كل فريق نسخة للعمل بموجبها.`;

const claimText = `لائحة دعوى

المدعي: أحمد محمد علي
المدعى عليها: شركة النور للمقاولات
موضوع الدعوى: المطالبة بمبلغ 18,500 دينار أردني

الوقائع:
1. تعاقد المدعي مع المدعى عليها على تشطيب مبنى بموجب العقد رقم 2025/77.
2. تأخرت المدعى عليها في التسليم أحد عشر أسبوعاً عن المدة المتفق عليها.
3. أخلت المدعى عليها ببعض الأعمال، مما اضطر المدعي إلى إنجازها على نفقته بكلفة 15,200 دينار.
4. يطالب المدعي بغرامة التأخير البالغة 3,300 دينار إضافة إلى كلفة الإصلاح.`;

async function main() {
  const email = process.env.INITIAL_LAWYER_EMAIL;
  const password = process.env.INITIAL_LAWYER_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error("Set INITIAL_LAWYER_EMAIL and INITIAL_LAWYER_PASSWORD first.");
  const passwordHash = await bcrypt.hash(password, 12);

  const makeUser = (name: string, address: string, role: Role, sees: boolean) =>
    prisma.user.upsert({
      where: { email: address },
      update: {},
      create: { name, email: address, passwordHash, role, canViewNationalId: sees, canViewPrivateNotes: sees },
    });
  const senior = await makeUser("نديم الصفدي", email.toLowerCase(), Role.SENIOR_LAWYER, true);
  const trainee = await makeUser("سارة خالد", "trainee@reasonix.local", Role.TRAINEE_LAWYER, false);
  const secretary = await makeUser("ليلى حسن", "secretary@reasonix.local", Role.SECRETARY, false);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${senior.id}, true), set_config('app.user_role', 'SENIOR_LAWYER', true)`;
    if (await tx.legalCase.count()) throw new Error("Database already has cases; demo data was not added.");

    const ahmad = await tx.client.create({ data: { name: "أحمد محمد علي", phone: "+962790000001", nationalId: "9000000001", address: "عمان، الجبيهة" } });
    const amal = await tx.client.create({ data: { name: "شركة الأمل", phone: "+962790000002", address: "عمان، العبدلي" } });
    const khaled = await tx.client.create({ data: { name: "خالد يوسف", phone: "+962790000003", address: "الزرقاء" } });
    const huda = await tx.client.create({ data: { name: "هدى إبراهيم", phone: "+962790000004", address: "إربد" } });

    const civil = await tx.legalCase.create({
      data: {
        caseNumber: "2026/124", title: "مطالبة مالية عن عقد مقاولة", type: "CIVIL", court: "FIRST_INSTANCE", courtCity: "عمان", status: "IN_PROGRESS",
        summary: "مطالبة بمبلغ 18,500 دينار عن تأخر وإخلال في عقد تشطيب.", opposingParties: ["شركة النور للمقاولات"],
        clientId: ahmad.id, assignedLawyerId: senior.id, traineeLawyerId: trainee.id, fees: 1500,
        privateNotes: "العميل يفضل التسوية إن تجاوز العرض 15,000 دينار.",
      },
    });
    const commercial = await tx.legalCase.create({
      data: { caseNumber: "2026/125", title: "نزاع توريد تجاري", type: "COMMERCIAL", court: "APPEAL", courtCity: "عمان", status: "IN_PROGRESS", clientId: amal.id, assignedLawyerId: senior.id, opposingParties: ["مؤسسة الصفا للتوريدات"] },
    });
    const magistrate = await tx.legalCase.create({
      data: { caseNumber: "2026/126", title: "مطالبة أجور", type: "CIVIL", court: "MAGISTRATES", courtCity: "الزرقاء", status: "OPEN", clientId: khaled.id, assignedLawyerId: senior.id },
    });
    const family = await tx.legalCase.create({
      data: { caseNumber: "2026/098", title: "نفقة وحضانة", type: "PERSONAL_STATUS", court: "FIRST_INSTANCE", courtCity: "إربد", status: "IN_PROGRESS", clientId: huda.id, assignedLawyerId: senior.id },
    });
    const criminal = await tx.legalCase.create({
      data: { caseNumber: "2026/061", title: "دفاع في قضية إساءة ائتمان", type: "CRIMINAL", court: "FIRST_INSTANCE", courtCity: "عمان", status: "ON_HOLD", clientId: khaled.id, assignedLawyerId: senior.id },
    });

    const now = new Date();
    const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
    await tx.hearing.createMany({
      data: [
        { caseId: civil.id, startsAt: at("2026-09-16"), purpose: "افتتاح المحاكمة", decision: "تقديم البينات وتأجيل الجلسة.", nextStartsAt: at("2026-10-28") },
        { caseId: civil.id, startsAt: at("2026-10-28"), purpose: "مرافعة", decision: "تأجيل الجلسة لتقديم البينات الخطية للمدعى عليها.", nextStartsAt: at("2026-11-18"), courtroom: "القاعة 4" },
        { caseId: civil.id, startsAt: at("2026-11-18"), purpose: "مرافعة وسماع شاهد", courtroom: "القاعة 4" },
        { caseId: commercial.id, startsAt: at(today, "11:00"), purpose: "مرافعة" },
        { caseId: magistrate.id, startsAt: at(today, "13:00"), purpose: "جلسة متابعة" },
        { caseId: family.id, startsAt: at("2026-11-09", "10:00"), purpose: "سماع البينة" },
      ],
    });
    await tx.judgment.create({
      data: { caseId: family.id, title: "حكم النفقة المؤقتة", court: "بداية إربد", decidedAt: at("2026-10-20"), summary: "فرض نفقة مؤقتة شهرية لحين الفصل في الدعوى.", appealDeadline: at("2026-11-10") },
    });

    const addDocument = async (caseId: string, title: string, text: string) => {
      const pages = text.split("\f");
      const content = Buffer.from(text);
      const document = await tx.document.create({
        data: { caseId, title, fileName: `${title}.txt`, mimeType: "text/plain", size: content.length, content, pageCount: pages.length, uploadedById: senior.id },
      });
      await tx.documentPage.createMany({
        data: pages.map((page, index) => ({ documentId: document.id, page: index + 1, text: page.trim(), searchText: normalizeArabic(page) })),
      });
      return document;
    };
    await addDocument(civil.id, "قرار المحكمة", orderText);
    await addDocument(civil.id, "عقد المقاولة", contractText);
    await addDocument(civil.id, "لائحة الدعوى", claimText);

    await tx.task.createMany({
      data: [
        { title: "تجهيز كشف المبالغ مع الفواتير", caseId: civil.id, assigneeId: trainee.id, dueAt: at("2026-11-12"), priority: "HIGH" },
        { title: "التواصل مع الشاهد وتأكيد حضوره", caseId: civil.id, assigneeId: secretary.id, dueAt: at("2026-11-15") },
        { title: "مراجعة حكم النفقة المؤقتة", caseId: family.id, assigneeId: senior.id, dueAt: at("2026-11-05"), priority: "HIGH" },
      ],
    });
    await tx.message.create({ data: { clientId: ahmad.id, caseId: civil.id, body: "السيد أحمد المحترم، نذكركم بجلسة القضية رقم 2026/124 بتاريخ 2026/11/18 الساعة 9:30 صباحاً." } });
    await tx.consultationRequest.createMany({
      data: [{ name: "رامي سليم", phone: "+962790000009", topic: "القضايا المدنية والتجارية", message: "أرغب باستشارة حول عقد إيجار تجاري." }],
    });
    await tx.auditLog.create({ data: { userId: senior.id, action: "CASE_CREATED", entityType: "LegalCase", entityId: criminal.id, caseId: criminal.id } });
  }, { timeout: 30_000 });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
