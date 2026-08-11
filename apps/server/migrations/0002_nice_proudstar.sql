CREATE TABLE "poi_search_cache" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cache_key" varchar(768) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"city_name" varchar(100) NOT NULL,
	"city_code" varchar(32),
	"keyword" varchar(100),
	"categories" jsonb NOT NULL,
	"page" integer NOT NULL,
	"page_size" integer NOT NULL,
	"place_ids" jsonb NOT NULL,
	"total" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poi_search_cache_page_check" CHECK ("poi_search_cache"."page" >= 1),
	CONSTRAINT "poi_search_cache_page_size_check" CHECK ("poi_search_cache"."page_size" between 1 and 50),
	CONSTRAINT "poi_search_cache_total_check" CHECK ("poi_search_cache"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pois" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(64) NOT NULL,
	"provider_place_id" varchar(128) NOT NULL,
	"city_name" varchar(100) NOT NULL,
	"city_code" varchar(32),
	"name" varchar(200) NOT NULL,
	"category" varchar(32) NOT NULL,
	"category_text" varchar(100) NOT NULL,
	"address" text NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"latitude" numeric(9, 7) NOT NULL,
	"rating" numeric(2, 1),
	"opening_hours" text,
	"telephone" varchar(64),
	"raw_type_code" varchar(32),
	"payload" jsonb NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pois_longitude_check" CHECK ("pois"."longitude" between -180 and 180),
	CONSTRAINT "pois_latitude_check" CHECK ("pois"."latitude" between -90 and 90),
	CONSTRAINT "pois_rating_check" CHECK ("pois"."rating" is null or "pois"."rating" between 0 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "poi_search_cache_key_unique" ON "poi_search_cache" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "poi_search_cache_expires_idx" ON "poi_search_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pois_provider_place_unique" ON "pois" USING btree ("provider","provider_place_id");--> statement-breakpoint
CREATE INDEX "pois_city_idx" ON "pois" USING btree ("city_name");--> statement-breakpoint
CREATE INDEX "pois_city_code_idx" ON "pois" USING btree ("city_code");--> statement-breakpoint
CREATE INDEX "pois_category_idx" ON "pois" USING btree ("category");--> statement-breakpoint
CREATE INDEX "pois_expires_idx" ON "pois" USING btree ("expires_at");