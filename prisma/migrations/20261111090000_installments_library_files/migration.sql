-- Invoices paid in installments, each with its own due date.
CREATE TABLE "InvoiceInstallment" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceInstallment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InvoiceInstallment_invoiceId_dueAt_idx" ON "InvoiceInstallment"("invoiceId", "dueAt");
ALTER TABLE "InvoiceInstallment" ADD CONSTRAINT "InvoiceInstallment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceInstallment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceInstallment" FORCE ROW LEVEL SECURITY;
CREATE POLICY installment_senior ON "InvoiceInstallment" FOR ALL USING (app_role() = 'SENIOR_LAWYER') WITH CHECK (app_role() = 'SENIOR_LAWYER');

-- The original file behind a law in the library, kept for download.
ALTER TABLE "LegalSource"
  ADD COLUMN "fileName" TEXT,
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "size" INTEGER,
  ADD COLUMN "content" BYTEA;
