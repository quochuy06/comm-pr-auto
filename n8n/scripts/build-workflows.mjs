import fs from "node:fs";
import { buildWorkflow, writeWorkflow } from "./workflow-builder.mjs";
import { specs } from "./members/legacy-specs.mjs";
import { buildHoang } from "./members/hoang.mjs";
buildHoang();
for (const kind of ["community", "crisis"]) writeWorkflow(specs[kind].file, buildWorkflow(kind, specs[kind]));
for (const member of ["huy", "bao", "phuc"]) {
  const file = new URL(`./members/${member}.mjs`, import.meta.url);
  if (fs.existsSync(file)) (await import(file.href)).build();
}
