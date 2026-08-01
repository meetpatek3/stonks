CREATE TYPE "public"."import_batch_status" AS ENUM('PREVIEW', 'COMMITTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."import_match_state" AS ENUM('NEW', 'DUPLICATE', 'CONFLICT');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('MATCH', 'MISMATCH');--> statement-breakpoint
CREATE TABLE "statement" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"stated_balance_minor" bigint NOT NULL,
	"stated_as_of" date NOT NULL,
	"source_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"status" "import_batch_status" NOT NULL,
	"source_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_candidate" (
	"id" text PRIMARY KEY NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"external_natural_key" text NOT NULL,
	"trade_date" date NOT NULL,
	"proposed_journal" jsonb NOT NULL,
	"match_state" "import_match_state" NOT NULL,
	"matched_journal_id" text
);
--> statement-breakpoint
CREATE TABLE "reconciliation_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" text NOT NULL,
	"computed_balance_minor" bigint NOT NULL,
	"stated_balance_minor" bigint NOT NULL,
	"status" "reconciliation_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "statement" ADD CONSTRAINT "statement_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_candidate" ADD CONSTRAINT "import_candidate_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_result" ADD CONSTRAINT "reconciliation_result_statement_id_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statement"("id") ON DELETE no action ON UPDATE no action;