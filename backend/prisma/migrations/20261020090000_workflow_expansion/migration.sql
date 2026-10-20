-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WorkflowArtifact" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "campaignId" TEXT,
    "sourcePostId" TEXT,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "createdPosts" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "latestJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostSchedule" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowArtifact_kind_createdAt_idx" ON "WorkflowArtifact"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostSchedule_postId_key" ON "PostSchedule"("postId");

-- CreateIndex
CREATE INDEX "PostSchedule_status_scheduledAt_idx" ON "PostSchedule"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "WorkflowArtifact" ADD CONSTRAINT "WorkflowArtifact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowArtifact" ADD CONSTRAINT "WorkflowArtifact_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSchedule" ADD CONSTRAINT "PostSchedule_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

