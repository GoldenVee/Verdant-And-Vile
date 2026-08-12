CREATE TYPE "public"."effect_domain" AS ENUM('memory', 'emotion', 'identity', 'sight', 'sound', 'perception', 'sensation', 'time', 'other');--> statement-breakpoint
CREATE TABLE "effect_definitions" (
	"type" text PRIMARY KEY NOT NULL,
	"domain" "effect_domain" NOT NULL,
	"default_descriptor" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "synergy_pairs" ADD COLUMN "unlocks_effect" text;--> statement-breakpoint
ALTER TABLE "tag_definitions" ADD COLUMN "produces_effect" text;