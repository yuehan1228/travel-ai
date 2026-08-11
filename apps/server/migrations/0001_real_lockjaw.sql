CREATE TABLE "weather_cache" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(64) NOT NULL,
	"cache_key" varchar(512) NOT NULL,
	"city_name" varchar(100) NOT NULL,
	"city_code" varchar(32),
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"source" varchar(32) NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weather_cache_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE INDEX "weather_cache_expires_idx" ON "weather_cache" USING btree ("expires_at");