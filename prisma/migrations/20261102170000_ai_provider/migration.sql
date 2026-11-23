-- The AI key may belong to any provider; these record which one was detected when it was saved.
ALTER TABLE "OfficeSetting"
  ADD COLUMN "aiProvider" TEXT,
  ADD COLUMN "aiModel" TEXT;
