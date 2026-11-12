-- HOANG-API04: AI video generation. Job/attempt/provider-job-id tracking reuses
-- "WorkflowJob"/"WorkflowAttempt"; this table holds the request and the verified
-- MP4 asset. Additive only: no existing table is altered.
CREATE TABLE "VideoAsset" (
 "id" TEXT NOT NULL,
 "jobId" TEXT NOT NULL,
 "provider" TEXT NOT NULL,
 "prompt" TEXT NOT NULL,
 "params" JSONB,
 "status" TEXT NOT NULL DEFAULT 'PENDING',
 "filePath" TEXT,
 "sha256" TEXT,
 "mimeType" TEXT,
 "duration" DOUBLE PRECISION,
 "width" INTEGER,
 "height" INTEGER,
 "codec" TEXT,
 "verification" TEXT,
 "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "VideoAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VideoAsset_jobId_key" ON "VideoAsset"("jobId");
CREATE INDEX "VideoAsset_status_createdAt_idx" ON "VideoAsset"("status", "createdAt");
ALTER TABLE "VideoAsset" ADD CONSTRAINT "VideoAsset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "WorkflowJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
