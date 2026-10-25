import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`[panel] CS2 панель слушает http://${shown}:${config.port}`);
  if (config.demoMode) console.log('[panel] DEMO_MODE=1 — данные сервера демонстрационные');
  if (!config.adminSteamIds.length) console.log('[panel] Внимание: ADMIN_STEAM_IDS пуст — доступ к управлению сервером ни у кого не будет');
  if (!config.steamApiKey) console.log('[panel] STEAM_API_KEY не задан — имена и аватары из Steam недоступны');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

export { app, server };
