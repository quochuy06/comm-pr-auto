import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
for (const file of fs
  .readdirSync("../n8n/workflows")
  .filter((f) => f.endsWith(".json"))) {
  const w = JSON.parse(fs.readFileSync("../n8n/workflows/" + file));
  test(`${file}: connected nodes, credentials, code syntax and failure branch`, () => {
    const advice = /^phuc-0[3-7]-/.test(file);
    assert.ok(w.nodes.length >= (advice ? 9 : 12));
    const names = new Set(w.nodes.map((n) => n.name));
    assert.equal(names.size, w.nodes.length);
    for (const [source, conn] of Object.entries(w.connections)) {
      assert.ok(names.has(source));
      for (const group of conn.main)
        for (const target of group) assert.ok(names.has(target.node));
    }
    for (const n of w.nodes) {
      if (n.type === "n8n-nodes-base.code")
        new vm.Script(`(function(){${n.parameters.jsCode}\n})`);
      if (n.type === "n8n-nodes-base.httpRequest")
        assert.ok(n.credentials?.httpHeaderAuth);
    }
    if (file === "huy-01-planning.json") {
      // Drive the nodes with n8n-shaped inputs to exercise the decision points.
      const run = (name, input, previous = {}) => {
        const { jsCode } = w.nodes.find(node => node.name === name).parameters;
        const { json } = vm.runInNewContext(`(function(){${jsCode}})()`, {
          $json: input,
          $: node => ({ first: () => ({ json: previous[node] }) }),
        });
        return JSON.parse(JSON.stringify(json));
      };
      const envelope = { jobId: "j", entityId: "e", kind: "planning" };
      const invalid = run("03a Validate planning input", { ...envelope, context: { brief: " ", count: 21 } });
      assert.equal(invalid.inputValid, false);
      assert.match(invalid.error, /brief.*count/);
      assert.equal(w.connections["03b Planning input valid"].main[1][0].node, "15 Build authenticated callback");
      assert.equal(run("15 Build authenticated callback", invalid).ok, false);

      const context = { brief: "Cà phê rang", count: 1, pageId: "123456", campaign: { name: "Mùa hè", description: "x".repeat(1000) } };
      const input = { ...envelope, context, contextText: JSON.stringify(context) };
      assert.equal(run("03a Validate planning input", input).inputValid, true);
      const prepared = run("03c Build knowledge request", input);
      assert.equal(prepared.knowledgeRequest.pageId, "123456");
      assert.ok(prepared.knowledgeRequest.question.startsWith("Cà phê rang"));
      assert.equal(prepared.knowledgeRequest.question.length, 1000);

      const source = { id: "v1", version: 1, title: "Thương hiệu", excerpt: "Cà phê rang tại Đà Nẵng." };
      const lookup = { "03c Build knowledge request": prepared };
      const failedLookup = run("03e Merge knowledge context", { error: { status: 503 } }, lookup);
      assert.deepEqual(failedLookup.knowledge, { knowledgeStatus: "INSUFFICIENT", sources: [], brandVoice: null });
      const malformed = run("03e Merge knowledge context", {
        success: true, data: { status: "SUFFICIENT", sources: [{ id: "v1" }] },
      }, lookup);
      assert.equal(malformed.knowledge.knowledgeStatus, "INSUFFICIENT");
      const approved = run("03e Merge knowledge context", {
        success: true, data: { status: "SUFFICIENT", sources: [null, source], brandVoice: { tone: "ấm áp" } },
      }, lookup);
      const prompt = run("04 Build generation prompt", approved).requestBody.contents[0].parts[0].text;
      assert.match(prompt, /ấm áp/);
      assert.match(prompt, /Cà phê rang tại Đà Nẵng/);
      const modelResult = { summary: "Kế hoạch", items: [{ topic: "Hậu trường rang", targetAudience: "Sinh viên", tone: "Gần gũi", contentKind: "VIDEO", platform: "Facebook", suggestedDate: "Tuần tới", rationale: "Hợp brief" }] };
      const check = result => run("08 Validate generated fields", { ...approved, result });
      assert.equal(check({ ...modelResult, items: [null] }).ok, false);
      assert.equal(check({ ...modelResult, items: [] }).ok, false);
      assert.equal(check({ ...modelResult, items: [{ ...modelResult.items[0], contentKind: "GIF" }] }).ok, false);
      const checked = check(modelResult);
      assert.equal(checked.ok, true);
      assert.match(run("10 Build independent review", checked).requestBody.contents[0].parts[0].text, /Đà Nẵng/);
      const reviewed = run("12 Validate reviewer response", {
        candidates: [{ content: { parts: [{ text: JSON.stringify({ safe: true, grounded: true, risk: "LOW", reason: "Có nguồn" }) }] } }],
      }, { "08 Validate generated fields": checked });
      const deliver = state => run("14 Prepare deliverable", run("13 Apply review decision", state)).result;
      const result = deliver(reviewed);
      assert.equal(result.requiresHuman, true);
      assert.equal(result.autoEligible, undefined);
      assert.deepEqual(result.groundedSources, [{ id: "v1", version: 1 }]);
      assert.equal(result.knowledgeStatus, "SUFFICIENT");
      assert.equal(deliver({ ...reviewed, knowledge: failedLookup.knowledge }).review.grounded, false);
    }
    if (advice) {
      const list = w.nodes.find(n => n.name === "Read next batch");
      const apply = w.nodes.find(n => n.name.startsWith("Apply verified "));
      assert.match(list.parameters.url, /\/advice\/.+\/candidates$/);
      assert.match(apply.parameters.url, /\/advice\/.+\/(classification|route|gate|deliver|escalate)$/);
      assert.equal(w.connections[apply.name].main[1][0].node, "Leave retryable work in its queue");
      assert.equal(w.settings.saveDataSuccessExecution, "none");
      const parser = w.nodes.find(n => n.name === "Fail closed on malformed classification");
      if (parser) {
        const run = (json) => vm.runInNewContext(`(function(){${parser.parameters.jsCode}})()`, {
          $json: json, $: () => ({ item: { json: { id: "verified-id" } } }),
        }).json;
        assert.equal(run({ error: "HTTP 503" }).assessment, null);
        const valid = { risk: "LOW", sensitive: false, intent: "INFORMATION" };
        assert.equal(run({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(valid) }] } }] }).assessment.risk, "LOW");
      }
      return;
    }
    if (w.nodes.some(n => n.name === "08 Publish atomically")) {
      assert.ok(w.nodes.some(n => n.parameters.url?.endsWith("/publish")));
      return;
    }
    if (w.nodes.some((n) => n.name.endsWith("Persist contract callback"))) {
      // G1 contract family (HOANG-WF03/04/05): envelope validation, an error
      // path to the failure result, and a contract-v1 callback with credentials.
      assert.ok(w.nodes.some(n => n.name === "02 Validate identifiers"));
      const persist = w.nodes.find(n => n.name.endsWith("Persist contract callback"));
      assert.ok(persist.parameters.url.endsWith("/api/webhooks/contract-v1"));
      const failure = w.nodes.find(n => n.name.endsWith("Build failure result"));
      assert.ok(failure, "thiếu nhánh lỗi");
      const callback = w.nodes.find(n => n.name.endsWith("Build callback"));
      assert.ok(w.connections[failure.name].main[0].some(e => e.node === callback.name),
        "nhánh lỗi phải đi tới callback");
      const failed = vm.runInNewContext(`(function(){${failure.parameters.jsCode}\n})()`, {
        $json: { fail: { code: "X_TEST", message: "loi" } },
        $: () => ({ first: () => ({ json: { env: {} } }) }),
      }).json;
      assert.equal(failed.status, "FAILED");
      assert.equal(failed.error.code, "X_TEST");
      return;
    }
    if (!w.connections["09 Generation succeeded"]) {
      assert.ok(w.nodes.some(n => n.name === "14d Inspect image with Gemini"));
      assert.ok(w.connections["14b Image available"].main[1].length);
      return;
    }
    assert.ok(
      w.connections["09 Generation succeeded"].main[1].some(
        (t) => t.node === "15 Build authenticated callback",
      ),
    );
    const parse = w.nodes.find((n) => n.name === "07 Parse model JSON")
      .parameters.jsCode;
    assert.equal(
      vm.runInNewContext(`(function(){${parse}})()`, {
        $json: { raw: '```json\n{"headline":"Good"}\n```' },
      }).json.result.headline,
      "Good",
    );
    const extract = w.nodes.find((n) => n.name === "06 Extract model response")
      .parameters.jsCode;
    const validate = w.nodes.find(
      (n) => n.name === "08 Validate generated fields",
    ).parameters.jsCode;
    for (const [error, expected] of [
      [
        { message: "503 - upstream unavailable", code: "ERR_BAD_RESPONSE" },
        /quá tải/,
      ],
      [{ message: "429 - quota" }, /hạn mức/],
      [
        { message: "timeout of 60000ms exceeded", code: "ECONNABORTED" },
        /thời gian chờ/,
      ],
      [{ message: "401 - invalid API key SECRET_SENTINEL" }, /xác thực/],
    ]) {
      const extracted = vm.runInNewContext(`(function(){${extract}})()`, {
        $json: { error },
        $: () => ({ first: () => ({ json: { jobId: "test" } }) }),
      }).json;
      const checked = vm.runInNewContext(`(function(){${validate}})()`, {
        $json: { ...extracted, result: null },
      }).json;
      assert.equal(checked.ok, false);
      assert.match(checked.error, expected);
      assert.ok(!JSON.stringify(checked).includes("SECRET_SENTINEL"));
    }
    assert.ok(!JSON.stringify(w).includes("AIza"));
  });
}
