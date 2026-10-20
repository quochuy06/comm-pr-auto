import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import {
  contentHash,
  normalizeImageReview,
} from "../src/services/imageReview.js";
import {
  fetchBanner,
  loadLocalImage,
  mediaDir,
} from "../src/services/images.js";
const result = {
  headline: "Sửa xe đạp",
  content: "Thợ kiểm tra bánh xe và phanh.",
  imagePrompt: "Mechanic repairing a bicycle",
};
const asset = {
  imageStatus: "VERIFIED",
  sha256: "test-image-hash",
  contentHash: contentHash(result),
};
const review = {
  verdict: "PASS",
  subjectMatches: true,
  actionMatches: true,
  detailsMatch: true,
  contextMatches: true,
  confidence: 0.95,
  observed: "Thợ đang kiểm tra bánh xe đạp.",
  missingElements: [],
  reason: "Đúng chủ thể và hành động.",
  imageHash: asset.sha256,
};
test("Visual approval binds the actual image and exact article, and fails closed", () => {
  assert.equal(normalizeImageReview(review, asset, result).status, "PASS");
  for (const r of [
    undefined,
    { ...review, imageHash: "different" },
    { ...review, confidence: "1" },
    { ...review, observed: "" },
    { ...review, subjectMatches: undefined },
  ])
    assert.equal(normalizeImageReview(r, asset, result).status, "ERROR");
  assert.equal(
    normalizeImageReview(review, asset, { ...result, content: "Đổi sách" })
      .status,
    "ERROR",
  );
  assert.equal(
    normalizeImageReview(review, { ...asset, imageStatus: "FAILED" }, result)
      .status,
    "ERROR",
  );
  for (const r of [
    { ...review, actionMatches: false },
    { ...review, missingElements: ["Không có xe đạp"] },
    { ...review, verdict: "FAIL" },
  ])
    assert.equal(normalizeImageReview(r, asset, result).status, "FAIL");
  for (const r of [
    { ...review, confidence: 0.84 },
    { ...review, verdict: "UNCERTAIN" },
  ])
    assert.equal(normalizeImageReview(r, asset, result).status, "UNCERTAIN");
});
test("Image download retries transient failures, validates bytes and records reasons", async () => {
  const bytes = Buffer.alloc(300);
  bytes[0] = 255;
  bytes[1] = 216;
  let calls = 0,
    saved;
  try {
    saved = await fetchBanner("https://image.pollinations.ai/prompt/test", {
      apiKey: "test-key",
      get: async () => {
        calls++;
        if (calls === 1)
          throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" });
        return { data: bytes };
      },
    });
    assert.equal(calls, 2);
    assert.equal(saved.imageStatus, "VERIFIED");
    const actual = await loadLocalImage(saved.bannerUrl);
    assert.deepEqual(actual.bytes, bytes);
    assert.equal(actual.sha256, saved.sha256);
    const invalid = await fetchBanner(
      "https://image.pollinations.ai/prompt/test",
      { apiKey: "test-key", get: async () => ({ data: Buffer.from("<html>error</html>") }) },
    );
    assert.equal(invalid.imageStatus, "FAILED");
    assert.ok(invalid.imageError);
    calls = 0;
    const timeout = await fetchBanner(
      "https://image.pollinations.ai/prompt/test",
      {
        apiKey: "test-key",
      get: async () => {
          calls++;
          throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" });
        },
      },
    );
    assert.equal(calls, 2);
    assert.match(timeout.imageError, /30 giây/);
    assert.equal(
      (
        await fetchBanner("http://localhost/private", {
          get: () => {
            throw Error("must not fetch");
          },
        })
      ).imageStatus,
      "FAILED",
    );
    await assert.rejects(loadLocalImage("/media/../../.env"));
  } finally {
    if (saved?.bannerUrl)
      await fs.unlink(mediaDir + "/" + saved.bannerUrl.split("/").pop());
  }
});
test("n8n sends actual image bytes to Gemini and preserves text for image-only requests", async () => {
  const w = JSON.parse(
    await fs.readFile("../n8n/workflows/hoang-02-image.json"),
  );
  const run = (name, $json) =>
    vm.runInNewContext(
      `(function(){${w.nodes.find((n) => n.name === name).parameters.jsCode}})()`,
      { $json },
    ).json;
  const generated = run("14c Build visual review", {
    result,
    inlineData: { mime_type: "image/jpeg", data: "aW1hZ2U=" },
  });
  assert.equal(
    generated.requestBody.contents[0].parts[0].inline_data.data,
    "aW1hZ2U=",
  );
  assert.ok(
    generated.requestBody.contents[0].parts[1].text.includes(result.content),
  );
  const preserved = run("03b Preserve existing text", {
    context: { ...result, mode: "IMAGE_ONLY", risk: "LOW" },
  });
  assert.equal(preserved.result.content, result.content);
  assert.equal(preserved.result.headline, result.headline);
  assert.equal(preserved.result.review.safe, false);
});


test("Image provider uses authenticated endpoint, never leaks credentials and fails fast without a key", async () => {
  let calls = 0;
  const missing = await fetchBanner("https://image.pollinations.ai/prompt/tea", {
    apiKey: "",
    get: async () => { calls++; throw Error("Must not call provider"); },
  });
  assert.equal(calls, 0);
  assert.equal(missing.imageStatus, "FAILED");
  assert.match(missing.imageError, /Chưa cấu hình/);
  for (const status of [401, 402, 403, 429, 503]) {
    calls = 0;
    const failed = await fetchBanner("https://image.pollinations.ai/prompt/green%20tea?width=1200&seed=42&key=untrusted&url=http://localhost", {
      apiKey: "private-test-key",
      model: "flux",
      get: async (url, options) => {
        calls++;
        const target = new URL(url);
        assert.equal(target.origin, "https://gen.pollinations.ai");
        assert.equal(target.pathname, "/image/green%20tea");
        assert.equal(target.searchParams.get("width"), "1200");
        assert.equal(target.searchParams.get("seed"), "42");
        assert.equal(target.searchParams.get("model"), "flux");
        assert.equal(target.searchParams.has("key"), false);
        assert.equal(target.searchParams.has("url"), false);
        assert.equal(options.headers.Authorization, "Bearer private-test-key");
        assert.equal(options.maxRedirects, 0);
        throw Object.assign(new Error("private-test-key"), {response:{status}});
      },
    });
    assert.equal(calls, status >= 500 || status === 429 ? 2 : 1);
    assert.equal(failed.imageStatus, "FAILED");
    assert.match(failed.imageError, new RegExp(String(status)));
    assert.equal(JSON.stringify(failed).includes("private-test-key"), false);
  }
  for (const url of ["https://evil.invalid/prompt/tea", "https://gen.pollinations.ai.evil.invalid/image/tea", "https://gen.pollinations.ai/private", "https://user:pass@gen.pollinations.ai/image/tea"]) {
    const failed = await fetchBanner(url, {apiKey:"test-key", get: async () => { throw Error("Must not fetch untrusted URL"); }});
    assert.match(failed.imageError, /không được phép/);
  }
});
