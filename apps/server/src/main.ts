import { createApp } from './create-app';
import { loadEnvironment } from './config/environment';
import { loadAuthEnvironment } from './modules/auth/config/auth-environment';

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const app = await createApp(environment, { authEnvironment: loadAuthEnvironment() });

  app.enableShutdownHooks();
  await app.listen({ host: '0.0.0.0', port: environment.port });
}

void bootstrap();
