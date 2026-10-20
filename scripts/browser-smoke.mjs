// Local verification tooling lives in .local and is not an application dependency.
import { chromium } from "../.local/browser-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
const accounts = JSON.parse(fs.readFileSync(".local/demo-accounts.json"));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:3000/login");
const admin = accounts.find((a) => a.role === "ADMIN");
await page.getByLabel("Email", { exact: true }).fill(admin.email);
await page.getByLabel("Mật khẩu", { exact: true }).fill(admin.password);
await page.getByRole("button", { name: "Vào không gian làm việc" }).click();
await page.getByRole("heading", { name: "Tổng quan truyền thông" }).waitFor();
for (const [route, title] of [
  ["/", "Tổng quan truyền thông"],
  ["/campaigns", "Chiến dịch"],
  ["/studio", "Content Studio"],
  ["/planning", "Kế hoạch & lịch đăng"],
  ["/insights", "Chuyển thể & báo cáo"],
  ["/approval", "Hàng đợi duyệt"],
  ["/simulator", "Feed & bình luận"],
  ["/alerts", "Cảnh báo rủi ro"],
  ["/settings", "Cài đặt xử lý"],
]) {
  await page.goto("http://localhost:3000" + route);
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
  await page.waitForTimeout(600);
  if (await page.locator(".notice[role=alert]").count())
    throw new Error(
      "Page error on " +
        route +
        ": " +
        (await page.locator(".notice[role=alert]").first().textContent()),
    );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (overflow) throw new Error("Desktop overflow " + route);
  console.log("Desktop OK", route);
}
await page.goto("http://localhost:3000");
await page.getByRole("heading", { name: "Tổng quan truyền thông" }).waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: ".local/dashboard-desktop.png", fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
for (const route of [
  "/",
  "/studio",
  "/planning",
  "/insights",
  "/approval",
  "/simulator",
  "/alerts",
  "/settings",
]) {
  await page.goto("http://localhost:3000" + route);
  await page.locator("h1").waitFor();
  await page.waitForTimeout(250);
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
  )
    throw new Error("Mobile overflow " + route);
  console.log("Mobile OK", route);
}
await page.screenshot({ path: ".local/settings-mobile.png", fullPage: true });
await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
await page.getByRole("heading", { name: "Chào mừng trở lại" }).waitFor();
for (const role of ["EDITOR", "REVIEWER"]) {
  const account = accounts.find((a) => a.role === role);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Vào không gian làm việc" }).click();
  await page.getByRole("heading", { name: "Tổng quan truyền thông" }).waitFor();
  await page.goto("http://localhost:3000/settings");
  await page.getByRole("heading", { name: "Cài đặt xử lý" }).waitFor();
  await page.getByLabel("Chế độ", { exact: true }).waitFor();
  if (!(await page.getByLabel("Chế độ", { exact: true }).isDisabled()))
    throw new Error("Settings role gate failed " + role);
  if (role === "REVIEWER") {
    await page.goto("http://localhost:3000/studio");
    await page
      .getByText("Tài khoản người duyệt có thể xem kết quả.", { exact: false })
      .waitFor();
  }
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.getByRole("heading", { name: "Chào mừng trở lại" }).waitFor();
  console.log("Role OK", role);
}
await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
console.log("Browser smoke passed; screenshots saved privately.");
