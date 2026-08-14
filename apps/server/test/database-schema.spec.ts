import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  routeCache,
  tripPlanOptimizationEvidence,
  trips,
  users,
  weatherCache,
} from '../src/database/schema';

function readInitialMigration(): string {
  const migrationDirectory = resolve(__dirname, '../migrations');
  const migrationName = readdirSync(migrationDirectory).find((name) => name.endsWith('.sql'));

  if (migrationName === undefined) {
    throw new Error('No SQL migration found');
  }

  return readFileSync(resolve(migrationDirectory, migrationName), 'utf8');
}

describe('database schema', () => {
  it('exports users and trips with the required column types', () => {
    expect(users.id.getSQLType()).toBe('uuid');
    expect(users.openid.getSQLType()).toBe('varchar(255)');
    expect(users.avatarUrl.name).toBe('avatar_url');
    expect(users.createdAt.getSQLType()).toBe('timestamp with time zone');

    expect(trips.userId.getSQLType()).toBe('uuid');
    expect(trips.startDate.getSQLType()).toBe('date');
    expect(trips.travelerCount.getSQLType()).toBe('smallint');
    expect(trips.inputSnapshot.getSQLType()).toBe('jsonb');
    expect(trips.deletedAt.name).toBe('deleted_at');
    expect(weatherCache.cacheKey.name).toBe('cache_key');
    expect(weatherCache.payload.getSQLType()).toBe('jsonb');
    expect(weatherCache.expiresAt.name).toBe('expires_at');
    expect(routeCache.cacheKey.name).toBe('cache_key');
    expect(routeCache.mode.name).toBe('mode');
    expect(routeCache.originLongitude.getSQLType()).toBe('numeric(10, 7)');
    expect(routeCache.payload.getSQLType()).toBe('jsonb');
    expect(routeCache.updatedAt.name).toBe('updated_at');
  });

  it('keeps constraints, foreign key, and indexes in the Drizzle migration', () => {
    const migration = readInitialMigration();

    expect(migration).toContain('CREATE TABLE "users"');
    expect(migration).toContain('CREATE TABLE "trips"');
    expect(migration).toContain('CREATE UNIQUE INDEX "users_openid_unique"');
    expect(migration).toContain('trips_user_id_users_id_fk');
    expect(migration).toContain('ON DELETE restrict');
    expect(migration).toContain('trips_date_range_check');
    expect(migration).toContain('trips_traveler_count_check');
    expect(migration).toContain('trips_status_check');
    expect(migration).toContain('users_status_check');
    expect(migration).toContain('trips_user_updated_idx');
    expect(migration).toContain('trips_date_range_idx');
    expect(migration).toContain('users_created_at_idx');
  });

  it('keeps the weather cache migration reviewable', () => {
    const migrationDirectory = resolve(__dirname, '../migrations');
    const migrationName = readdirSync(migrationDirectory).find(
      (name) => name.includes('weather') || name.startsWith('0001_'),
    );
    expect(migrationName).toBeDefined();
    const migration = readFileSync(resolve(migrationDirectory, migrationName!), 'utf8');
    expect(migration).toContain('CREATE TABLE "weather_cache"');
    expect(migration).toContain('weather_cache_cache_key_unique');
    expect(migration).toContain('weather_cache_expires_idx');
  });

  it('keeps the route cache migration reviewable', () => {
    const migrationDirectory = resolve(__dirname, '../migrations');
    const migrationName = readdirSync(migrationDirectory).find((name) => {
      if (!name.endsWith('.sql')) return false;
      return readFileSync(resolve(migrationDirectory, name), 'utf8').includes(
        'CREATE TABLE "route_cache"',
      );
    });
    expect(migrationName).toBeDefined();
    const migration = readFileSync(resolve(migrationDirectory, migrationName!), 'utf8');
    expect(migration).toContain('CREATE TABLE "route_cache"');
    expect(migration).toContain('route_cache_cache_key_unique');
    expect(migration).toContain('route_cache_expires_idx');
    expect(migration).toContain('route_cache_mode_check');
  });

  it('keeps TASK-026 optimization evidence schema and migration reviewable', () => {
    expect(tripPlanOptimizationEvidence.versionId.name).toBe('trip_plan_version_id');
    expect(tripPlanOptimizationEvidence.matrixSnapshot.getSQLType()).toBe('jsonb');
    expect(tripPlanOptimizationEvidence.orderSnapshot.getSQLType()).toBe('jsonb');
    expect(tripPlanOptimizationEvidence.explanationSnapshot.getSQLType()).toBe('jsonb');
    expect(tripPlanOptimizationEvidence.dayNumber.getSQLType()).toBe('smallint');

    const migrationDirectory = resolve(__dirname, '../migrations');
    const migrationName = readdirSync(migrationDirectory).find((name) =>
      name.includes('optimization_evidence'),
    );
    expect(migrationName).toBeDefined();
    const migration = readFileSync(resolve(migrationDirectory, migrationName!), 'utf8');
    expect(migration).toContain('CREATE TABLE "trip_plan_optimization_evidence"');
    expect(migration).toContain('trip_plan_optimization_evidence_version_day_unique');
    expect(migration).toContain('ON DELETE cascade');
    expect(migration).toContain('trip_plan_optimization_evidence_mode_check');
    expect(migration).toContain('trip_plan_optimization_evidence_day_number_check');
    expect(migration).toContain('trip_plan_optimization_evidence_trip_idx');
    const journal = readFileSync(resolve(migrationDirectory, 'meta/_journal.json'), 'utf8');
    expect(journal).toContain('0006_trip_plan_optimization_evidence');
  });
});
