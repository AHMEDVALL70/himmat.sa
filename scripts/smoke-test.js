#!/usr/bin/env node
/**
 * scripts/smoke-test.js — اختبار التراجع الثابت (2026-09-28)
 * ============================================================================
 * القاعدة ٢-أ: **قبل أي دفع لـGitHub** يعدّل index.html أو js/ أو css/،
 * شغّل هذا الاختبار. لو فشل أي فحص (رمز خروج ≠ 0)، لا تدفع.
 *
 * ليش موجود: 2026-09-28 اكتُشف إن المؤشر يتوقف بصمت لحي غير موجود بالقائمة
 * (حارس من 2026-09-24) — ما انمسك وقتها لأن الاختبارات كانت على الشي الجديد
 * بس، مو على اللي كان شغّال. هذا الملف يفحص المسارات الأساسية كلها بكل مرة.
 *
 * كيف يشتغل: يحمّل index.html (وصفحات الأقسام المولّدة) بمتصفح محاكى
 * (jsdom)، ويشغّل js/site.js الحقيقي، مع Supabase وهمي يرجّع بيانات
 * **اصطناعية** من scripts/smoke-fixtures.json.
 * ⚠️ البيانات اصطناعية عمداً (أسعار وهمية): المستودع عام، ونشر أسعار رغدان
 *    الحقيقية فيه = إعادة نشر لبياناتهم (راجع قسم رغدان بملف التسليم).
 * ⚠️ المحاكاة ما تغني عن فحص حي بمتصفح حقيقي بعد النشر (القاعدة ٣).
 *
 * التشغيل (خارج المستودع عشان node_modules ما تنرفع بالغلط):
 *   npm install --prefix /tmp/smoke jsdom@24
 *   NODE_PATH=/tmp/smoke/node_modules node scripts/smoke-test.js
 *
 * لإضافة فحص: أضف عنصر لمصفوفة CHECKS تحت. كل فحص يرجّع true أو نص الخطأ.
 * ============================================================================
 */
const fs = require("fs");
const path = require("path");
let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch {
  console.error("jsdom غير مثبّت. شغّل:\n  npm install --prefix /tmp/smoke jsdom@24\n  NODE_PATH=/tmp/smoke/node_modules node scripts/smoke-test.js");
  process.exit(2);
}

const ROOT = path.join(__dirname, "..");
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, "smoke-fixtures.json"), "utf8"));
const SITE_JS = fs.readFileSync(path.join(ROOT, "js", "site.js"), "utf8");

// ---------- Supabase وهمي: أي سلسلة استعلام ترجّع جدول الـfixture كامل ----------
function tables() {
  const cid = Object.fromEntries(FX.cities.map((c) => [c.name, c.id]));
  return {
    cities: FX.cities,
    districts: FX.districts.map((d) => ({ id: d.id, name: d.name, city_id: cid[d.city], cities: { name: d.city } })),
    district_prices: FX.districts.filter((d) => d.price).map((d) => ({
      district_id: d.id, price_per_sqm: d.price, transaction_count: d.count, updated_at: FX.updated_at,
      source: "raghdan.sa", period_note: "fixture", districts: { id: d.id, name: d.name, cities: { name: d.city } },
    })),
    district_price_history: [],
    offers: FX.offers,
  };
}
function fakeSupabase(T) {
  const builder = (t) => {
    const res = { data: T[t] ?? [], error: null };
    const p = new Proxy(function () {}, {
      get(_, k) {
        if (k === "then") return (a, b) => Promise.resolve(res).then(a, b);
        if (k === "single" || k === "maybeSingle") return () => Promise.resolve({ data: (res.data || [])[0] || null, error: null });
        return () => p;
      },
    });
    return p;
  };
  return {
    createClient: () => ({
      from: builder,
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel() {},
    }),
  };
}

function loadPage(file, urlPath) {
  return new Promise((resolve) => {
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, file), "utf8"), {
      runScripts: "outside-only", url: "https://himmat.sa" + urlPath, pretendToBeVisual: true,
    });
    const w = dom.window;
    const errors = [];
    const gtagEvents = [];
    w.addEventListener("error", (e) => errors.push(e.message));
    w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });
    w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
    w.scrollTo = () => {};
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.supabase = fakeSupabase(tables());
    try {
      w.eval(SITE_JS);
    } catch (e) { errors.push("site.js: " + e.message); }
    // نلتقط أحداث Analytics بعد تحميل site.js (index.html يعرّف gtag كدالة عامة)
    w.gtag = (type, name, params) => { if (type === "event") gtagEvents.push({ name, params }); };
    setTimeout(() => resolve({ w, errors, gtagEvents }), 1200);
  });
}

// ---------- أدوات الفحص ----------
function valuate(w, { city, district, type, area, ev }) {
  const $ = (id) => w.document.getElementById(id);
  $("v-city").value = city; $("v-city").dispatchEvent(new w.Event("change"));
  $("v-type").value = type; $("v-area").value = String(area);
  $("res-low").textContent = "—";
  $("v-district").value = district;
  $("v-district").dispatchEvent(new w.Event(ev || "change", { bubbles: true }));
  const hint = $("v-district-hint");
  return { low: $("res-low").textContent, hint: hint && hint.style.display !== "none" ? hint.textContent : "" };
}
function compare(w, city, a, b) {
  const $ = (id) => w.document.getElementById(id);
  $("cmp-city").value = city; $("cmp-city").dispatchEvent(new w.Event("change"));
  $("cmp-district-a").value = a; $("cmp-district-b").value = b;
  $("cmp-district-b").dispatchEvent(new w.Event("input"));
  return $("cmp-results").style.display === "none" ? "hidden" : $("cmp-summary").textContent;
}
const C = FX.test_city;
const V = { city: C, type: FX.test_type, area: 733 };

