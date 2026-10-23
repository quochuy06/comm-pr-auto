import { app } from "./app.js";
import prisma from "./prisma.js";
import { recoverJobs } from "./services/workflows.js";
import { startFacebookWorker } from "./services/facebookCommunity.js";
// Restored VPS instances can be reviewed before enabling external side effects.
const backgroundEnabled = process.env.BACKGROUND_JOBS_ENABLED !== "false";
if (backgroundEnabled) await recoverJobs();
const stopFacebookWorker = backgroundEnabled ? startFacebookWorker(prisma) : () => {};
const server = app.listen(process.env.PORT || 5000, "0.0.0.0", () =>
  console.log(`Backend ready on port ${process.env.PORT || 5000}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopFacebookWorker();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
