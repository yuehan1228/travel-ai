import { describe, expect, it } from 'vitest';

import { AuthService } from '../src/modules/auth/auth.service';
import { createTestAuthEnvironment } from '../src/modules/auth/config/auth-environment';
import type { UserRepository, UserRecord } from '../src/modules/auth/repositories/user.repository';
import type { WechatProvider } from '../src/modules/auth/providers/wechat.provider';
import type { AccessTokenService } from '../src/modules/auth/token/access-token.service';

const user: UserRecord = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  nickname: '',
  avatarUrl: '',
  status: 'active',
};

class FakeProvider implements WechatProvider {
  public calls: string[] = [];

  public async exchangeCode(code: string): Promise<{ openid: string; unionid?: string }> {
    this.calls.push(code);
    return { openid: 'openid-hidden', unionid: 'unionid-hidden' };
  }
}

class FakeRepository implements UserRepository {
  public identities: Array<{ openid: string; unionid?: string }> = [];

  public async findOrCreateByWechatIdentity(input: {
    openid: string;
    unionid?: string;
  }): Promise<UserRecord> {
    this.identities.push(input);
    return user;
  }
}

class FakeTokenService implements AccessTokenService {
  public async signAccessToken(userId: string): Promise<string> {
    return `token-for-${userId}`;
  }

  public async verifyAccessToken(): Promise<never> {
    throw new Error('not used');
  }
}

describe('AuthService', () => {
  it('exchanges the code, persists identity, and returns only public user data', async () => {
    const provider = new FakeProvider();
    const repository = new FakeRepository();
    const service = new AuthService(
      provider,
      repository,
      new FakeTokenService(),
      createTestAuthEnvironment(),
    );

    await expect(service.login({ code: ' wx-code ' })).resolves.toEqual({
      user: { id: user.id, nickname: '', avatarUrl: '' },
      accessToken: `token-for-${user.id}`,
      expiresIn: 7_200,
    });
    expect(provider.calls).toEqual(['wx-code']);
    expect(repository.identities).toEqual([{ openid: 'openid-hidden', unionid: 'unionid-hidden' }]);
  });

  it('rejects invalid login input before calling the provider', async () => {
    const provider = new FakeProvider();
    const service = new AuthService(
      provider,
      new FakeRepository(),
      new FakeTokenService(),
      createTestAuthEnvironment(),
    );

    await expect(service.login({ code: '   ' })).rejects.toMatchObject({
      code: 'AUTH_CODE_INVALID',
    });
    expect(provider.calls).toHaveLength(0);
  });
});
