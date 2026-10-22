ALTER TABLE "Comment" ADD COLUMN "autoReplyEligible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FacebookReply" ADD COLUMN "automatic" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "automationVersion" TIMESTAMP(3);
CREATE TABLE "FacebookAutomation" (
 "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default', "pageId" TEXT NOT NULL,
 "commentEnabled" BOOLEAN NOT NULL DEFAULT false, "messengerEnabled" BOOLEAN NOT NULL DEFAULT false,
 "commentEnabledAt" TIMESTAMP(3), "messengerEnabledAt" TIMESTAMP(3),
 "commentTemplate" TEXT NOT NULL DEFAULT 'Chào {name}! Hiên có thể giúp gì cho bạn?',
 "messengerTemplate" TEXT NOT NULL DEFAULT 'Chào {name}! Hiên có thể giúp gì cho bạn? Bạn cứ gửi câu hỏi tại đây nhé.',
 "messengerSyncedAt" TIMESTAMP(3), "messengerSyncError" TEXT,
 "version" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "FacebookInboxReply" (
 "id" TEXT NOT NULL PRIMARY KEY, "inboundId" TEXT NOT NULL, "pageId" TEXT NOT NULL,
 "senderId" TEXT NOT NULL, "senderName" TEXT NOT NULL, "incomingText" TEXT NOT NULL,
 "incomingAt" TIMESTAMP(3) NOT NULL, "replyText" TEXT NOT NULL, "automationVersion" TIMESTAMP(3) NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "externalId" TEXT, "attemptedAt" TIMESTAMP(3), "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "FacebookInboxReply_inboundId_key" ON "FacebookInboxReply"("inboundId");
CREATE UNIQUE INDEX "FacebookInboxReply_externalId_key" ON "FacebookInboxReply"("externalId");
CREATE INDEX "FacebookInboxReply_pageId_senderId_createdAt_idx" ON "FacebookInboxReply"("pageId", "senderId", "createdAt");
CREATE INDEX "FacebookInboxReply_status_createdAt_idx" ON "FacebookInboxReply"("status", "createdAt");
