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
 * ⚠️ البيانات اصطناعية عمداً (أسعار وهمية) — الاختبار يفحص السلوك، مو الأرقام.
 *    (2026-09-29: مصدر الأسعار = بيانات وزارة العدل المفتوحة.)
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
      source: "moj.gov.sa", period_note: FX.period_note, districts: { id: d.id, name: d.name, cities: { name: d.city } },
    })),
    district_price_history: [],
    offers: FX.offers,
    __rpc: [],
    __invoke: [],
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
      rpc: (name, args) => { T.__rpc.push({ name, args }); return Promise.resolve({ data: null, error: null }); },
      functions: { invoke: (name, opts) => { T.__invoke.push({ name, opts }); return Promise.resolve({ data: { ok: true }, error: null }); } },
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
    const opened = [];
    w.open = (u) => { opened.push(String(u)); return {}; };
    w.print = () => {};
    w.HTMLElement.prototype.scrollIntoView = function () {};
    const T = tables();
    w.supabase = fakeSupabase(T);
    try {
      w.eval(SITE_JS);
    } catch (e) { errors.push("site.js: " + e.message); }
    // نلتقط أحداث Analytics بعد تحميل site.js (index.html يعرّف gtag كدالة عامة)
    w.gtag = (type, name, params) => { if (type === "event") gtagEvents.push({ name, params }); };
    setTimeout(() => resolve({ w, errors, gtagEvents, rpc: T.__rpc, invoke: T.__invoke, opened }), 1200);
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
  ["مصدر السعر: وزارة العدل + فترة الربع من القاعدة، وصفر ذكر للمصدر القديم", async ({ val }) => {
    valuate(val.w, { ...V, district: FX.known_district });
    const src = val.w.document.getElementById("v-price-source").textContent;
    if (!src.includes("وزارة العدل")) return `ملاحظة المصدر ما فيها وزارة العدل: "${src}"`;
    if (!src.includes("2025-Q2 إلى 2026-Q1")) return `الفترة ما انقرأت من period_note: "${src}"`;
    // اسم المصدر القديم مكتوب بترميز يونيكود عمداً — عشان حتى هالملف ما يحتويه كنص
    if (new RegExp("\u0631\u063a\u062f\u0627\u0646|\u0631\u0627\u063a\u062f\u0627\u0646|r[a]ghdan", "i").test(val.w.document.body.textContent)) return "اسم المصدر القديم موجود بالصفحة";
    return true;
  }],
  ["المؤشر: حي بالقائمة بدون صفقات كافية = بدون أرقام + رابط واتساب", async ({ val }) => {
    const r = valuate(val.w, { ...V, district: FX.no_data_district });
    const el = val.w.document.getElementById("v-price-source");
    const link = el.querySelector('a[href^="https://wa.me/966"]');
    if (r.low !== "—") return `ظهر رقم "${r.low}" لحي بدون صفقات`;
    if (!el.textContent.includes("ما فيه صفقات كافية")) return `الرسالة: "${el.textContent}"`;
    if (!link || !decodeURIComponent(link.href).includes(FX.no_data_district)) return "رابط واتساب ناقص أو ما فيه اسم الحي";
    // بعدها حي له سعر يرجع يحسب طبيعي
    const k = valuate(val.w, { ...V, district: FX.known_district });
    return k.low !== "—" || "بعد حي بدون صفقات، الحي المعروف ما رجع يحسب";
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
  ["كل طلبات العروض/العقارات العامة تستثني المحذوف (deleted_at)", async () => {
    // 2026-09-29: المدير المسجّل دخول كان يشوف العروض المحذوفة بالموقع (RLS تسمح له)
    const bad = [];
    const re = /from\((['"])(offers|properties)\1\)[\s\S]*?;/g;
    let m;
    while ((m = re.exec(SITE_JS))) {
      if (/\.(insert|update|delete|upsert)\(/.test(m[0])) continue;
      if (!/\.is\((['"])deleted_at\1,\s*null\)/.test(m[0])) bad.push(SITE_JS.slice(0, m.index).split("\n").length);
    }
    return bad.length === 0 || `طلبات بدون فلتر المحذوف بالأسطر: ${bad.join("، ")}`;
  }],
  ["العقود: سكني بدون ضريبة، وتجاري ١٥٪ بس لو المؤجر مسجّل", async ({ contracts }) => {
    const w = contracts.w, d = w.document, $ = (id) => d.getElementById(id);
    const set = (id, val) => { $(id).value = val; };
    Object.entries({ "c-lessor-name": "مؤجر", "c-lessor-id": "1000000000", "c-lessor-phone": "0500000000",
      "c-lessor-nationality": "سعودي", "c-lessee-name": "مستأجر", "c-lessee-id": "2000000000", "c-lessee-phone": "0500000001",
      "c-lessee-nationality": "سعودي", "c-district": "قباء", "c-unit-type": "شقة في عمارة", "c-area": "100",
      "c-deed-number": "1", "c-deed-date": "2020-01-01", "c-start": "2026-10-01", "c-end": "2027-10-01", "c-rent": "25000" })
      .forEach(([k, v]) => set(k, v));
    set("c-frequency", "4");
    const tab = (name) => d.querySelector(`.tabs button[data-tab="${name}"]`).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const gen = async () => { $("btn-generate-contract").dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await new Promise(r => setTimeout(r, 50)); };
    const calls = contracts.rpc;
    tab("residential"); await gen();
    let last = calls.filter(c => c.name === "create_contract_with_schedule").pop();
    if (!last) return `ما انرسل طلب حفظ العقد — الرسالة: "${$("contract-msg").textContent}"`;
    if (last.args.p_lessor_vat_registered !== false) return "العقد السكني انرسل مع ضريبة";
    if (!$("contract-text").textContent.includes("معفى")) return "نص العقد السكني ما فيه «معفى»";
    tab("commercial");
    if ($("c-vat-wrap").classList.contains("hide")) return "خانة الضريبة ما ظهرت بالعقد التجاري";
    await gen(); last = calls.filter(c => c.name === "create_contract_with_schedule").pop();
    if (last.args.p_lessor_vat_registered !== false) return "العقد التجاري بالافتراضي (لا) انرسل مع ضريبة";
    set("c-vat-registered", "1"); await gen(); last = calls.filter(c => c.name === "create_contract_with_schedule").pop();
    if (last.args.p_lessor_vat_registered !== true) return "العقد التجاري المسجّل ما انرسل مع ضريبة";
    if (!$("contract-text").textContent.includes("28,750")) return `نص العقد التجاري: "${$("contract-text").textContent.split("\n").slice(-2).join(" | ")}"`;
    tab("residential");
    if (!$("c-vat-wrap").classList.contains("hide") || $("c-vat-registered").value !== "0") return "الرجوع للسكني ما صفّر خانة الضريبة";
    return true;
  }],
  ["العقود: زر الإرسال وحده = حفظ + إيميل للفريق + واتساب (بدون طباعة)", async ({ contracts }) => {
    // 2026-09-30: قبل، واتساب والإيميل كانوا بزر الطباعة بس ورسالة التأكيد تقول «أُرسل»
    const w = contracts.w, $ = (id) => w.document.getElementById(id);
    const o0 = contracts.opened.length, i0 = contracts.invoke.length;
    $("btn-generate-contract").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    const wa = contracts.opened.slice(o0).find(u => u.startsWith("https://wa.me/966530500906?text="));
    if (!wa) return `واتساب ما انفتح من زر الإرسال (فُتح: ${JSON.stringify(contracts.opened.slice(o0))})`;
    const waText = decodeURIComponent(wa.split("?text=")[1]);
    if (!waText.includes("*المؤجر*") || !waText.includes("*المستأجر*") || !waText.includes("ضريبة القيمة المضافة")) return `رسالة واتساب غير مرتّبة: ${waText.slice(0, 120)}`;
    const inv = contracts.invoke.slice(i0).find(x => x.name === "public-submit" && x.opts.body.type === "contract");
    if (!inv || !inv.opts.body.payload.contract || !inv.opts.body.payload.contract.number) return "إيميل العقد (public-submit) ما انرسل بحقول منفصلة";
    const m = $("contract-msg").textContent;
    if (!m.includes("اضغط «إرسال»") || !m.includes("بالإيميل")) return `رسالة الحالة: "${m}"`;
    const o1 = contracts.opened.length;
    $("btn-print-contract").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    if (contracts.opened.length !== o1) return "زر التنزيل فتح واتساب (المفروض طباعة/حفظ بس)";
    return true;
  }],
  ["المساعد الذكي: المحادثة الطويلة ما تتجاوز حدود الـ Worker (12,000 حرف / 20 رسالة)", async ({ home }) => {
    // 2026-10-01: قبل، لو طالت المحادثة الـ Worker يرد 400 «المحادثة طويلة جداً»
    // وكل سؤال بعدها يرجع للرد الثابت لين يحدّث الزائر الصفحة
    const w = home.w;
    const sent = [];
    const oldFetch = w.fetch;
    // ردود طويلة من «الـ Worker» عشان تكبر المحادثة طبيعياً (assistantHistory
    // متغير let داخل site.js، ما نوصله من برّا — نكبّره بأسئلة فعلية)
    w.fetch = async (u, opts) => {
      if (String(u).endsWith("/chat")) sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ reply: "ر".repeat(1900) }), text: async () => "" };
    };
    try {
      for (let i = 0; i < 7; i++) await w.askAiAssistant("سؤال طويل " + i + " " + "س".repeat(1900));
      sent.length = 0;
      await w.askAiAssistant("كيف اشتري فيلا في حي العيون");
    } finally { w.fetch = oldFetch; }
    if (!sent.length) return "ما انرسل طلب /chat";
    const msgs = sent[0].messages;
    const total = msgs.reduce((s, m) => s + String(m.text || "").length, 0);
    if (msgs.length > 20 || total > 12000) return `انرسل ${msgs.length} رسالة بمجموع ${total} حرف — الـ Worker بيرفضها`;
    if (!String(msgs[msgs.length - 1].text).includes("كيف اشتري فيلا في حي العيون")) return "السؤال الأخير ما انرسل كآخر رسالة";
    if (msgs.length < 2) return "انحذف كل السياق السابق (المفروض يبقى أحدث ما يدخل بالحد)";
    return true;
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
    contracts: await loadPage(fs.existsSync(path.join(ROOT, "contracts.html")) ? "contracts.html" : "index.html", "/contracts"),
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
