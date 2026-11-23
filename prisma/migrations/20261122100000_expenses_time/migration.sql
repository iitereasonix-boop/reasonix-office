-- Case expenses and logged work hours, both billable onto an invoice.
ALTER TABLE "Invoice" ADD COLUMN "extrasAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "CaseExpense" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "spentAt" TIMESTAMP(3) NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT,
  "billable" BOOLEAN NOT NULL DEFAULT true,
  "invoiceId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaseExpense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaseExpense_amount_check" CHECK ("amount" > 0)
);
CREATE INDEX "CaseExpense_caseId_spentAt_idx" ON "CaseExpense"("caseId", "spentAt");
CREATE INDEX "CaseExpense_invoiceId_idx" ON "CaseExpense"("invoiceId");
ALTER TABLE "CaseExpense" ADD CONSTRAINT "CaseExpense_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseExpense" ADD CONSTRAINT "CaseExpense_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CaseExpense" ADD CONSTRAINT "CaseExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TimeEntry" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "minutes" INTEGER NOT NULL,
  "workedAt" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "billable" BOOLEAN NOT NULL DEFAULT true,
  "invoiceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TimeEntry_minutes_check" CHECK ("minutes" > 0 AND "minutes" <= 1440)
);
CREATE INDEX "TimeEntry_caseId_workedAt_idx" ON "TimeEntry"("caseId", "workedAt");
CREATE INDEX "TimeEntry_userId_workedAt_idx" ON "TimeEntry"("userId", "workedAt");
CREATE INDEX "TimeEntry_invoiceId_idx" ON "TimeEntry"("invoiceId");
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LegalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CaseExpense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CaseExpense" FORCE ROW LEVEL SECURITY;
ALTER TABLE "TimeEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeEntry" FORCE ROW LEVEL SECURITY;

-- Expenses are office business: the senior lawyer and the secretary record them on cases
-- they can see. Billing (linking to an invoice) and removing a billed expense are senior only.
CREATE POLICY expense_read ON "CaseExpense" FOR SELECT USING (
  app_office() AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "CaseExpense"."caseId")
);
CREATE POLICY expense_create ON "CaseExpense" FOR INSERT WITH CHECK (
  app_office() AND "createdById" = app_user() AND "invoiceId" IS NULL
  AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "CaseExpense"."caseId")
);
CREATE POLICY expense_update ON "CaseExpense" FOR UPDATE
  USING (app_role() = 'SENIOR_LAWYER') WITH CHECK (app_role() = 'SENIOR_LAWYER');
CREATE POLICY expense_delete ON "CaseExpense" FOR DELETE USING (
  "invoiceId" IS NULL AND (app_role() = 'SENIOR_LAWYER' OR "createdById" = app_user())
);

-- Everyone logs their own hours on cases they can see; only the senior lawyer sees
-- everyone's hours and bills them.
CREATE POLICY time_read ON "TimeEntry" FOR SELECT USING (
  app_role() = 'SENIOR_LAWYER'
  OR ("userId" = app_user() AND app_staff() AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "TimeEntry"."caseId"))
);
CREATE POLICY time_create ON "TimeEntry" FOR INSERT WITH CHECK (
  app_staff() AND "userId" = app_user() AND "invoiceId" IS NULL
  AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "TimeEntry"."caseId")
);
CREATE POLICY time_update ON "TimeEntry" FOR UPDATE
  USING (app_role() = 'SENIOR_LAWYER') WITH CHECK (app_role() = 'SENIOR_LAWYER');
CREATE POLICY time_delete ON "TimeEntry" FOR DELETE USING (
  "invoiceId" IS NULL AND (app_role() = 'SENIOR_LAWYER' OR "userId" = app_user())
);
