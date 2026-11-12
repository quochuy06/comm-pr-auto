-- HUY-API02: PR config/content/outbox. Additive only. publicationKey unique
-- guarantees one PR job per publication.
CREATE TABLE "PrConfig" (
 "id" TEXT NOT NULL DEFAULT 'default',
 "pageId" TEXT NOT NULL,
 "mode" TEXT NOT NULL DEFAULT 'OFF' CHECK ("mode" IN ('OFF','SEMI_AUTO','AUTO')),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PrConfig_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PrContent" (
 "id" TEXT NOT NULL,
 "pageId" TEXT NOT NULL,
 "text" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1,
 "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','APPROVED','ARCHIVED')),
 "createdBy" TEXT,
 "reviewedBy" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PrContent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PrContent_pageId_status_idx" ON "PrContent"("pageId", "status");
CREATE TABLE "PrOutbox" (
 "id" TEXT NOT NULL,
 "publicationKey" TEXT NOT NULL,
 "postId" TEXT,
 "scheduleId" TEXT,
 "pageId" TEXT NOT NULL,
 "contentId" TEXT,
 "contentSnapshot" JSONB,
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','SENT','FAILED','UNCERTAIN')),
 "externalId" TEXT,
 "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PrOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrOutbox_publicationKey_key" ON "PrOutbox"("publicationKey");
CREATE INDEX "PrOutbox_status_createdAt_idx" ON "PrOutbox"("status", "createdAt");
