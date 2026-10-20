import fs from "node:fs";
import { buildHoang } from "./members/hoang.mjs";
buildHoang();
for (const member of ["huy", "bao", "phuc"]) {
  const file = new URL(`./members/${member}.mjs`, import.meta.url);
  if (fs.existsSync(file)) (await import(file.href)).build();
}
