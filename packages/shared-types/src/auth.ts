export interface WechatLoginInput {
  code: string;
}

export interface AuthUser {
  id: string;
  nickname: string;
  avatarUrl: string;
}

export interface LoginResult {
  user: AuthUser;
  accessToken: string;
  expiresIn: number;
}
