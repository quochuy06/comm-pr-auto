CREATE TABLE "AdviceInbound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "commentId" TEXT,
    "senderId" TEXT,
    "incomingAt" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'ROUTE',
    "route" JSONB,
    "answerJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "AdviceInbound_pageId_channel_remoteId_key" ON "AdviceInbound"("pageId", "channel", "remoteId");
CREATE INDEX "AdviceInbound_stage_createdAt_idx" ON "AdviceInbound"("stage", "createdAt");

ALTER TABLE "ReplyDecision"
    ADD COLUMN "adviceKey" TEXT,
    ADD COLUMN "sendStatus" TEXT,
    ADD COLUMN "sendError" TEXT,
    ADD COLUMN "externalReplyId" TEXT,
    ADD COLUMN "attemptedAt" TIMESTAMP(3),
    ADD COLUMN "escalatedAt" TIMESTAMP(3),
    ADD CONSTRAINT "ReplyDecision_adviceKey_fkey" FOREIGN KEY ("adviceKey") REFERENCES "AdviceInbound"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ReplyDecision_adviceKey_key" ON "ReplyDecision"("adviceKey");
CREATE INDEX "ReplyDecision_sendStatus_createdAt_idx" ON "ReplyDecision"("sendStatus", "createdAt");
