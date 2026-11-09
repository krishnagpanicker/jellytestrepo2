CREATE TABLE "spotify_accounts" (
	"id" uuid NOT NULL,
	"spotifyId" text NOT NULL,
	"name" text,
	"accessToken" text NOT NULL,
	"refreshToken" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spotify_user_pk" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "spotify_accounts" ADD CONSTRAINT "spotify_user_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;