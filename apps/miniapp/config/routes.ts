export const MINIAPP_ROUTES = {
  home: '/pages/index/index',
} as const;

export type MiniAppRoute = (typeof MINIAPP_ROUTES)[keyof typeof MINIAPP_ROUTES];
