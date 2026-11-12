-- PHUC-API02: keyword rules. Additive only.
CREATE TABLE "KeywordRule" (
 "id" TEXT NOT NULL,
 "pageId" TEXT NOT NULL,
 "channel" TEXT NOT NULL CHECK ("channel" IN ('COMMENT','MESSENGER')),
 "keyword" TEXT NOT NULL,
 "keywordRaw" TEXT NOT NULL,
 "matchType" TEXT NOT NULL DEFAULT 'PHRASE' CHECK ("matchType" IN ('WORD','PHRASE')),
 "priority" INTEGER NOT NULL DEFAULT 1 CHECK ("priority" > 0),
 "replyText" TEXT,
 "sourceDocId" TEXT,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "createdBy" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "KeywordRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KeywordRule_pageId_channel_active_idx" ON "KeywordRule"("pageId", "channel", "active");
