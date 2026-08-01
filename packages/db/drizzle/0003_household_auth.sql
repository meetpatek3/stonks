ALTER TABLE "household" ADD COLUMN "auth_username" text;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_auth_username_unique" UNIQUE("auth_username");
