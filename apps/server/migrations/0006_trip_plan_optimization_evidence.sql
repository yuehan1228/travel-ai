CREATE TABLE "trip_plan_optimization_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_plan_version_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"source_version" integer NOT NULL,
	"day_number" smallint NOT NULL,
	"mode" varchar(16) NOT NULL,
	"evidence_version" varchar(16) NOT NULL,
	"start_item_id" uuid,
	"end_item_id" uuid,
	"matrix_snapshot" jsonb NOT NULL,
	"order_snapshot" jsonb NOT NULL,
	"explanation_snapshot" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_plan_optimization_evidence_source_version_check" CHECK ("trip_plan_optimization_evidence"."source_version" >= 1),
	CONSTRAINT "trip_plan_optimization_evidence_day_number_check" CHECK ("trip_plan_optimization_evidence"."day_number" between 1 and 14),
	CONSTRAINT "trip_plan_optimization_evidence_mode_check" CHECK ("trip_plan_optimization_evidence"."mode" in ('walking', 'driving')),
	CONSTRAINT "trip_plan_optimization_evidence_version_check" CHECK ("trip_plan_optimization_evidence"."evidence_version" = '1.0')
);
--> statement-breakpoint
ALTER TABLE "trip_plan_optimization_evidence" ADD CONSTRAINT "trip_plan_optimization_evidence_trip_plan_version_id_trip_plan_versions_id_fk" FOREIGN KEY ("trip_plan_version_id") REFERENCES "public"."trip_plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_plan_optimization_evidence" ADD CONSTRAINT "trip_plan_optimization_evidence_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_plan_optimization_evidence_version_day_unique" ON "trip_plan_optimization_evidence" USING btree ("trip_plan_version_id","day_number");--> statement-breakpoint
CREATE INDEX "trip_plan_optimization_evidence_trip_idx" ON "trip_plan_optimization_evidence" USING btree ("trip_id","source_version");