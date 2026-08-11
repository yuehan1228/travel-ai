import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { DATABASE } from '../../../database/database.tokens';
import type { Database } from '../../../database/database.types';
import { users, type User } from '../../../database/schema/users.schema';

export interface UserRecord {
  readonly id: string;
  readonly nickname: string;
  readonly avatarUrl: string;
  readonly status?: string;
}

export interface FindOrCreateByWechatIdentityInput {
  readonly openid: string;
  readonly unionid?: string;
}

export interface UserRepository {
  findOrCreateByWechatIdentity(input: FindOrCreateByWechatIdentityInput): Promise<UserRecord>;
}

const toUserRecord = (user: User): UserRecord => ({
  id: user.id,
  nickname: user.nickname,
  avatarUrl: user.avatarUrl,
  status: user.status,
});

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  public constructor(@Inject(DATABASE) private readonly database: Database) {}

  public async findOrCreateByWechatIdentity(
    input: FindOrCreateByWechatIdentityInput,
  ): Promise<UserRecord> {
    const normalizedOpenid = input.openid.trim();
    const normalizedUnionid = input.unionid?.trim();
    const existing = await this.findByOpenid(normalizedOpenid);

    if (existing !== undefined) {
      return this.updateExisting(existing, normalizedUnionid);
    }

    const now = new Date();
    const inserted = await this.database
      .insert(users)
      .values({
        id: randomUUID(),
        openid: normalizedOpenid,
        ...(normalizedUnionid === undefined || normalizedUnionid.length === 0
          ? {}
          : { unionid: normalizedUnionid }),
        nickname: '',
        avatarUrl: '',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: users.openid })
      .returning();

    const created = inserted[0];
    if (created !== undefined) {
      return toUserRecord(created);
    }

    // A concurrent request won the unique OpenID insert. Read the winner and
    // update its timestamp through the same code path as a normal repeat login.
    const concurrent = await this.findByOpenid(normalizedOpenid);
    if (concurrent === undefined) {
      throw new Error('User could not be created');
    }

    return this.updateExisting(concurrent, normalizedUnionid);
  }

  private async findByOpenid(openid: string): Promise<User | undefined> {
    const result = await this.database
      .select()
      .from(users)
      .where(eq(users.openid, openid))
      .limit(1);

    return result[0];
  }

  private async updateExisting(user: User, unionid: string | undefined): Promise<UserRecord> {
    const updated = await this.database
      .update(users)
      .set({
        ...(unionid === undefined || unionid.length === 0 ? {} : { unionid }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    return toUserRecord(updated[0] ?? user);
  }
}
