CREATE TYPE "public"."cost_basis_method" AS ENUM('ACB', 'FIFO');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('INVESTMENT', 'CREDIT_FACILITY', 'RECEIVABLE', 'CASH', 'EXTERNAL');--> statement-breakpoint
CREATE TYPE "public"."journal_source" AS ENUM('MANUAL', 'IMPORT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."journal_status" AS ENUM('POSTED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."journal_type" AS ENUM('BUY', 'SELL', 'DIVIDEND', 'INTEREST_CHARGED', 'INTEREST_EARNED', 'FEE', 'TRANSFER', 'DEPOSIT', 'WITHDRAWAL', 'CORPORATE_ACTION', 'OPENING');--> statement-breakpoint
CREATE TYPE "public"."facility_use" AS ENUM('INVESTMENT', 'LENDING', 'PERSONAL', 'OTHER');--> statement-breakpoint
CREATE TABLE "currency" (
	"code" text PRIMARY KEY NOT NULL,
	"minor_units" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporting_currency" text NOT NULL,
	"default_cost_basis_method" "cost_basis_method" DEFAULT 'ACB' NOT NULL,
	"auth_password_hash" text,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"type" "account_type" NOT NULL,
	"currency" text NOT NULL,
	"tax_treatment" text,
	"name" text NOT NULL,
	"contribution_policy_id" uuid,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "journal" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"type" "journal_type" NOT NULL,
	"trade_date" date NOT NULL,
	"sort_key" integer NOT NULL,
	"memo" text,
	"external_natural_key" text,
	"source" "journal_source" NOT NULL,
	"status" "journal_status" NOT NULL,
	"supersedes_journal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" text NOT NULL,
	"account_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"quantity" numeric(28, 8),
	"security_id" text,
	"trade_currency" text,
	"reporting_amount_minor" bigint,
	"fx_rate_n" bigint,
	"fx_rate_d" bigint
);
--> statement-breakpoint
CREATE TABLE "journal_facility_use" (
	"journal_id" text NOT NULL,
	"use" "facility_use" NOT NULL,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "journal_facility_use_journal_id_use_pk" PRIMARY KEY("journal_id","use")
);
--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_reporting_currency_currency_code_fk" FOREIGN KEY ("reporting_currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting" ADD CONSTRAINT "posting_journal_id_journal_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting" ADD CONSTRAINT "posting_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting" ADD CONSTRAINT "posting_trade_currency_currency_code_fk" FOREIGN KEY ("trade_currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_facility_use" ADD CONSTRAINT "journal_facility_use_journal_id_journal_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_household_trade_date_sort_key_posted_idx" ON "journal" USING btree ("household_id","trade_date","sort_key") WHERE "journal"."status" = 'POSTED';