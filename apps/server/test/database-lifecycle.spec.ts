import { describe, expect, it, vi } from 'vitest';

import { DatabaseLifecycleService } from '../src/database/database-lifecycle.service';

describe('DatabaseLifecycleService', () => {
  it('ends a fake pool once during repeated shutdown callbacks', async () => {
    const end = vi.fn(async (): Promise<void> => undefined);
    const service = new DatabaseLifecycleService({ end });

    await Promise.all([service.onApplicationShutdown(), service.onApplicationShutdown()]);
    await service.onApplicationShutdown();

    expect(end).toHaveBeenCalledOnce();
  });
});
