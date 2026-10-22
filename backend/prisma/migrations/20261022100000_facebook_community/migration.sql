ALTER TABLE "Comment" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'SIMULATOR',
 ADD COLUMN "externalId" TEXT, ADD COLUMN "pageId" TEXT, ADD COLUMN "sourceHash" TEXT,
 ADD COLUMN "remoteDeleted" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "syncedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Comment_externalId_key" ON "Comment"("externalId");
ALTER TABLE "PostSchedule" ADD COLUMN "commentsSyncedAt" TIMESTAMP(3), ADD COLUMN "commentSyncError" TEXT;
CREATE TABLE "FacebookReply" (
 "id" TEXT NOT NULL PRIMARY KEY, "commentId" TEXT NOT NULL, "pageId" TEXT NOT NULL,
 "sourceHash" TEXT NOT NULL, "text" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
 "externalId" TEXT, "attemptedAt" TIMESTAMP(3), "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "FacebookReply_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FacebookReply_commentId_key" ON "FacebookReply"("commentId");
CREATE UNIQUE INDEX "FacebookReply_externalId_key" ON "FacebookReply"("externalId");
CREATE INDEX "FacebookReply_status_createdAt_idx" ON "FacebookReply"("status", "createdAt");
CREATE TABLE "FacebookEvent" (
 "id" TEXT NOT NULL PRIMARY KEY, "dedupeKey" TEXT NOT NULL, "pageId" TEXT NOT NULL,
 "payload" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
 "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "FacebookEvent_dedupeKey_key" ON "FacebookEvent"("dedupeKey");
CREATE INDEX "FacebookEvent_status_createdAt_idx" ON "FacebookEvent"("status", "createdAt");
CREATE TABLE "FacebookMetricSnapshot" (
 "id" TEXT NOT NULL PRIMARY KEY, "scheduleId" TEXT NOT NULL, "metrics" JSONB NOT NULL,
 "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FacebookMetricSnapshot_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PostSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FacebookMetricSnapshot_scheduleId_capturedAt_idx" ON "FacebookMetricSnapshot"("scheduleId", "capturedAt");
