-- HOANG-API03: brand voice for the retrieval/answer contract. Additive only.
CREATE TABLE "BrandVoice" (
 "id" TEXT NOT NULL DEFAULT 'default',
 "pageId" TEXT NOT NULL,
 "tone" TEXT NOT NULL DEFAULT 'thân thiện, lịch sự',
 "style" TEXT,
 "forbidden" TEXT,
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "BrandVoice_pkey" PRIMARY KEY ("id")
);