// ---------- الفحوصات ----------
const CHECKS = [
  ["الصفحات تحمّل بدون أخطاء JS", async (P) => {
    for (const [name, p] of Object.entries(P)) if (p.errors.length) return `${name}: ${p.errors.join(" | ")}`;
    return true;
  }],
  ["المؤشر: حي له سعر يحسب", async ({ val }) => {
    const r = valuate(val.w, { ...V, district: FX.known_district });
    return r.low !== "—" || `النتيجة "—" لحي ${FX.known_district}`;
  }],
  ["المؤشر: بدون حي يحسب بمتوسط المدينة", async ({ val }) => {
    const r = valuate(val.w, { ...V, district: "" });
    return r.low !== "—" || "النتيجة \"—\" بدون حي";
  }],
  ["المؤشر: كل اسم بديل يعطي نفس نتيجة حيّه الرسمي + سطر توضيح", async ({ val }) => {
    for (const [alias, canonical] of FX.aliases) {
      const a = valuate(val.w, { ...V, district: alias });
      const c = valuate(val.w, { ...V, district: canonical });
      if (a.low === "—" || a.low !== c.low) return `${alias}=${a.low} لكن ${canonical}=${c.low}`;
      if (!a.hint.includes(canonical)) return `سطر التوضيح لـ${alias} ما فيه ${canonical}: "${a.hint}"`;
    }
    return true;
  }],
  ["المؤشر: كتابة ناقصة = صمت (بدون نتيجة ولا رسالة)", async ({ val }) => {
    const r = valuate(val.w, { ...V, district: FX.partial_input, ev: "input" });
    return (r.low === "—" && r.hint === "") || `low=${r.low} hint="${r.hint}"`;
  }],
  ["المؤشر: حي غير موجود بعد انتهاء الكتابة = رسالة تحذير", async ({ val }) => {
    const r = valuate(val.w, { ...V, district: "حي_غير_موجود_للاختبار", ev: "change" });
    return (r.low === "—" && r.hint.includes("غير موجود")) || `low=${r.low} hint="${r.hint}"`;
  }],
  ["مقارنة الأحياء: حيّين مختلفين تعرض نتيجة", async ({ val }) => {
    const r = compare(val.w, C, FX.known_district, FX.second_district);
    return r !== "hidden" || "المقارنة مخفية";
  }],
  ["مقارنة الأحياء: اسم بديل يطابق حيّه الرسمي", async ({ val }) => {
    const [alias, canonical] = FX.aliases[0];
    const a = compare(val.w, C, alias, FX.known_district);
    const c = compare(val.w, C, canonical, FX.known_district);
    return (a !== "hidden" && a === c) || `alias="${a}" canonical="${c}"`;
  }],
  ["العروض: العرض المنشور يظهر بالقائمة", async ({ offers }) => {
    const grid = offers.w.document.getElementById("offers-grid");
    return (grid && grid.textContent.includes(FX.offers[0].title)) || "عنوان العرض غير موجود بـ#offers-grid";
  }],
  ["عنوان التبويب: /offers يعطي عنوان قسم العروض", async ({ offers }) => {
    return offers.w.document.title.startsWith("عروض عقارية") || `العنوان: "${offers.w.document.title}"`;
  }],
  ["Analytics: ضغطة زر واتساب العائم = whatsapp_click", async ({ home }) => {
    const a = home.w.document.getElementById("whatsapp-float");
    if (!a) return "#whatsapp-float غير موجود";
    a.addEventListener("click", (e) => e.preventDefault());
    a.dispatchEvent(new home.w.MouseEvent("click", { bubbles: true }));
    const ev = home.gtagEvents.find((e) => e.name === "whatsapp_click");
    return (ev && ev.params.link_location === "float") || `الأحداث: ${JSON.stringify(home.gtagEvents)}`;
  }],
];

(async () => {
  const P = {
    home: await loadPage("index.html", "/"),
    val: await loadPage(fs.existsSync(path.join(ROOT, "valuation.html")) ? "valuation.html" : "index.html", "/valuation"),
    offers: await loadPage(fs.existsSync(path.join(ROOT, "offers.html")) ? "offers.html" : "index.html", "/offers"),
  };
  let failed = 0;
  for (const [name, fn] of CHECKS) {
    let r;
    try { r = await fn(P); } catch (e) { r = "استثناء: " + e.message; }
    if (r === true) console.log("✅ " + name);
    else { failed++; console.log("❌ " + name + "\n     ↳ " + r); }
  }
  console.log(failed ? `\n${failed} فحص فشل — لا تدفع.` : `\nكل الفحوصات (${CHECKS.length}) نجحت.`);
  process.exit(failed ? 1 : 0);
})();
