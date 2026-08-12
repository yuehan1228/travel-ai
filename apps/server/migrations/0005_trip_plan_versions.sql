CREATE TABLE "trip_plan_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	"date" date NOT NULL,
	"summary" text NOT NULL,
	"weather" jsonb NOT NULL,
	"estimated_cost_cny" numeric(14, 2) NOT NULL,
	"warnings" jsonb NOT NULL,
	CONSTRAINT "trip_plan_days_day_number_check" CHECK ("trip_plan_days"."day_number" >= 1),
	CONSTRAINT "trip_plan_days_cost_check" CHECK ("trip_plan_days"."estimated_cost_cny" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trip_plan_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"day_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"start_time" varchar(5) NOT NULL,
	"end_time" varchar(5) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"recommendation_reason" text NOT NULL,
	"place" jsonb,
	"route" jsonb,
	"estimated_cost_cny" numeric(14, 2) NOT NULL,
	"tips" jsonb NOT NULL,
	"data_sources" jsonb NOT NULL,
	CONSTRAINT "trip_plan_items_cost_check" CHECK ("trip_plan_items"."estimated_cost_cny" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trip_plan_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema_version" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"plan_snapshot" jsonb,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_plan_versions_version_check" CHECK ("trip_plan_versions"."version" >= 1),
	CONSTRAINT "trip_plan_versions_schema_version_check" CHECK ("trip_plan_versions"."schema_version" = '1.0'),
	CONSTRAINT "trip_plan_versions_status_check" CHECK ("trip_plan_versions"."status" in ('generating', 'ready', 'failed')),
	CONSTRAINT "trip_plan_versions_snapshot_status_check" CHECK (("trip_plan_versions"."status" = 'ready' and "trip_plan_versions"."plan_snapshot" is not null) or ("trip_plan_versions"."status" <> 'ready' and "trip_plan_versions"."plan_snapshot" is null))
);
--> statement-breakpoint
ALTER TABLE "trip_plan_days" ADD CONSTRAINT "trip_plan_days_version_id_trip_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."trip_plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_plan_items" ADD CONSTRAINT "trip_plan_items_day_id_trip_plan_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."trip_plan_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_plan_versions" ADD CONSTRAINT "trip_plan_versions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_plan_days_version_day_unique" ON "trip_plan_days" USING btree ("version_id","day_number");--> statement-breakpoint
CREATE INDEX "trip_plan_days_version_idx" ON "trip_plan_days" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_plan_items_day_item_unique" ON "trip_plan_items" USING btree ("day_id","item_id");--> statement-breakpoint
CREATE INDEX "trip_plan_items_day_idx" ON "trip_plan_items" USING btree ("day_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_plan_versions_trip_version_unique" ON "trip_plan_versions" USING btree ("trip_id","version");--> statement-breakpoint
CREATE INDEX "trip_plan_versions_trip_created_idx" ON "trip_plan_versions" USING btree ("trip_id","created_at");
