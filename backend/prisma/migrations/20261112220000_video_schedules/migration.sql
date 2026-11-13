-- HUY-API01-A: video scheduling. Additive only. Một video job một lịch.
CREATE TABLE "VideoSchedule" (
 "id" TEXT NOT NULL,
 "videoJobId" TEXT NOT NULL,
 "scheduledAt" TIMESTAMP(3) NOT NULL,
 "target" TEXT NOT NULL DEFAULT 'FACEBOOK_PAGE',
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','CANCELLED','PUBLISHING','PUBLISHED','FAILED')),
 "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "VideoSchedule_pkey" PRIMARY KEY ("id")
);
-- Một video job chỉ có MỘT lịch đang hoạt động; lịch đã hủy vẫn giữ để đối soát.
CREATE UNIQUE INDEX "VideoSchedule_videoJobId_active_key" ON "VideoSchedule"("videoJobId") WHERE "status" <> 'CANCELLED';
CREATE INDEX "VideoSchedule_status_scheduledAt_idx" ON "VideoSchedule"("status", "scheduledAt");
ALTER TABLE "VideoSchedule" ADD CONSTRAINT "VideoSchedule_videoJobId_fkey" FOREIGN KEY ("videoJobId") REFERENCES "WorkflowJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
