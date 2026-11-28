export default async function run(page) {
  await page.waitForTimeout(2000);
  const regs = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.map((x) => x.active?.scriptURL || x.installing?.scriptURL || x.waiting?.scriptURL || "pending")));
  const swController = await page.evaluate(() => !!navigator.serviceWorker.controller);
  const btn = await page.evaluate(() => document.body.innerText.includes("تثبيت التطبيق"));
  const promptFired = await page.evaluate(() => new Promise((res) => {
    const h = () => res(true);
    window.addEventListener("beforeinstallprompt", h, { once: true });
    setTimeout(() => res(false), 4000);
  }));
  return { regs, swController, btn, promptFired };
}
