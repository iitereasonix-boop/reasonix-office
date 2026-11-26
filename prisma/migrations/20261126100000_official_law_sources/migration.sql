ALTER TABLE "LegalSource"
ADD COLUMN "officialKey" TEXT,
ADD COLUMN "officialType" TEXT,
ADD COLUMN "officialStatus" TEXT,
ADD COLUMN "officialUrl" TEXT,
ADD COLUMN "officialNumber" INTEGER,
ADD COLUMN "officialYear" INTEGER,
ADD COLUMN "lastVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "LegalSource_officialKey_key" ON "LegalSource"("officialKey");
