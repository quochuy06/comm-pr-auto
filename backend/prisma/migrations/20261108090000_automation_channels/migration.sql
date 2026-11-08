CREATE TABLE "AutomationChannel" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "pageId" TEXT NOT NULL,
 "channel" TEXT NOT NULL CHECK ("channel" IN ('COMMENT','MESSENGER')),
 "mode" TEXT NOT NULL DEFAULT 'OFF' CHECK ("mode" IN ('OFF','SEMI_AUTO','AUTO')),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AutomationChannel_pageId_channel_key" ON "AutomationChannel"("pageId", "channel");
