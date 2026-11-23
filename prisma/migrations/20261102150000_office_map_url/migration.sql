-- The office location is now a pasted Google Maps link instead of a picked point.
ALTER TABLE "OfficeSetting"
  ADD COLUMN "officeMapUrl" TEXT,
  DROP COLUMN "officeLat",
  DROP COLUMN "officeLng";
