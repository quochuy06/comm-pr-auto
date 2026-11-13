-- PHUC-API03: two-channel reply approval queue. Additive only.
CREATE TABLE "ReplyDecision" (
 "id" TEXT NOT NULL,
 "pageId" TEXT NOT NULL,
 "channel" TEXT NOT NULL CHECK ("channel" IN ('COMMENT','MESSENGER')),
 "inboundId" TEXT,
 "inboundText" TEXT NOT NULL,
 "mode" TEXT NOT NULL CHECK ("mode" IN ('OFF','SEMI_AUTO','AUTO')),
 "decision" TEXT NOT NULL CHECK ("decision" IN ('PENDING_APPROVAL','READY_TO_SEND','SKIPPED','NEEDS_HUMAN')),
 "ruleId" TEXT,
 "replyText" TEXT,
 "sourceSnapshot" JSONB,
 "reason" TEXT,
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPROVED','REJECTED')),
 "reviewedBy" TEXT,
 "reviewedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ReplyDecision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReplyDecision_pageId_channel_status_idx" ON "ReplyDecision"("pageId", "channel", "status");
