import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hashPassword } from "../src/lib/security.js";
const prisma = new PrismaClient();
try {
  await mkdir("../.local", { recursive: true, mode: 0o700 });
  let accounts;
  try {
    accounts = JSON.parse(
      await readFile("../.local/demo-accounts.json", "utf8"),
    );
  } catch {
    accounts = ["ADMIN", "EDITOR", "REVIEWER"].map((role, i) => ({
      email: `${role.toLowerCase()}@commpr.local`,
      name: ["Quản trị viên", "Biên tập viên", "Người duyệt"][i],
      role,
      password: randomBytes(12).toString("base64url"),
    }));
    await writeFile(
      "../.local/demo-accounts.json",
      JSON.stringify(accounts, null, 2),
      { mode: 0o600 },
    );
  }
  for (const account of accounts)
    await prisma.user.upsert({
      where: { email: account.email },
      create: {
        email: account.email,
        name: account.name,
        role: account.role,
        passwordHash: await hashPassword(account.password),
      },
      update: {},
    });
  await prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  await prisma.campaign.upsert({
    where: { id: "demo-green-life-2026" },
    create: {
      id: "demo-green-life-2026",
      name: "Green Life 2026 · Demo",
      description:
        "Chiến dịch giới thiệu sản phẩm tái sử dụng. Không tự đưa ra chứng nhận, ưu đãi hay số liệu chưa được cung cấp.",
    },
    update: {},
  });
  console.log(
    "Đã bổ sung 3 tài khoản và chiến dịch mẫu; dữ liệu hiện có được giữ nguyên. Thông tin đăng nhập: .local/demo-accounts.json (ngoài Git).",
  );
} finally {
  await prisma.$disconnect();
}
