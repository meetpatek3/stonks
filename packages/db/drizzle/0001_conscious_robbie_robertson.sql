CREATE TYPE "public"."day_count" AS ENUM('ACT_365', 'ACT_360', 'ACT_ACT');--> statement-breakpoint
CREATE TYPE "public"."posting_day_rule" AS ENUM('CALENDAR_DAY', 'MONTH_END');--> statement-breakpoint
CREATE TABLE "benchmark_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_rate_point" (
	"benchmark_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"rate_bps" integer NOT NULL,
	CONSTRAINT "benchmark_rate_point_benchmark_id_effective_date_pk" PRIMARY KEY("benchmark_id","effective_date")
);
--> statement-breakpoint
CREATE TABLE "credit_facility_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"benchmark_id" uuid NOT NULL,
	"spread_bps" integer NOT NULL,
	"day_count" "day_count" NOT NULL,
	"posting_day_rule" "posting_day_rule" NOT NULL,
	"capitalize_interest" boolean DEFAULT true NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "interest_model_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_account_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"modelled_minor" bigint NOT NULL,
	"actual_posted_minor" bigint NOT NULL,
	"variance_minor" bigint NOT NULL,
	"modelled_by_use" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "benchmark_rate_point" ADD CONSTRAINT "benchmark_rate_point_benchmark_id_benchmark_rate_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."benchmark_rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_facility_terms" ADD CONSTRAINT "credit_facility_terms_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_facility_terms" ADD CONSTRAINT "credit_facility_terms_benchmark_id_benchmark_rate_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."benchmark_rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_model_run" ADD CONSTRAINT "interest_model_run_facility_account_id_account_id_fk" FOREIGN KEY ("facility_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;