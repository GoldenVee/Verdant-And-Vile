CREATE TABLE "solvent_aroma_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"solvent_id" text NOT NULL,
	"note" text NOT NULL,
	"position" "aroma_position" NOT NULL,
	CONSTRAINT "solvent_aroma_notes_solvent_id_note_position_unique" UNIQUE("solvent_id","note","position")
);
--> statement-breakpoint
ALTER TABLE "solvent_aroma_notes" ADD CONSTRAINT "solvent_aroma_notes_solvent_id_solvents_id_fk" FOREIGN KEY ("solvent_id") REFERENCES "public"."solvents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solvent_aroma_notes" ADD CONSTRAINT "solvent_aroma_notes_note_aroma_notes_slug_fk" FOREIGN KEY ("note") REFERENCES "public"."aroma_notes"("slug") ON DELETE no action ON UPDATE no action;