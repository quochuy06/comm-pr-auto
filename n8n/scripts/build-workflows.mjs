import fs from "node:fs";
import { buildHoang } from "./members/hoang.mjs";
import { buildHoangG1 } from "./members/hoang-g1.mjs";
buildHoang();
buildHoangG1();
for (const member of ["huy", "bao", "phuc"]) {
  const file = new URL(`./members/${member}.mjs`, import.meta.url);
  if (fs.existsSync(file)) (await import(file.href)).build();
}
