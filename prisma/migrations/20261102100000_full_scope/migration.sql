-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('HEARING_TWO_DAYS', 'HEARING_MORNING', 'JUDGMENT_ISSUED', 'APPEAL_DEADLINE');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('PLEADING', 'EVIDENCE', 'COURT_ORDER', 'CONTRACT', 'POWER_OF_ATTORNEY', 'CORRESPONDENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "UpdateKind" AS ENUM ('ADJOURNMENT', 'EXPERT_REQUEST', 'NOTIFICATION', 'DECISION', 'OTHER');

-- CreateEnum
CREATE TYPE "DeadlineBase" AS ENUM ('DECISION', 'NOTIFICATION');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('SUGGESTED', 'NEEDS_REVIEW', 'ACCEPTED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_clientId_fkey";

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "whatsappOptOutAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "rootId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Judgment" ADD COLUMN     "appealFiledAt" TIMESTAMP(3),
ADD COLUMN     "deadlineConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "deadlineConfirmedBy" TEXT,
ADD COLUMN     "deadlineRule" JSONB,
ADD COLUMN     "judgmentNumber" TEXT,
ADD COLUMN     "notifiedAt" TIMESTAMP(3),
ADD COLUMN     "proposedDeadline" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "deliveryStatus" TEXT,
ADD COLUMN     "direction" "MessageDirection" NOT NULL DEFAULT 'OUTBOUND',
ADD COLUMN     "failure" TEXT,
ADD COLUMN     "fromPhone" TEXT,
ADD COLUMN     "reminderKind" "ReminderKind",
ADD COLUMN     "scheduledFor" TIMESTAMP(3),
ADD COLUMN     "templateParams" TEXT[],
ADD COLUMN     "waMessageId" TEXT,
ALTER COLUMN "clientId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "calendarToken" TEXT;

-- CreateTable
CREATE TABLE "CaseUpdate" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "UpdateKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,
    "nextHearingAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiEnabledBy" TEXT,
    "aiEnabledAt" TIMESTAMP(3),
    "quietStart" INTEGER NOT NULL DEFAULT 9,
    "quietEnd" INTEGER NOT NULL DEFAULT 20,
    "staleDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadlineRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "caseType" "CaseType",
    "court" "CourtLevel",
    "days" INTEGER NOT NULL,
    "base" "DeadlineBase" NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DeadlineRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metaName" TEXT,
    "language" TEXT NOT NULL DEFAULT 'ar',
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "autoSendBy" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caseId" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeItem" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "extracted" JSONB,
    "matchedClientId" TEXT,
    "matchScore" DOUBLE PRECISION,
    "status" "IntakeStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "reviewNote" TEXT,
    "caseId" TEXT,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalSource" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LegalSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalArticle" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,

    CONSTRAINT "LegalArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DraftKind" NOT NULL DEFAULT 'OTHER',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOtp" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseUpdate_caseId_occurredAt_idx" ON "CaseUpdate"("caseId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_kind_key" ON "MessageTemplate"("kind");

-- CreateIndex
CREATE INDEX "AgentRun_agent_createdAt_idx" ON "AgentRun"("agent", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeItem_status_createdAt_idx" ON "IntakeItem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LegalArticle_sourceId_idx" ON "LegalArticle"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_caseId_idx" ON "Invoice"("caseId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "ClientOtp_phone_createdAt_idx" ON "ClientOtp"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "Document_rootId_idx" ON "Document"("rootId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_dedupeKey_key" ON "Message"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Message_waMessageId_key" ON "Message"("waMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "User_calendarToken_key" ON "User"("calendarToken");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseUpdate" ADD CONSTRAINT "CaseUpdate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseUpdate" ADD CONSTRAINT "CaseUpdate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalArticle" ADD CONSTRAINT "LegalArticle_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LegalSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AI stays off until the senior lawyer enables it in settings.
INSERT INTO "OfficeSetting" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP);

-- Automatic sending stays off for every template until the lawyer enables it.
-- {{1}} client, {{2}} case number, {{3}} date. TODO(review): the office approves this wording.
INSERT INTO "MessageTemplate" ("id", "kind", "name", "body", "updatedAt") VALUES
  ('tpl_hearing_2d', 'HEARING_TWO_DAYS', 'تذكير قبل الجلسة بيومين', 'السيد/ة {{1}} المحترم/ة، نذكّركم بجلسة القضية رقم {{2}} بتاريخ {{3}}.', CURRENT_TIMESTAMP),
  ('tpl_hearing_am', 'HEARING_MORNING', 'تذكير صباح يوم الجلسة', 'السيد/ة {{1}} المحترم/ة، جلسة القضية رقم {{2}} اليوم {{3}}.', CURRENT_TIMESTAMP),
  ('tpl_judgment', 'JUDGMENT_ISSUED', 'بعد صدور الحكم', 'السيد/ة {{1}} المحترم/ة، صدر حكم في القضية رقم {{2}} بتاريخ {{3}}. يرجى التواصل مع المكتب.', CURRENT_TIMESTAMP),
  ('tpl_appeal', 'APPEAL_DEADLINE', 'قبل آخر موعد للطعن', 'السيد/ة {{1}} المحترم/ة، نلفت انتباهكم إلى الموعد المسجل في القضية رقم {{2}} بتاريخ {{3}}. يرجى التواصل مع المكتب.', CURRENT_TIMESTAMP);

-- TODO(review): skeletons only; the office replaces them with its approved wording.
INSERT INTO "DocumentTemplate" ("id", "name", "kind", "body", "updatedAt") VALUES
  ('doc_poa', 'وكالة', 'OTHER', E'وكالة\n\nأنا الموقع أدناه {{client_name}}، الرقم الوطني: ____\nأوكل المحامي {{lawyer_name}}\nفي القضية رقم {{case_number}} لدى محكمة {{court}}.\n\n[يكمل المحامي صيغة الوكالة المعتمدة]\n\nالتاريخ: {{today}}', CURRENT_TIMESTAMP),
  ('doc_claim', 'لائحة دعوى', 'MEMO', E'لدى محكمة {{court}} الموقرة\n\nالمدعي: {{client_name}}\nوكيله المحامي: {{lawyer_name}}\nالمدعى عليه: {{opposing_parties}}\nموضوع الدعوى: {{case_title}}\n\nالوقائع:\n1. ____\n\nالأسانيد القانونية:\n[يضيفها المحامي]\n\nالطلبات:\n1. ____\n\nالتاريخ: {{today}}', CURRENT_TIMESTAMP),
  ('doc_memo', 'مذكرة', 'MEMO', E'مذكرة في القضية رقم {{case_number}}\nلدى محكمة {{court}}\n\nمقدمة من: {{client_name}} بواسطة وكيله المحامي {{lawyer_name}}\nضد: {{opposing_parties}}\n\nأولاً: الوقائع\n____\n\nثانياً: الدفوع\n____\n\nالتاريخ: {{today}}', CURRENT_TIMESTAMP);

-- Row level security for the new tables, and client-portal access to cases.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['CaseUpdate', 'OfficeSetting', 'DeadlineRule', 'MessageTemplate', 'AgentRun', 'IntakeItem',
    'LegalSource', 'LegalArticle', 'Invoice', 'Payment', 'DocumentTemplate', 'ClientOtp']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

CREATE FUNCTION app_client() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('app.client_id', true) $$;
CREATE FUNCTION app_staff() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_role() IN ('SENIOR_LAWYER', 'TRAINEE_LAWYER', 'SECRETARY') $$;
CREATE FUNCTION app_office() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_role() IN ('SENIOR_LAWYER', 'SECRETARY') $$;

-- A client reaches a case through the id the server resolved at login, so this
-- policy never queries "Client" and cannot recurse with client_read.
DROP POLICY case_read ON "LegalCase";
CREATE POLICY case_read ON "LegalCase" FOR SELECT USING (
  app_office()
  OR (app_role() = 'TRAINEE_LAWYER' AND app_user() IN ("assignedLawyerId", "traineeLawyerId"))
  OR (app_role() = 'CLIENT' AND "clientId" = app_client())
);

-- Clients see their case status and hearings only.
DROP POLICY document_read ON "Document";
CREATE POLICY document_read ON "Document" FOR SELECT USING (
  app_staff() AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "Document"."caseId")
);
DROP POLICY judgment_read ON "Judgment";
CREATE POLICY judgment_read ON "Judgment" FOR SELECT USING (
  app_staff() AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "Judgment"."caseId")
);
DROP POLICY draft_read ON "LegalDraft";
CREATE POLICY draft_read ON "LegalDraft" FOR SELECT USING (
  app_staff() AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "LegalDraft"."caseId")
);
DROP POLICY message_read ON "Message";
CREATE POLICY message_read ON "Message" FOR SELECT USING (
  app_office()
  OR (app_role() = 'TRAINEE_LAWYER' AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc."clientId" = "Message"."clientId"))
);
DROP POLICY message_create ON "Message";
CREATE POLICY message_create ON "Message" FOR INSERT WITH CHECK (
  (app_staff() AND "status" = 'DRAFT' AND "direction" = 'OUTBOUND')
  OR (app_role() = 'SENIOR_LAWYER' AND "direction" = 'INBOUND')
);

-- Staff read the timeline of a case they can open; the rest of the log stays with the senior lawyer.
DROP POLICY audit_read ON "AuditLog";
CREATE POLICY audit_read ON "AuditLog" FOR SELECT USING (
  app_role() = 'SENIOR_LAWYER' OR "userId" = app_user()
  OR (app_staff() AND "caseId" IS NOT NULL AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "AuditLog"."caseId"))
);

