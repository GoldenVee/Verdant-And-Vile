CREATE TYPE "public"."aroma_position" AS ENUM('top', 'heart', 'base');--> statement-breakpoint
CREATE TYPE "public"."category" AS ENUM('botanical', 'mineral', 'fungal', 'fauna-derived', 'alchemical', 'pneuma', 'effluvia', 'aberrant', 'cosmic');--> statement-breakpoint
CREATE TYPE "public"."compound_kind" AS ENUM('real', 'fictional');--> statement-breakpoint
CREATE TYPE "public"."dose_response" AS ENUM('linear', 'hormetic', 'threshold', 'ceiling');--> statement-breakpoint
CREATE TYPE "public"."heat_default" AS ENUM('cold', 'warm', 'hot');--> statement-breakpoint
CREATE TYPE "public"."heat_response" AS ENUM('requires-heat', 'destroyed-by-heat', 'enhanced-by-heat', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."luminosity" AS ENUM('dull', 'glossy', 'phosphorescent', 'light-swallowing');--> statement-breakpoint
CREATE TYPE "public"."motion_tendency" AS ENUM('still', 'settling', 'rising', 'swirling', 'pulsing', 'churning', 'effervescent', 'seeking', 'layered', 'restless');--> statement-breakpoint
CREATE TYPE "public"."origin" AS ENUM('real', 'fictional');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('potion', 'concentrate', 'reduction', 'liniment', 'balm', 'aromatic', 'sachet', 'vapors', 'pellet', 'paste', 'powder-balls', 'veil', 'eye-drops');--> statement-breakpoint
CREATE TYPE "public"."physical_form" AS ENUM('liquid', 'solid');--> statement-breakpoint
CREATE TYPE "public"."polarity" AS ENUM('polar', 'nonpolar', 'acid-soluble', 'universal', 'anti-solvent');--> statement-breakpoint
CREATE TYPE "public"."solubility" AS ENUM('polar', 'nonpolar', 'acid-soluble', 'universal', 'insoluble');--> statement-breakpoint
CREATE TYPE "public"."synergy_pair_type" AS ENUM('always_antagonistic', 'always_complementary', 'scaled');--> statement-breakpoint
CREATE TYPE "public"."tag_role" AS ENUM('synergy', 'antagonist');--> statement-breakpoint
CREATE TYPE "public"."temperature_feel" AS ENUM('cold', 'neutral', 'warming', 'burning');--> statement-breakpoint
CREATE TYPE "public"."toxicity_level" AS ENUM('none', 'low', 'medium', 'high', 'lethal');--> statement-breakpoint
CREATE TYPE "public"."trait" AS ENUM('echoic', 'volatile', 'catalyst', 'indestructible', 'mercurial', 'shy', 'carrier', 'quiescent', 'decaying', 'explosive');--> statement-breakpoint
CREATE TABLE "aroma_notes" (
	"slug" text PRIMARY KEY NOT NULL,
	"family" text
);
--> statement-breakpoint
CREATE TABLE "compound_classes" (
	"slug" text PRIMARY KEY NOT NULL,
	"kind" "compound_kind" NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "effect_subtractive_equivalents" (
	"standard_effect" text PRIMARY KEY NOT NULL,
	"subtractive_equivalent" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient_aroma_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"ingredient_id" text NOT NULL,
	"note" text NOT NULL,
	"position" "aroma_position" NOT NULL,
	CONSTRAINT "ingredient_aroma_notes_ingredient_id_note_position_unique" UNIQUE("ingredient_id","note","position")
);
--> statement-breakpoint
CREATE TABLE "ingredient_compounds" (
	"ingredient_id" text NOT NULL,
	"compound_class" text NOT NULL,
	"concentration" real NOT NULL,
	CONSTRAINT "ingredient_compounds_ingredient_id_compound_class_pk" PRIMARY KEY("ingredient_id","compound_class")
);
--> statement-breakpoint
CREATE TABLE "ingredient_tags" (
	"ingredient_id" text NOT NULL,
	"tag" text NOT NULL,
	"role" "tag_role" NOT NULL,
	CONSTRAINT "ingredient_tags_ingredient_id_tag_role_pk" PRIMARY KEY("ingredient_id","tag","role")
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"lore" text NOT NULL,
	"origin" "origin" NOT NULL,
	"scientific_name" text,
	"appearance_text" text NOT NULL,
	"appearance_img" text,
	"type" text NOT NULL,
	"category" "category" NOT NULL,
	"related_family" text,
	"traits" "trait"[] DEFAULT '{}' NOT NULL,
	"solubility" "solubility" NOT NULL,
	"ph_contribution" integer,
	"toxicity_base" "toxicity_level" NOT NULL,
	"stability_base" integer NOT NULL,
	"extraction_yield" real NOT NULL,
	"potency_base" integer NOT NULL,
	"dose_response" "dose_response" NOT NULL,
	"hormetic_threshold" real,
	"activation_threshold" real,
	"ceiling_value" real,
	"heat_response" "heat_response" NOT NULL,
	"color_base" text NOT NULL,
	"color_secondary" text,
	"taste_profile" jsonb NOT NULL,
	"texture" jsonb NOT NULL,
	"sound" text,
	"temperature_feel" "temperature_feel" NOT NULL,
	"luminosity" "luminosity" NOT NULL,
	"motion_tendency" "motion_tendency" NOT NULL,
	"aesthetic_weight" real NOT NULL,
	CONSTRAINT "ingredients_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "solvents" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"lore" text,
	"polarity" "polarity" NOT NULL,
	"base_ph" real,
	"compatible_outcomes" "outcome"[] NOT NULL,
	"stability_modifier" real NOT NULL,
	"heat_default" "heat_default" NOT NULL,
	"aesthetic_base" jsonb NOT NULL,
	"category_affinity" jsonb NOT NULL,
	"category_resistance" jsonb NOT NULL,
	"signature_transformation" jsonb,
	"physical_form" "physical_form" NOT NULL,
	CONSTRAINT "solvents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "synergy_pairs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag_a" text NOT NULL,
	"tag_b" text NOT NULL,
	"type" "synergy_pair_type" NOT NULL,
	"boost" real,
	"severity" real,
	"complementary_ceiling" real,
	"balanced_ceiling" real,
	"straining_ceiling" real,
	"warning_template" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_definitions" (
	"slug" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"targets" text[],
	"targets_any_compound" boolean DEFAULT false NOT NULL,
	"effect_targets" text[],
	"boost" real,
	"severity" real,
	"opposite_tag" text
);
--> statement-breakpoint
ALTER TABLE "ingredient_aroma_notes" ADD CONSTRAINT "ingredient_aroma_notes_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_aroma_notes" ADD CONSTRAINT "ingredient_aroma_notes_note_aroma_notes_slug_fk" FOREIGN KEY ("note") REFERENCES "public"."aroma_notes"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_compounds" ADD CONSTRAINT "ingredient_compounds_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_compounds" ADD CONSTRAINT "ingredient_compounds_compound_class_compound_classes_slug_fk" FOREIGN KEY ("compound_class") REFERENCES "public"."compound_classes"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_tags" ADD CONSTRAINT "ingredient_tags_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_tags" ADD CONSTRAINT "ingredient_tags_tag_tag_definitions_slug_fk" FOREIGN KEY ("tag") REFERENCES "public"."tag_definitions"("slug") ON DELETE no action ON UPDATE no action;