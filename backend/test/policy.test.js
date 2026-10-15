import test from "node:test";
import assert from "node:assert/strict";
import {
  canAutoApprovePost,
  canAutoReply,
  crisisTrigger,
} from "../src/services/policy.js";
import {
  hashPassword,
  verifyPassword,
  equalSecret,
} from "../src/lib/security.js";
const settings = { mode: "CONDITIONAL" };
const review = { safe: true, grounded: true, risk: "LOW" };
const post = {
  headline: "Chủ đề",
  content: "Nội dung đúng dữ kiện",
  imagePrompt: "A reusable cup on a table",
  risk: "LOW",
  review,
};
test("Only verified, reviewed, low-risk content can auto-publish", () => {
  assert.equal(
    canAutoApprovePost(settings, post, "VERIFIED", { status: "PASS" }),
    true,
  );
  for (const status of [
    "FAIL",
    "UNCERTAIN",
    "ERROR",
    "NOT_REVIEWED",
    undefined,
  ])
    assert.equal(
      canAutoApprovePost(settings, post, "VERIFIED", { status }),
      false,
    );
  assert.equal(canAutoApprovePost(settings, post, "VERIFIED"), false);
  for (const status of ["FAILED", "PENDING", "MANUAL"])
    assert.equal(
      canAutoApprovePost(settings, post, status, { status: "PASS" }),
      false,
    );
  assert.equal(
    canAutoApprovePost({ mode: "MANUAL" }, post, "VERIFIED", {
      status: "PASS",
    }),
    false,
  );
  assert.equal(
    canAutoApprovePost(settings, { ...post, review: null }, "VERIFIED", {
      status: "PASS",
    }),
    false,
  );
  assert.equal(
    canAutoApprovePost(
      settings,
      { ...post, review: { ...review, grounded: false } },
      "VERIFIED",
      { status: "PASS" },
    ),
    false,
  );
  assert.equal(
    canAutoApprovePost(
      settings,
      { ...post, content: "Cam kết khỏi bệnh" },
      "VERIFIED",
      { status: "PASS" },
    ),
    false,
  );
});
test("Sensitive/negative comments and severe wording never auto-reply", () => {
  const comment = {
    review,
    risk: "LOW",
    sentiment: "POSITIVE",
    sensitive: false,
    reply: "Cảm ơn bạn!",
  };
  assert.equal(canAutoReply(settings, comment, "Rất thích sản phẩm"), true);
  for (const sentiment of ["NEGATIVE", "CRISIS"])
    assert.equal(
      canAutoReply(settings, { ...comment, sentiment }, "Không hài lòng"),
      false,
    );
  assert.equal(
    canAutoReply(settings, { ...comment, sensitive: true }, "Câu hỏi riêng"),
    false,
  );
  assert.equal(
    canAutoReply(settings, comment, "Tôi bị ngộ độc phải nhập viện"),
    false,
  );
  assert.equal(canAutoReply({ mode: "MANUAL" }, comment, "Cảm ơn"), false);
});
test("Severe evidence or configured threshold raises crisis signal", () => {
  const normal = {
    text: "Không hài lòng",
    risk: "MEDIUM",
    sentiment: "NEGATIVE",
  };
  assert.equal(crisisTrigger(normal, 2, 3), null);
  assert.ok(crisisTrigger(normal, 3, 3));
  assert.ok(crisisTrigger({ ...normal, text: "Sản phẩm gây cháy nổ" }, 0, 3));
  assert.ok(crisisTrigger({ ...normal, risk: "HIGH" }, 0, 3));
});
test("Passwords are salted and token comparison fails closed", async () => {
  const hash = await hashPassword("a-test-password");
  assert.notEqual(hash, "a-test-password");
  assert.equal(await verifyPassword("a-test-password", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
  assert.equal(equalSecret(undefined, undefined), false);
  assert.equal(equalSecret("abc", "abc"), true);
  assert.equal(equalSecret("abc", "def"), false);
});
