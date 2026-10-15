-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "contentReview" JSONB,
ADD COLUMN     "imageError" TEXT,
ADD COLUMN     "imageReview" JSONB,
ADD COLUMN     "imageReviewStatus" TEXT NOT NULL DEFAULT 'NOT_REVIEWED';

-- AlterTable
ALTER TABLE "WorkflowJob" ADD COLUMN     "imageAsset" JSONB,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'CONTENT';