CREATE POLICY case_update_read ON "CaseUpdate" FOR SELECT USING (
  app_staff() AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "CaseUpdate"."caseId")
);
CREATE POLICY case_update_create ON "CaseUpdate" FOR INSERT WITH CHECK (
  app_office() AND "createdById" = app_user()
);

CREATE POLICY setting_read ON "OfficeSetting" FOR SELECT USING (app_staff());
CREATE POLICY setting_write ON "OfficeSetting" FOR UPDATE USING (app_role() = 'SENIOR_LAWYER');

CREATE POLICY rule_read ON "DeadlineRule" FOR SELECT USING (app_staff());
CREATE POLICY rule_write ON "DeadlineRule" FOR ALL USING (app_role() = 'SENIOR_LAWYER') WITH CHECK (app_role() = 'SENIOR_LAWYER');

CREATE POLICY template_read ON "MessageTemplate" FOR SELECT USING (app_staff());
CREATE POLICY template_write ON "MessageTemplate" FOR UPDATE USING (app_role() = 'SENIOR_LAWYER');

CREATE POLICY agent_insert ON "AgentRun" FOR INSERT WITH CHECK ("userId" = app_user());
CREATE POLICY agent_read ON "AgentRun" FOR SELECT USING (app_role() = 'SENIOR_LAWYER' OR "userId" = app_user());

