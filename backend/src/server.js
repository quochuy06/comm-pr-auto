import { app } from "./app.js";
import prisma from "./prisma.js";
import { recoverJobs } from "./services/workflows.js";
await recoverJobs();
const server = app.listen(process.env.PORT || 5000, "0.0.0.0", () =>
  console.log(`Backend ready on port ${process.env.PORT || 5000}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    }),
  );
