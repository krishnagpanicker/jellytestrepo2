ALTER TABLE "auth_accounts" DROP CONSTRAINT "auth_user_fk";
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;