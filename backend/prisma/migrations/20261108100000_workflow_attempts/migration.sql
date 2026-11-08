ALTER TABLE "WorkflowJob" ADD COLUMN "contractSnapshot" JSONB, ADD COLUMN "currentAttemptId" TEXT;
CREATE TABLE "WorkflowAttempt" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "jobId" TEXT NOT NULL REFERENCES "WorkflowJob"("id") ON DELETE CASCADE,
 "leaseOwner" TEXT NOT NULL,
 "leaseUntil" TIMESTAMP(3) NOT NULL,
 "providerJobId" TEXT,
 "receipt" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WorkflowAttempt_jobId_idx" ON "WorkflowAttempt"("jobId");
