import { buildWorkflow, writeWorkflow } from "../workflow-builder.mjs";
import { specs } from "./legacy-specs.mjs";
function subset(workflow, names) {
  const w = structuredClone(workflow);
  w.nodes = w.nodes.filter(n => names.has(n.name));
  w.connections = Object.fromEntries(Object.entries(w.connections)
    .filter(([name]) => names.has(name)).map(([name, c]) => [name, {
      main: c.main.map(group => group.filter(edge => names.has(edge.node))),
    }]));
  return w;
}
const connect = (w, from, to) => w.connections[from] = { main: [[{ node: to, type: "main", index: 0 }]] };
export function buildHoang() {
  const original = buildWorkflow("content", specs.content);
  const textNames = new Set(original.nodes.map(n => n.name).filter(n => !/^03[ab] |^14[a-e] /.test(n)));
  const text = subset(original, textNames);
  text.name = "Hoàng · 01 · Tạo và kiểm tra văn bản PR";
  connect(text, "03 Limit context", "04 Build generation prompt");
  connect(text, "14 Prepare deliverable", "15 Build authenticated callback");
  text.nodes.find(n => n.name === "14 Prepare deliverable").parameters.jsCode = "if($json.ok){$json.result.headline=$json.result.headline.trim();$json.result.content=$json.result.content.trim();}return {json:$json};";
  text.nodes.find(n => n.name === "16 Persist result in backend").parameters.url = "http://172.17.0.1:5000/api/webhooks/content-text";
  writeWorkflow("hoang-01-content.json", text);
  const imageNames = new Set(original.nodes.map(n => n.name).filter(n => /^0[123] |^03b |^14 |^14[a-e] |^1[567] /.test(n)));
  const image = subset(original, imageNames);
  image.name = "Hoàng · 02 · Tạo và kiểm tra ảnh";
  const webhook = image.nodes[0];
  webhook.parameters.path = "generate-image";
  webhook.webhookId = "comm-pr-image";
  connect(image, "03 Limit context", "03b Preserve existing text");
  writeWorkflow("hoang-02-image.json", image);
}
