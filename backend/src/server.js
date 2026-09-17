import { app } from './app.js';
import { env } from './config.js';

app.listen(env.port, () => {
  console.log(`[edtimetable] API running at http://localhost:${env.port}/api/v1`);
  console.log(`[edtimetable] Environment: ${env.nodeEnv}`);
});