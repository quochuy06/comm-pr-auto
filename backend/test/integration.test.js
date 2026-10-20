import fs from "node:fs/promises";
import { mediaDir } from "../src/services/images.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import prisma from "../src/prisma.js";
import { hashPassword } from "../src/lib/security.js";
test(
  "API integration: auth, role gates, duplicate/stale callbacks, concurrent approval and crisis human gate",
  { skip: process.env.RUN_DB_TESTS !== "true" },
  async () => {
    const prefix = "integration-" + randomUUID(),
      ids = [],
      users = [];
    let server;
    const fixtureName = randomUUID() + ".png";
    const review = {
      safe: true,
      grounded: true,
      risk: "LOW",
      reason: "Phù hợp dữ kiện.",
    };
    try {
      await prisma.campaign.create({ data: { id: prefix, name: prefix } });
      const password = "Integration-Only!";
      const passwordHash = await hashPassword(password);
      for (const role of ["ADMIN", "EDITOR", "REVIEWER"]) {
        const u = await prisma.user.create({
          data: {
            email: role.toLowerCase() + "-" + prefix + "@test.invalid",
            name: prefix,
            role,
            passwordHash,
          },
        });
        users.push(u.id);
      }
      server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = "http://127.0.0.1:" + server.address().port;
      async function req(path, method = "GET", body, headers = {}) {
        const r = await fetch(base + path, {
          method,
          headers: { "Content-Type": "application/json", ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return {
          status: r.status,
          body: await r.json(),
          cookie: r.headers.get("set-cookie")?.split(";")[0],
        };
      }
      const cookies = {};
      for (const role of ["ADMIN", "EDITOR", "REVIEWER"]) {
        const r = await req("/api/auth/login", "POST", {
          email: role.toLowerCase() + "-" + prefix + "@test.invalid",
          password,
        });
        assert.equal(r.status, 200);
        cookies[role] = r.cookie;
      }
      assert.equal((await req("/api/posts")).status, 401);
      assert.equal(
        (
          await req("/api/auth/me", "GET", undefined, {
            Cookie: cookies.EDITOR,
          })
        ).body.data.role,
        "EDITOR",
      );
      assert.equal(
        (
          await req(
            "/api/settings",
            "PATCH",
            { mode: "MANUAL" },
            { Cookie: cookies.EDITOR },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/api/posts/generate",
            "POST",
            { topic: "x" },
            { Cookie: cookies.REVIEWER },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/api/campaigns",
            "POST",
            { name: "x" },
            { Cookie: cookies.ADMIN, Origin: "https://evil.invalid" },
          )
        ).status,
        403,
      );
      const p = await prisma.post.create({
        data: { campaignId: prefix, topic: prefix },
      });
      ids.push(p.id);
      const j = await prisma.workflowJob.create({
        data: { kind: "content", entityId: p.id, status: "RUNNING" },
      });
      await prisma.post.update({
        where: { id: p.id },
        data: { latestJobId: j.id },
      });
      const payload = {
        jobId: j.id,
        entityId: p.id,
        ok: true,
        result: {
          headline: "Tiêu đề thử",
          content: "Nội dung kiểm tra",
          imagePrompt: "A reusable cup on a desk",
          bannerUrl: "https://example.invalid/banner.png",
          risk: "LOW",
          review,
        },
      };
      const internal = { "x-comm-token": process.env.N8N_CALLBACK_SECRET };
      assert.equal(
        (await req("/api/webhooks/content", "POST", payload)).status,
        401,
      );
      assert.equal(
        (await req("/api/webhooks/content", "POST", payload, internal)).status,
        200,
      );
      assert.equal(
        (await prisma.post.findUnique({ where: { id: p.id } })).status,
        "PENDING_APPROVAL",
      );
      const partialJob = await prisma.workflowJob.findUnique({ where: { id: j.id } });
      assert.equal(partialJob.status, "PARTIAL");
      assert.ok(partialJob.error);
      const partialPost = await prisma.post.findUnique({ where: { id: p.id } });
      assert.equal(partialPost.headline, payload.result.headline);
      assert.equal(partialPost.content, payload.result.content);
      assert.equal(partialPost.approvedBy, null);
      assert.equal(
        (
          await req(
            "/api/posts/" + p.id + "/approve",
            "PATCH",
            {},
            { Cookie: cookies.EDITOR },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/api/webhooks/content",
            "POST",
            { ...payload, result: { ...payload.result, content: "Overwrite" } },
            internal,
          )
        ).body.ignored,
        true,
      );
      assert.equal(
        (await prisma.post.findUnique({ where: { id: p.id } })).content,
        "Nội dung kiểm tra",
      );
      const stalePost = await prisma.post.create({
        data: { campaignId: prefix, topic: "Stale callback test" },
      });
      ids.push(stalePost.id);
      const oldJob = await prisma.workflowJob.create({
        data: { kind: "content", entityId: stalePost.id, status: "RUNNING" },
      });
      const newJob = await prisma.workflowJob.create({
        data: { kind: "content", entityId: stalePost.id, status: "QUEUED" },
      });
      await prisma.post.update({
        where: { id: stalePost.id },
        data: { latestJobId: newJob.id },
      });
      const staleResponse = await req(
        "/api/webhooks/content",
        "POST",
        { ...payload, jobId: oldJob.id, entityId: stalePost.id },
        internal,
      );
      assert.equal(staleResponse.body.ignored, true);
      assert.equal(
        (await prisma.post.findUnique({ where: { id: stalePost.id } })).status,
        "DRAFT",
      );
      assert.equal(
        (await prisma.workflowJob.findUnique({ where: { id: oldJob.id } }))
          .status,
        "CANCELLED",
      );
      await req(
        "/api/webhooks/content",
        "POST",
        {
          jobId: newJob.id,
          entityId: stalePost.id,
          ok: false,
          error: "Quota test",
        },
        internal,
      );
      assert.equal(
        (await prisma.workflowJob.findUnique({ where: { id: newJob.id } }))
          .status,
        "FAILED",
      );
      // Exercise the real staging endpoint and callback without external AI or downloads.
      const fixtureBytes = Buffer.concat([
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9N8AAAAASUVORK5CYII=",
          "base64",
        ),
        Buffer.alloc(256),
      ]);
      await fs.mkdir(mediaDir, { recursive: true });
      await fs.writeFile(mediaDir + "/" + fixtureName, fixtureBytes);
      const visualSettings = await prisma.settings.findUnique({
        where: { id: "default" },
      });
      for (const verdict of ["PASS", "FAIL", "UNCERTAIN", "WRONG_HASH"]) {
        const vp = await prisma.post.create({
          data: {
            campaignId: prefix,
            topic: prefix,
            status: "PENDING_APPROVAL",
            headline: payload.result.headline,
            content: payload.result.content,
            imagePrompt: payload.result.imagePrompt,
            bannerUrl: "/media/" + fixtureName,
          },
        });
        ids.push(vp.id);
        const vj = await prisma.workflowJob.create({
          data: {
            kind: "content",
            entityId: vp.id,
            status: "RUNNING",
            mode: "REVIEW_IMAGE",
          },
        });
        await prisma.post.update({
          where: { id: vp.id },
          data: { latestJobId: vj.id },
        });
        const stagedRequest = {
          jobId: vj.id,
          entityId: vp.id,
          result: payload.result,
        };
        assert.equal(
          (await req("/api/webhooks/prepare-image", "POST", stagedRequest))
            .status,
          401,
        );
        const stage = await req(
          "/api/webhooks/prepare-image",
          "POST",
          stagedRequest,
          internal,
        );
        assert.equal(stage.status, 200, JSON.stringify(stage.body));
        assert.equal(
          stage.body.inlineData.data,
          fixtureBytes.toString("base64"),
        );
        assert.equal(
          (
            await req(
              "/api/posts/" + vp.id + "/approve",
              "PATCH",
              {},
              { Cookie: cookies.ADMIN },
            )
          ).status,
          409,
        );
        const imageReview = {
          verdict: verdict === "WRONG_HASH" ? "PASS" : verdict,
          subjectMatches: true,
          actionMatches: true,
          detailsMatch: true,
          contextMatches: true,
          confidence: 0.95,
          observed: "Ảnh fixture kiểm thử API",
          reason: "Kết quả mô phỏng kiểm thử",
          missingElements: [],
          imageHash:
            verdict === "WRONG_HASH" ? "wrong" : stage.body.image.sha256,
        };
        const callback = await req(
          "/api/webhooks/content",
          "POST",
          {
            ...stagedRequest,
            ok: true,
            result: { ...payload.result, imageReview },
          },
          internal,
        );
        assert.equal(callback.status, 200, JSON.stringify(callback.body));
        const checked = await prisma.post.findUnique({ where: { id: vp.id } });
        assert.equal(
          checked.status,
          verdict === "PASS" && visualSettings?.mode === "CONDITIONAL"
            ? "APPROVED"
            : "PENDING_APPROVAL",
        );
        assert.equal(
          checked.imageReviewStatus,
          verdict === "WRONG_HASH" ? "ERROR" : verdict,
        );
        const visualJob = await prisma.workflowJob.findUnique({ where: { id: vj.id } });
        assert.equal(visualJob.status, verdict === "WRONG_HASH" ? "PARTIAL" : "SUCCEEDED");
        assert.equal(checked.content, payload.result.content);
        assert.equal(checked.headline, payload.result.headline);
      }
      await prisma.post.update({
        where: { id: p.id },
        data: { contentReview: review },
      });
      const approve = {
        headline: "Đã hiệu đính",
        content: "Bài đã duyệt",
        bannerUrl: "https://example.invalid/manual.jpg",
      };
      const approvals = await Promise.all([
        req("/api/posts/" + p.id + "/approve", "PATCH", approve, {
          Cookie: cookies.REVIEWER,
        }),
        req("/api/posts/" + p.id + "/approve", "PATCH", approve, {
          Cookie: cookies.REVIEWER,
        }),
      ]);
      assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 409]);
      assert.equal(
        (await prisma.post.findUnique({ where: { id: p.id } })).contentReview,
        null,
      );
      assert.equal(
        (
          await req(
            "/api/posts/" + p.id + "/regenerate",
            "POST",
            {},
            { Cookie: cookies.ADMIN },
          )
        ).status,
        409,
      );
      await prisma.post.update({
        where: { id: p.id },
        data: { status: "CRISIS_ALERT" },
      });
      assert.equal(
        (
          await req(
            "/api/posts/" + p.id + "/review-image",
            "POST",
            {},
            { Cookie: cookies.ADMIN },
          )
        ).status,
        409,
      );
      await prisma.post.update({
        where: { id: p.id },
        data: { status: "APPROVED" },
      });
      const c = await prisma.comment.create({
        data: { postId: p.id, author: prefix, text: "Rất thích thiết kế này!" },
      });
      ids.push(c.id);
      const cj = await prisma.workflowJob.create({
        data: { kind: "community", entityId: c.id, status: "RUNNING", mode: "V2" },
      });
      await prisma.comment.update({
        where: { id: c.id },
        data: { latestJobId: cj.id },
      });
      const cr = await req(
        "/api/webhooks/community",
        "POST",
        {
          jobId: cj.id,
          entityId: c.id,
          ok: true,
          result: {
            issueType: "COMPLIMENT",
            urgency: "LOW",
            sentiment: "POSITIVE",
            risk: "LOW",
            sensitive: false,
            reply: "Cảm ơn bạn!",
            reason: "Bình luận tích cực",
            review,
          },
        },
        internal,
      );
      assert.equal(cr.status, 200, JSON.stringify(cr.body));
      const saved = await prisma.comment.findUnique({ where: { id: c.id } });
      assert.equal(saved.analysisStatus, "DONE");
      assert.equal(saved.analysisMeta.issueType, "COMPLIMENT");
      const settings = await prisma.settings.findUnique({
        where: { id: "default" },
      });
      assert.equal(
        saved.replyStatus,
        settings.mode === "CONDITIONAL" ? "APPROVED" : "PENDING",
      );
      const alert = await prisma.alert.create({
        data: { postId: p.id, trigger: "Test only", evidence: [{ id: c.id, text: c.text }] },
      });
      ids.push(alert.id);
      const aj = await prisma.workflowJob.create({
        data: { kind: "crisis", entityId: alert.id, status: "RUNNING", mode: "V2" },
      });
      await prisma.alert.update({
        where: { id: alert.id },
        data: { latestJobId: aj.id },
      });
      assert.equal(
        (
          await req(
            "/api/webhooks/crisis",
            "POST",
            {
              jobId: aj.id,
              entityId: alert.id,
              ok: true,
              result: {
                evidenceIds: [c.id],
                verificationSteps: ["Đối chiếu phản ánh"],
                summary: "Cần xác minh",
                statement: "Chúng tôi tiếp nhận phản ánh.",
                actions: ["Xác minh thông tin"],
                review,
              },
            },
            internal,
          )
        ).status,
        200,
      );
      assert.equal(
        (await prisma.alert.findUnique({ where: { id: alert.id } })).status,
        "PENDING_APPROVAL",
      );
      assert.equal(
        (
          await req(
            "/api/alerts/" + alert.id + "/approve",
            "PATCH",
            { statement: "Thông cáo đã kiểm tra." },
            { Cookie: cookies.EDITOR },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/api/alerts/" + alert.id + "/approve",
            "PATCH",
            { statement: "Thông cáo đã kiểm tra." },
            { Cookie: cookies.REVIEWER },
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await req(
            "/api/webhooks/crisis",
            "POST",
            { jobId: aj.id, entityId: alert.id, ok: false },
            internal,
          )
        ).body.ignored,
        true,
      );
      assert.equal(
        (await prisma.alert.findUnique({ where: { id: alert.id } })).statement,
        "Thông cáo đã kiểm tra.",
      );
      assert.equal(
        (await req("/api/auth/logout", "POST", {}, { Cookie: cookies.EDITOR }))
          .status,
        200,
      );
      assert.equal(
        (
          await req("/api/auth/me", "GET", undefined, {
            Cookie: cookies.EDITOR,
          })
        ).status,
        401,
      );
    } finally {
      await fs.rm(mediaDir + "/" + fixtureName, { force: true });
      if (server) await new Promise((resolve) => server.close(resolve));
      await prisma.auditLog.deleteMany({
        where: {
          OR: [{ entityId: { in: ids } }, { actor: { contains: prefix } }],
        },
      });
      await prisma.workflowJob.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.post.deleteMany({ where: { campaignId: prefix } });
      await prisma.campaign.deleteMany({ where: { id: prefix } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
  },
);
