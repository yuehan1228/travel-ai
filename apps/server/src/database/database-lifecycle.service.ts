import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';

import { DATABASE_POOL } from './database.tokens';

interface PoolWithShutdown {
  end(): Promise<void>;
}

@Injectable()
export class DatabaseLifecycleService implements OnApplicationShutdown {
  private endPromise: Promise<void> | undefined;

  public constructor(@Inject(DATABASE_POOL) private readonly pool: PoolWithShutdown) {}

  public onApplicationShutdown(): Promise<void> {
    this.endPromise ??= Promise.resolve().then(() => this.pool.end());
    return this.endPromise;
  }
}
