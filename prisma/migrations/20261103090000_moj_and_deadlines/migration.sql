-- Case numbers in the Ministry of Justice format.
ALTER TABLE "LegalCase"
  ADD COLUMN "mojCourt" TEXT,
  ADD COLUMN "mojJurisdiction" TEXT,
  ADD COLUMN "mojRegistry" TEXT,
  ADD COLUMN "mojNumber" TEXT,
  ADD COLUMN "mojYear" INTEGER;

-- How each rule treats holidays is the lawyer's choice; both stay off until set.
ALTER TABLE "DeadlineRule"
  ADD COLUMN "rollForward" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pauseInVacation" BOOLEAN NOT NULL DEFAULT false;

-- One reminder task per judgment deadline.
ALTER TABLE "Task" ADD COLUMN "judgmentId" TEXT;
CREATE UNIQUE INDEX "Task_judgmentId_key" ON "Task"("judgmentId");

CREATE TYPE "ClosureKind" AS ENUM ('HOLIDAY', 'JUDICIAL_VACATION');

CREATE TABLE "Holiday" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsOn" TEXT NOT NULL,
  "endsOn" TEXT NOT NULL,
  "kind" "ClosureKind" NOT NULL DEFAULT 'HOLIDAY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Holiday_startsOn_idx" ON "Holiday"("startsOn");

ALTER TABLE "Holiday" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Holiday" FORCE ROW LEVEL SECURITY;
CREATE POLICY holiday_read ON "Holiday" FOR SELECT USING (app_staff());
CREATE POLICY holiday_write ON "Holiday" FOR ALL USING (app_role() = 'SENIOR_LAWYER') WITH CHECK (app_role() = 'SENIOR_LAWYER');
