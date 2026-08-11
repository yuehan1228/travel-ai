CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"city_name" varchar(255) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"traveler_count" smallint NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "trips_date_range_check" CHECK ("trips"."end_date" >= "trips"."start_date"),
	CONSTRAINT "trips_traveler_count_check" CHECK ("trips"."traveler_count" between 1 and 20),
	CONSTRAINT "trips_status_check" CHECK ("trips"."status" in ('draft', 'generating', 'ready', 'failed', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"openid" varchar(255) NOT NULL,
	"unionid" varchar(255),
	"nickname" varchar(255) DEFAULT '' NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_status_check" CHECK ("users"."status" in ('active', 'blocked', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trips_user_updated_idx" ON "trips" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "trips_status_idx" ON "trips" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trips_date_range_idx" ON "trips" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "trips_deleted_at_idx" ON "trips" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_openid_unique" ON "users" USING btree ("openid");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");