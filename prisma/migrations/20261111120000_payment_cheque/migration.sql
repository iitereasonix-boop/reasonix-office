-- Cheque details for payments made by cheque.
ALTER TABLE "Payment"
  ADD COLUMN "chequeNumber" TEXT,
  ADD COLUMN "chequeBank" TEXT,
  ADD COLUMN "chequeDrawer" TEXT,
  ADD COLUMN "chequeDueAt" TIMESTAMP(3);