CREATE POLICY intake_all ON "IntakeItem" FOR ALL USING (app_office()) WITH CHECK (app_office());

CREATE POLICY legal_source_read ON "LegalSource" FOR SELECT USING (app_staff());
CREATE POLICY legal_source_write ON "LegalSource" FOR ALL USING (app_role() = 'SENIOR_LAWYER') WITH CHECK (app_role() = 'SENIOR_LAWYER');
CREATE POLICY legal_article_read ON "LegalArticle" FOR SELECT USING (app_staff());
CREATE POLICY legal_article_write ON "LegalArticle" FOR ALL USING (app_role() = 'SENIOR_LAWYER') WITH CHECK (app_role() = 'SENIOR_LAWYER');

CREATE POLICY invoice_senior ON "Invoice" FOR ALL USING (app_role() = 'SENIOR_LAWYER') WITH CHECK (app_role() = 'SENIOR_LAWYER');
CREATE POLICY payment_senior ON "Payment" FOR ALL USING (app_role() = 'SENIOR_LAWYER') WITH CHECK (app_role() = 'SENIOR_LAWYER');

CREATE POLICY doc_template_read ON "DocumentTemplate" FOR SELECT USING (app_staff());
CREATE POLICY doc_template_write ON "DocumentTemplate" FOR ALL USING (app_role() = 'SENIOR_LAWYER') WITH CHECK (app_role() = 'SENIOR_LAWYER');

-- One-time codes are handled by the server's system identity only.
CREATE POLICY otp_system ON "ClientOtp" FOR ALL USING (app_role() = 'SENIOR_LAWYER') WITH CHECK (app_role() = 'SENIOR_LAWYER');

CREATE TRIGGER agent_run_no_update_delete
BEFORE UPDATE OR DELETE ON "AgentRun"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

