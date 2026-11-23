-- Public contact details and the AI key, managed from settings. The key is stored sealed.
ALTER TABLE "OfficeSetting"
  ADD COLUMN "officeWhatsapp" TEXT,
  ADD COLUMN "officeAddress" TEXT,
  ADD COLUMN "officeLat" DOUBLE PRECISION,
  ADD COLUMN "officeLng" DOUBLE PRECISION,
  ADD COLUMN "aiApiKey" TEXT;
