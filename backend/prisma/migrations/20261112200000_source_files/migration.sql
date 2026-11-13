-- HOANG-API02: uploaded source files (PDF/DOCX/TXT). Additive only.
CREATE TABLE "SourceFile" (
 "id" TEXT NOT NULL,
 "documentId" TEXT NOT NULL,
 "filename" TEXT NOT NULL,
 "mimeType" TEXT NOT NULL,
 "sizeBytes" INTEGER NOT NULL,
 "sha256" TEXT NOT NULL,
 "filePath" TEXT NOT NULL,
 "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING',
 "extractionError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SourceFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SourceFile_documentId_key" ON "SourceFile"("documentId");
CREATE INDEX "SourceFile_extractionStatus_createdAt_idx" ON "SourceFile"("extractionStatus", "createdAt");
ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
