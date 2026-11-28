/* Service Worker — مكتب ريزونكس ونهار
 * استراتيجية آمنة لا تعيق التحديثات المستقبلية:
 * - التخزين المؤقت للطلب الأول (fetch) على شبكة أولاً مع نسخة احتياطية، لا حجز مسبق لنسخة بناء متقادمة.
 * - أي طلب تنقّل (HTML) يمر دائماً عبر الشبكة، ومع فشلها تُعرض آخر نسخة مخزنة.
 * - الأصول الثابتة (الصور والأيقونات): كاش أولاً مع تحديث خلفي (stale-while-revalidate).
 * - تجاوز كامل لطلبات API والنطاقات الخارجية.
 */
const VERSION = "v1";
const RUNTIME_CACHE = `reasonix-runtime-${VERSION}`;

self.addEventListener("install", (event) => {
  // لا precache لقائمة بناء صلبة؛ انتظار التنشيط يُترك للسيطرة التدريجية الآمنة.
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("reasonix-") && k !== RUNTIME_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // لا تتدخل في API ولا النطاقات الأخرى
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // التنقل بين الصفحات: شبكة أولاً، ونسخة احتياطية عند انقطاع الاتصال
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => { });
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(RUNTIME_CACHE);
          return (await cache.match(req)) || (await cache.match("/")) || Response.error();
        }),
    );
    return;
  }

  // الأصول الثابتة: كاش أولاً + تحديث خلفي
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/images/")) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone()).catch(() => { });
            return res;
          })
          .catch(() => cached || Response.error());
        return cached || fetchPromise;
      }),
    );
  }
});
