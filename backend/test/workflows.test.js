import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
for (const file of ["agent-3-community.json", "agent-4-crisis.json"]) {
  const w = JSON.parse(fs.readFileSync("../n8n/workflows/" + file));
  test(`${file}: connected nodes, credentials, code syntax and failure branch`, () => {
    assert.ok(w.nodes.length >= 12);
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
