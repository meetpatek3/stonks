CREATE TYPE "public"."security_type" AS ENUM('EQUITY', 'ETF', 'MUTUAL_FUND', 'BOND', 'OTHER');--> statement-breakpoint
CREATE TABLE "security" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "security_type" NOT NULL,
	"currency" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_symbol" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" text NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "price_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"security_id" text NOT NULL,
	"as_of" date NOT NULL,
	"price_minor" bigint NOT NULL,
	"note" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_quote" (
	"security_id" text NOT NULL,
	"currency" text NOT NULL,
	"as_of" date NOT NULL,
	"price_minor" bigint NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "price_quote_security_id_currency_as_of_pk" PRIMARY KEY("security_id","currency","as_of")
);
--> statement-breakpoint
ALTER TABLE "security" ADD CONSTRAINT "security_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_symbol" ADD CONSTRAINT "security_symbol_security_id_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."security"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_override" ADD CONSTRAINT "price_override_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_override" ADD CONSTRAINT "price_override_security_id_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."security"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_quote" ADD CONSTRAINT "price_quote_security_id_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."security"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_quote" ADD CONSTRAINT "price_quote_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "security_symbol_symbol_exchange_from_idx" ON "security_symbol" USING btree ("symbol","exchange","effective_from");--> statement-breakpoint
CREATE INDEX "security_symbol_security_idx" ON "security_symbol" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "price_override_household_security_as_of_idx" ON "price_override" USING btree ("household_id","security_id","as_of");