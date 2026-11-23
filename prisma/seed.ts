import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.INITIAL_LAWYER_EMAIL;
  const password = process.env.INITIAL_LAWYER_PASSWORD;

  if (!email || !password || password.length < 12 || password === "replace-with-a-strong-password") {
    throw new Error("Set INITIAL_LAWYER_EMAIL and a password of at least 12 characters.");
  }

  const normalizedEmail = email.toLowerCase();
  await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {},
    create: {
      name: "ريزونكس",
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      role: Role.SENIOR_LAWYER,
      canViewNationalId: true,
      canViewPrivateNotes: true,
    },
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
