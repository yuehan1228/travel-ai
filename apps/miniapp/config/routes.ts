export const MINIAPP_ROUTES = {
  home: '/pages/index/index',
  tripGenerating: '/pages/trip-generating/index',
  tripPlan: '/pages/trip-plan/index',
} as const;

export type MiniAppRoute = (typeof MINIAPP_ROUTES)[keyof typeof MINIAPP_ROUTES];
