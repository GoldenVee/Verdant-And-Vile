-- Adding a NOT NULL column to a populated table needs a default for the existing rows,
-- otherwise the constraint is violated the moment the column appears. The default is then
-- dropped so the final schema matches the Drizzle definition, which declares no default.
-- The placeholder value is immaterial: db:seed replaces every solvent row.
ALTER TABLE "solvents" ADD COLUMN "taste_profile" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "solvents" ALTER COLUMN "taste_profile" DROP DEFAULT;
