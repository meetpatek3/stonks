CREATE TABLE "api_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_token_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_token_scope_check" CHECK ("api_token"."scope" in ('read', 'read_write'))
);
--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_token_household_idx" ON "api_token" USING btree ("household_id");