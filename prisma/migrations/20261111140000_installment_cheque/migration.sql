-- How each planned installment will be paid; post-dated cheques are recorded up front.
ALTER TABLE "InvoiceInstallment"
  ADD COLUMN "method" TEXT,
  ADD COLUMN "chequeNumber" TEXT,
  ADD COLUMN "chequeBank" TEXT,
  ADD COLUMN "chequeDrawer" TEXT;
