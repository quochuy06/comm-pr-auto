ALTER TYPE "PostStatus" ADD VALUE 'PUBLISHING';
ALTER TABLE "PostSchedule"
  ADD COLUMN "target" TEXT NOT NULL DEFAULT 'SIMULATOR',
  ADD COLUMN "pageId" TEXT,
  ADD COLUMN "externalPostId" TEXT,
  ADD COLUMN "permalink" TEXT,
  ADD COLUMN "attemptedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "PostSchedule_externalPostId_key" ON "PostSchedule"("externalPostId");
