ALTER TABLE "WorkflowArtifact" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "WorkflowArtifact_dedupeKey_key" ON "WorkflowArtifact"("dedupeKey");
