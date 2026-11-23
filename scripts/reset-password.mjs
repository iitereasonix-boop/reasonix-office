// Resets a staff password from the server, for when no senior lawyer can sign in.
// Usage: npm run reset-password -- someone@office.com [new-password]
// Without a password, a random one is generated and printed once.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const [email, given] = process.argv.slice(2);
if (!email) {
  console.error("Usage: npm run reset-password -- someone@office.com [new-password]");
  process.exit(1);
}
if (given && given.length < 10) {
  console.error("The password must be at least 10 characters.");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || user.role === "CLIENT") throw new Error(`No staff account uses ${email}.`);
  const password = given ?? randomBytes(12).toString("base64url");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 12), active: true } });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  console.log(`Password reset for ${user.email}; every open session was signed out.`);
  if (!given) console.log(`New password: ${password}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
