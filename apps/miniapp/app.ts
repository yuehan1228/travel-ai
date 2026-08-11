import { CURRENT_MINIAPP_ENVIRONMENT, type MiniAppEnvironment } from './config/environment';

interface MiniAppGlobalData {
  environment: MiniAppEnvironment;
}

App<MiniAppGlobalData>({
  globalData: {
    environment: CURRENT_MINIAPP_ENVIRONMENT,
  },
});
