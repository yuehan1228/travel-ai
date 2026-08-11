CREATE TABLE "route_cache" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(64) NOT NULL,
	"cache_key" varchar(128) NOT NULL,
	"mode" varchar(16) NOT NULL,
	"origin_longitude" numeric(10, 7) NOT NULL,
	"origin_latitude" numeric(9, 7) NOT NULL,
	"destination_longitude" numeric(10, 7) NOT NULL,
	"destination_latitude" numeric(9, 7) NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_cache_cache_key_unique" UNIQUE("cache_key"),
	CONSTRAINT "route_cache_mode_check" CHECK ("route_cache"."mode" in ('walking', 'driving')),
	CONSTRAINT "route_cache_origin_longitude_check" CHECK ("route_cache"."origin_longitude" between -180 and 180),
	CONSTRAINT "route_cache_origin_latitude_check" CHECK ("route_cache"."origin_latitude" between -90 and 90),
	CONSTRAINT "route_cache_destination_longitude_check" CHECK ("route_cache"."destination_longitude" between -180 and 180),
	CONSTRAINT "route_cache_destination_latitude_check" CHECK ("route_cache"."destination_latitude" between -90 and 90)
);
--> statement-breakpoint
CREATE INDEX "route_cache_expires_idx" ON "route_cache" USING btree ("expires_at");