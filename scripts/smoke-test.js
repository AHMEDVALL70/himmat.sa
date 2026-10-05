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

function loadPage(file, urlPath, extra = {}) {
  return new Promise((resolve) => {
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, file), "utf8"), {
      runScripts: "outside-only", url: "https://himmat.sa" + urlPath, pretendToBeVisual: true,
    });
    const w = dom.window;
    if (extra.userAgent) Object.defineProperty(w.navigator, "userAgent", { value: extra.userAgent, configurable: true });
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
    // سكربت Turnstile يُحقن عند الحاجة (2026-10-05). jsdom لا يحمّل سكربتات خارجية، فنحاكي «حُجب/فشل»
    // بإطلاق error فوراً (مثل حاجب إعلانات) لتبقى الفحوصات القديمة (بلا ودجت) سريعة. الفحص الخاص
    // بالتحميل الكسول يطفئ هذا بـ w.__noTurnstileErr = true.
    new w.MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.tagName === "SCRIPT" && /challenges\.cloudflare\.com/.test(n.src || "") && !w.__noTurnstileErr) {
          setTimeout(() => n.dispatchEvent(new w.Event("error")), 0);
        }
      }
    }).observe(w.document.head, { childList: true });
    try {
      w.eval(SITE_JS);
    } catch (e) { errors.push("site.js: " + e.message); }
    // نلتقط أحداث Analytics بعد تحميل site.js (index.html يعرّف gtag كدالة عامة)
    w.gtag = (type, name, params) => { if (type === "event") gtagEvents.push({ name, params }); };
    setTimeout(() => resolve({ w, errors, gtagEvents, rpc: T.__rpc, invoke: T.__invoke, opened, T }), 1200);
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
  ["العقود: إيميل الفريق يحمل PDF مرفق + زر المشاركة يظهر لو المتصفح يدعم مشاركة الملفات", async ({ contracts }) => {
    // 2026-10-02: PDF مرفق بإيميل الفريق + زر مشاركة الجوال (Web Share API). المكتبتين مستبدلتين بمزيَّفة هنا
    // (اختبار صحة الـPDF الحقيقي من jsPDF بخطوة منفصلة)
    const w = contracts.w, $ = (id) => w.document.getElementById(id);
    if (!$("btn-share-contract")) return "زر المشاركة غير موجود بالصفحة";
    for (const f of ["lib/html2canvas-1.4.1.min.js", "lib/jspdf-4.2.1.umd.min.js"]) {
      const el = w.document.createElement("script"); el.dataset.lazy = f; w.document.head.appendChild(el);
    }
    const pdfBytes = "%PDF-1.3\n" + "x".repeat(400);
    w.html2canvas = async () => ({ width: 1588, height: 1200, toDataURL: () => "data:image/jpeg;base64,/9j/" });
    let saved = null;
    w.jspdf = { jsPDF: class { addImage() {} addPage() {} save(n) { saved = n; }
      output(t) { return t === "blob" ? new w.Blob([pdfBytes], { type: "application/pdf" }) : "data:application/pdf;filename=g.pdf;base64," + w.btoa(pdfBytes); } } };
    const i0 = contracts.invoke.length;
    $("btn-generate-contract").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const inv = contracts.invoke.slice(i0).find(x => x.name === "public-submit" && x.opts.body.type === "contract");
    if (!inv) return "إيميل العقد ما انرسل";
    const pdf = inv.opts.body.payload.pdf;
    if (!pdf || !/^contract-(HMD-\d+|new)\.pdf$/.test(pdf.name)) return `مرفق PDF مفقود أو اسمه غير آمن: ${JSON.stringify(pdf && pdf.name)}`;
    if (Buffer.from(pdf.base64, "base64").toString("latin1").slice(0, 4) !== "%PDF") return "المرفق ليس PDF صحيح";
    // الزر: مخفي لو المتصفح ما يدعم مشاركة الملفات، ويظهر لو يدعم
    const gen = async () => { $("btn-generate-contract").dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await new Promise(r => setTimeout(r, 60)); };
    $("btn-share-contract").classList.add("hide");
    delete w.navigator.canShare; await gen();
    if (!$("btn-share-contract").classList.contains("hide")) return "زر المشاركة ظهر بمتصفح ما يدعم مشاركة الملفات";
    let shared = null;
    w.navigator.canShare = () => true;
    w.navigator.share = async (d) => { shared = d; };
    await gen();
    if ($("btn-share-contract").classList.contains("hide")) return "زر المشاركة ما ظهر بمتصفح يدعمها";
    $("btn-share-contract").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    if (!shared || !shared.files || shared.files[0].type !== "application/pdf" || !/\.pdf$/.test(shared.files[0].name)) return "زر المشاركة ما استدعى navigator.share بملف PDF";
    // فشل المشاركة (غير الإلغاء) ← ينزّل الملف بدلها
    shared = null; saved = null;
    w.navigator.share = async () => { const e = new Error("x"); e.name = "NotAllowedError"; throw e; };
    $("btn-share-contract").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    if (!saved) return "فشل المشاركة ما رجع للتنزيل";
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
  ["المساعد الذكي: أسئلة الأسعار ما تتجاوز 12,000 حرف حتى مع 569 حي (4 مدن)", async () => {
    // 2026-10-01: بيانات كل الأحياء صارت ≈13,300 حرف فرفضها الـ Worker (400) لأي سؤال أسعار بدون مدينة
    const pg = await loadPage("index.html", "/");
    const cities = [["المدينة المنورة", 175], ["الرياض", 158], ["مكة المكرمة", 112], ["جدة", 124]];
    let n = 0; const rows = [];
    for (const [c, k] of cities) for (let i = 0; i < k; i++, n++) {
      rows.push({ price_per_sqm: 1000 + n * 7, districts: { name: (c === cities[0][0] && i === 0) ? "العيون" : "المنطقة" + n, cities: { name: c } } });
    }
    pg.T.district_prices = rows;
    const w = pg.w, sent = [];
    w.fetch = async (u, opts) => {
      if (String(u).endsWith("/chat")) sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ reply: "تمام" }), text: async () => "" };
    };
    const ask = async (q) => { sent.length = 0; await w.askAiAssistant(q); return sent[0] && sent[0].messages; };
    const size = (ms) => ms.reduce((t, m) => t + String(m.text || "").length, 0);
    const lastOf = (ms) => String(ms[ms.length - 1].text);

    let ms = await ask("كيف اشتري فيلا في حي العيون");
    if (!ms) return "ما انرسل طلب /chat (سؤال حي بدون مدينة)";
    if (size(ms) > 12000 || lastOf(ms).length > 8000) return `سؤال الحي: ${size(ms)} حرف (الـ Worker يرفض فوق 12,000)`;
    if (!lastOf(ms).includes("العيون: ") || !lastOf(ms).includes("بيانات أسعار")) return "سعر حي العيون ما انرسل مع السؤال";
    if (lastOf(ms).includes("المنطقة300")) return "انرسلت أحياء ما لها علاقة بالسؤال";

    ms = await ask("ايش اسعار الاحياء");
    if (!ms) return "ما انرسل طلب /chat (سؤال عام)";
    if (size(ms) > 12000 || lastOf(ms).length > 8000) return `السؤال العام: ${size(ms)} حرف`;
    if (!lastOf(ms).includes("ملخص") || !lastOf(ms).includes("(175 حي)")) return "الملخص (عدد الأحياء + أرخص/أغلى) غير موجود";

    ms = await ask("ايش اسعار الاحياء في جدة");
    if (!ms) return "ما انرسل طلب /chat (سؤال مدينة)";
    if (size(ms) > 12000) return `سؤال المدينة: ${size(ms)} حرف`;
    if (!lastOf(ms).includes("جدة") || lastOf(ms).includes("الرياض")) return "سؤال جدة المفروض يحمل جدة فقط";
    return true;
  }],
  ["المساعد الذكي: يذكر ويعرض عروضنا المطابقة (حي أو مدينة+نوع) ولا يعرض شي عشوائي", async () => {
    // 2026-10-01: سؤال «كيف اشتري فيلا في حي العيون» كان يرد بخطوات عامة والفيلا المنشورة عندنا بنفس الحي ما تنذكر
    const pg = await loadPage("index.html", "/");
    const mk = (n, type, district, city, price, extra = {}) => ({ id: `aaaaaaaa-0000-0000-0000-00000000000${n}`, title: "t", property_type: type, district, city, area_sqm: 400, rooms: 5, price_final: price, price_original: price, is_published: true, is_sold: false, ...extra });
    pg.T.offers = [
      mk(1, "فيلا", "العيون", "المدينة المنورة", 3100000),
      mk(2, "شقة في عمارة", "الروضة", "جدة", 700000),
      mk(3, "فيلا", "قباء", "المدينة المنورة", 1000000, { is_sold: true }),
    ];
    const w = pg.w, sent = [];
    w.fetch = async (u, opts) => {
      if (String(u).endsWith("/chat")) sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ reply: "رد المساعد" }), text: async () => "" };
    };
    const ask = async (q) => {
      sent.length = 0;
      const body = w.document.getElementById("assist-body");
      body.innerHTML = "";
      w.document.getElementById("assist-input").value = q;
      w.document.getElementById("assist-send").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await new Promise(r => setTimeout(r, 1200));
      const last = sent[0] ? String(sent[0].messages[sent[0].messages.length - 1].text) : null;
      return { last, links: [...body.querySelectorAll("a[href^='/offer/']")].map(a => a.getAttribute("href")) };
    };

    let r = await ask("كيف اشتري فيلا في حي العيون");
    if (!r.last) return "ما انرسل طلب /chat (فيلا العيون)";
    if (!r.last.includes("عروضنا المنشورة") || !r.last.includes("3,100,000") || !r.last.includes("فيلا في العيون")) return "فيلا العيون ما انمررت للمساعد مع السؤال";
    if (r.links.length !== 1 || !r.links[0].includes("00000000001")) return `بطاقة فيلا العيون ما ظهرت (الروابط: ${JSON.stringify(r.links)})`;

    r = await ask("كيف اشتري شقة في الروضة");
    if (r.links.length !== 1 || !r.links[0].includes("00000000002")) return `شقة الروضة: الروابط ${JSON.stringify(r.links)}`;

    r = await ask("كيف اشتري فيلا في جدة");
    if (r.last && r.last.includes("عروضنا المنشورة")) return "فيلا جدة: ما عندنا فيلا بجدة لكن انمرر عرض";
    if (r.links.length) return "فيلا جدة: ظهرت بطاقة عشوائية";

    r = await ask("كيف اشتري فيلا");
    if (r.links.length || (r.last && r.last.includes("عروضنا المنشورة"))) return "سؤال عام بدون حي/مدينة: المفروض ما يعرض شي";

    r = await ask("كيف اشتري فيلا في حي قباء");
    if (r.links.length) return "عرض مباع (قباء) ظهر بالبطاقات";
    return true;
  }],
  ["المساعد: أرخص/أغلى حي = 20 صفقة فأكثر + «المدينة» = المنورة + عدد الصفقات بالجواب", async () => {
    // 2026-10-01: شجوى (3 ر.س/م² من 5 صفقات) طلعت «أرخص حي»، و«في المدينة» قارنت كل المدن (أغلى حي = جبل عمر بمكة)
    const pg = await loadPage("index.html", "/");
    const row = (name, city, p, n) => ({ district_id: name, price_per_sqm: p, transaction_count: n, districts: { name, cities: { name: city } } });
    pg.T.district_prices = [
      row("شجوى", "المدينة المنورة", 3, 5), row("الصويدرة", "المدينة المنورة", 144, 363), row("الجماوات", "المدينة المنورة", 4711, 173),
      row("جبل عمر", "مكة المكرمة", 82529, 67), row("النزهة", "مكة المكرمة", 2901, 40),
    ];
    const w = pg.w;
    w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ reply: "ذكاء" }), text: async () => "" });
    const ask = async (q) => {
      const body = w.document.getElementById("assist-body"); body.innerHTML = "";
      w.document.getElementById("assist-input").value = q;
      w.document.getElementById("assist-send").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await new Promise(r => setTimeout(r, 1200));
      const msgs = [...body.querySelectorAll(".assist-row:not(.user) .assist-msg")];
      return msgs.length ? msgs[msgs.length - 1].textContent : "";
    };
    let a = await ask("ارخص حي في المدينة");
    if (a.includes("شجوى")) return `الأرخص طلع شجوى (5 صفقات): ${a}`;
    if (!a.includes("الصويدرة") || !a.includes("144") || !a.includes("363")) return `الأرخص المفروض الصويدرة 144 (363 صفقة): ${a}`;
    a = await ask("اغلى حي في المدينة");
    if (a.includes("جبل عمر") || !a.includes("الجماوات")) return `«في المدينة» المفروض المدينة المنورة بس: ${a}`;
    a = await ask("اغلى حي");
    if (!a.includes("جبل عمر")) return `بدون مدينة المفروض كل المدن (جبل عمر): ${a}`;
    return true;
  }],
  ["المؤشر: حي بأقل من 10 صفقات يظهر عليه تنبيه «عينة صغيرة» والموثوق ما يظهر", async () => {
    const pg = await loadPage("valuation.html", "/valuation");
    const rows = pg.T.district_prices;
    const fath = rows.find(r => r.districts.name === "الفتح");
    if (!fath) return "حي الفتح غير موجود بالبيانات التجريبية";
    fath.transaction_count = 5;
    await pg.w.loadDistrictPricesFromDb();
    const el = () => pg.w.document.getElementById("v-price-source");
    valuate(pg.w, { ...V, district: "الفتح" });
    if (!el().textContent.includes("عينة صغيرة") || !el().textContent.includes("5") || !el().className.includes("notice-warn")) return `الفتح (5 صفقات) بدون تنبيه: ${el().className} | ${el().textContent.slice(0, 160)}`;
    valuate(pg.w, { ...V, district: FX.known_district });
    if (el().textContent.includes("عينة صغيرة")) return "قباء (100 صفقة) طلع عليه تنبيه عينة صغيرة";
    return true;
  }],
  ["المساعد: بحث العقارات يقرأ العروض المنشورة + يفلتر بالحي + بطاقات قابلة للضغط + بدون قفز", async () => {
    // 2026-10-01: كان يقرأ properties (مو العروض) ولا يفلتر بالحي ويقفز لصفحة العروض
    const pg = await loadPage("index.html", "/");
    const mk = (n, type, district, city, price, created, extra = {}) => ({ id: `bbbbbbbb-0000-0000-0000-00000000000${n}`, title: "t", property_type: type, district, city, area_sqm: 400, rooms: 5, price_final: price, price_original: price, is_published: true, is_sold: false, is_pinned: false, created_at: created, ...extra });
    pg.T.offers = [
      mk(1, "فيلا", "العيون", "المدينة المنورة", 3100000, "2026-09-01T00:00:00Z"),
      mk(2, "فيلا", "العيون", "المدينة المنورة", 2000000, "2026-09-20T00:00:00Z"),
      mk(3, "فيلا", "قباء", "المدينة المنورة", 1000000, "2026-09-25T00:00:00Z"),
      mk(4, "شقة في عمارة", "الروضة", "جدة", 700000, "2026-09-10T00:00:00Z"),
      mk(5, "فيلا", "العيون", "المدينة المنورة", 900000, "2026-09-26T00:00:00Z", { is_sold: true }),
    ];
    pg.T.properties = [{ id: "p1", status: "approved", city: "المدينة المنورة", district: "الحرة", property_type: "فيلا", price: 500000, area_sqm: 300, rooms: 4 }];
    const w = pg.w;
    w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ reply: "ذكاء" }), text: async () => "" });
    const ask = async (q) => {
      const body = w.document.getElementById("assist-body"); body.innerHTML = "";
      w.document.getElementById("assist-input").value = q;
      w.document.getElementById("assist-send").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await new Promise(r => setTimeout(r, 1200));
      return [...body.querySelectorAll("a[href^='/offer/']")].map(a => a.getAttribute("href").replace(/.*0{11}/, "").replace("/", ""));
    };
    const shownPage = () => [...w.document.querySelectorAll(".page")].filter(e => e.style.display !== "none").map(e => e.id).join(",");
    const before = shownPage();
    let ids = await ask("ابي فيلا في العيون تحت 4 مليون");
    if (ids.join() !== "2,1") return `فيلا العيون تحت 4 مليون: المتوقع [2,1] (الأحدث أولاً، بدون المباع وبدون قباء) والنتيجة [${ids}]`;
    if (shownPage() !== before) return `المساعد قفز لصفحة ثانية (${before} ← ${shownPage()})`;
    ids = await ask("ابي فيلا في العيون تحت 2.5 مليون");
    if (ids.join() !== "2") return `فلتر السعر: المتوقع [2] والنتيجة [${ids}]`;
    ids = await ask("ابي فيلا في العزيزية");
    if (ids.length) return `حي العزيزية: ما عندنا عروض فيه لكن طلعت [${ids}] (properties أو حي ثاني)`;
    ids = await ask("ابي فيلا في جدة");
    if (ids.length) return `فيلا بجدة: ما عندنا لكن طلعت [${ids}]`;
    return true;
  }],
  ["صفحة «غير موجودة»: مسار خاطئ يعرض 404 لا الرئيسية، والروابط المعروفة سليمة", async () => {
    const bad = await loadPage("index.html", "/supabase/schema.sql");
    const d = bad.w.document;
    const nf = d.getElementById("notfound-page");
    if (!nf) return "ما ظهرت #notfound-page لمسار خاطئ";
    if (!/404/.test(nf.textContent)) return "نص 404 غير موجود";
    if (d.getElementById("home").style.display !== "none") return "الرئيسية ما زالت ظاهرة مع 404";
    // زر العودة يرجع للرئيسية ويزيل الشاشة
    nf.querySelector("a[href='/']").dispatchEvent(new bad.w.MouseEvent("click", { bubbles: true, cancelable: true }));
    if (d.getElementById("notfound-page")) return "شاشة 404 ما زالت ظاهرة بعد العودة للرئيسية";
    if (d.getElementById("home").style.display === "none") return "الرئيسية ما ظهرت بعد العودة";
    // مسارات صحيحة ما لازم تتأثر
    for (const ok of ["/", "/offers", "/valuation", "/contracts/", "/privacy", "/index.html"]) {
      const g = await loadPage("index.html", ok);
      if (g.w.document.getElementById("notfound-page")) return `مسار صحيح ${ok} عُرض كـ404`;
    }
    return true;
  }],
  ["أضف عقارك: فشل Turnstile = رسالة واضحة وبدون إرسال برمز فارغ؛ ومحاولة ثانية تنقذ الطلب", async () => {
    const fill = (w) => {
      const $ = (id) => w.document.getElementById(id);
      $("add-district").value = "العزيزية"; $("add-price").value = "900000"; $("add-area").value = "300";
    };
    // (أ) Turnstile ما يطلع رمز أبداً → رسالة تحقق أمني، وما يُستدعى public-submit
    const a = await loadPage("add-property.html", "/add-property");
    a.w.turnstile = { render: (c, o) => { setTimeout(() => o["error-callback"](), 5); return "w"; }, remove() {} };
    fill(a.w);
    const i0 = a.invoke.length;
    a.w.document.getElementById("btn-add-property").click();
    await new Promise((r) => setTimeout(r, 400));
    const msgA = a.w.document.getElementById("add-property-msg").textContent;
    if (!/التحقق الأمني/.test(msgA)) return `الرسالة غير واضحة: «${msgA}»`;
    if (a.invoke.slice(i0).some((x) => x.name === "public-submit")) return "أُرسل الطلب برمز فارغ";
    // (ب) فشل أول ثم نجاح بالمحاولة الثانية → يُرسل برمز صحيح
    const b = await loadPage("add-property.html", "/add-property");
    let calls = 0;
    b.w.turnstile = { render: (c, o) => { calls++; const n = calls; setTimeout(() => n >= 2 ? o.callback("tok-ok") : o["error-callback"](), 5); return "w" + n; }, remove() {} };
    fill(b.w);
    const j0 = b.invoke.length;
    b.w.document.getElementById("btn-add-property").click();
    await new Promise((r) => setTimeout(r, 500));
    const sent = b.invoke.slice(j0).find((x) => x.name === "public-submit");
    if (!sent) return `ما أُرسل الطلب بعد المحاولة الثانية (محاولات Turnstile=${calls})`;
    return sent.opts.body.turnstileToken === "tok-ok" || `الرمز المرسل: ${sent.opts.body.turnstileToken}`;
  }],
  ["أضف عقارك: رمز Turnstile يبدأ يتجهّز لحظة اختيار الصورة (قبل الضغط على إدراج)", async () => {
    const c = await loadPage("add-property.html", "/add-property");
    let calls = 0;
    c.w.turnstile = { render: () => { calls++; return "w" + calls; }, remove() {} };
    c.w.URL.createObjectURL = () => "blob:test";
    const input = c.w.document.getElementById("add-images");
    const f = new c.w.File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    input.dispatchEvent(new c.w.Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    if (calls !== 1) return `عدد استدعاءات Turnstile بعد اختيار الصورة = ${calls} (المتوقع 1)`;
    // اختيار صورة ثانية لا يولّد رمزاً ثانياً بلا داعٍ
    input.dispatchEvent(new c.w.Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    return calls === 1 || `ولّد رمزاً زائداً: ${calls}`;
  }],
  ["أسماء الأحياء بالإنجليزية: كل الأحياء المسعّرة مغطاة بنقحرة (بدون ترجمة ولا حروف عربية)", async () => {
    const m = SITE_JS.match(/const DISTRICT_TRANSLIT = (\{[\s\S]*?\n\});/);
    if (!m) return "DISTRICT_TRANSLIT غير موجود";
    const dict = new Function("return " + m[1])();
    const names = JSON.parse(fs.readFileSync(path.join(__dirname, "district-names.json"), "utf8"));
    const missing = names.filter((n) => !dict[n]);
    if (missing.length) return `${missing.length} حي بلا اسم إنجليزي، مثل: ${missing.slice(0, 3).join("، ")}`;
    const bad = Object.entries(dict).filter(([, v]) => /[\u0600-\u06FF]/.test(v) || /\bKing\b/.test(v));
    if (bad.length) return `اسم مترجم أو فيه عربي: ${bad[0].join(" → ")}`;
    return true;
  }],
  ["الإنجليزي: الحقل يعرض الاسم المنقحر/الإنجليزي لكن قيمته البرمجية تبقى العربية (حي ونوع عقار) ويتحدّث مع تغيير اللغة", async () => {
    const pg = await loadPage("valuation.html", "/valuation");
    const w = pg.w, $ = (id) => w.document.getElementById(id);
    w.applyLang("en");
    $("v-city").value = C; $("v-city").dispatchEvent(new w.Event("change"));
    const nat = (el) => Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").get.call(el);
    const pick = (el, label) => {
      el.dispatchEvent(new w.Event("focus"));
      const it = [...el.parentElement.querySelectorAll(".custom-filter-dropdown-item")].find((x) => x.textContent === label);
      if (!it) return false;
      it.dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      return true;
    };
    const villa = { en: w.typeLabel("فيلا") };
    if (!pick($("v-type"), villa.en)) return "ما لقيت خيار Villa بالقائمة";
    if (nat($("v-type")) !== villa.en) return `الحقل يعرض «${nat($("v-type"))}» بدل ${villa.en}`;
    if ($("v-type").value !== "فيلا") return `القيمة البرمجية صارت «${$("v-type").value}»`;
    const d = FX.known_district, lab = w.districtLabel(d);
    if (lab === d) return "الحي بلا اسم إنجليزي: " + d;
    if (!pick($("v-district"), lab)) return "ما لقيت الحي بالقائمة: " + lab;
    if (nat($("v-district")) !== lab) return `الحقل يعرض «${nat($("v-district"))}» بدل ${lab}`;
    if ($("v-district").value !== d) return `قيمة الحي البرمجية «${$("v-district").value}»`;
    // إعادة فتح القائمة بعد الاختيار تعرض كل الأحياء، مو الحي المختار وما يشبهه فقط
    $("v-district").dispatchEvent(new w.Event("focus"));
        const cnt = () => $("v-district").parentElement.querySelectorAll(".custom-filter-dropdown-item").length;
    const afterPick = cnt();
    const saved = $("v-district").value;
    $("v-district").value = ""; $("v-district").dispatchEvent(new w.Event("focus"));
    const all = cnt();
    $("v-district").value = saved;
    if (all <= 50 || afterPick !== all) return `القائمة بعد الاختيار تعرض ${afterPick} بدل ${all}`;
    w.applyLang("ar");
    if (nat($("v-district")) !== d || nat($("v-type")) !== "فيلا") return "الحقل ما رجع عربي بعد تغيير اللغة";
    w.applyLang("en");
    if (nat($("v-district")) !== lab) return "الحقل ما تحدّث للإنجليزي بعد تغيير اللغة";
    return true;
  }],
  ["صفحات الأحياء: المولّد يختار الأحياء بـ5 صفقات فأكثر بلا تعارض مسارات، والصفحة تحمل الأرقام الصحيحة والرابط الأساسي", async () => {
    const g = require("./generate-district-pages.js");
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "district-prices-sample.json"), "utf8"));
    const ctx = g.prepare(rows);
    if (ctx.eligible.length !== rows.filter((r) => r.deals >= 5).length) return "عدد الأحياء المؤهَّلة غير صحيح";
    if (ctx.eligible.some((r) => r.deals < 5)) return "حي بأقل من 5 صفقات دخل النشر";
    const quba = ctx.eligible.find((r) => r.city === "المدينة المنورة" && r.district === "قباء");
    const html = g.render(quba, { ...ctx, hasPage: () => false });
    const want = [`<h1>سعر المتر في حي قباء — المدينة المنورة</h1>`, `${Math.round(quba.price).toLocaleString("en-US")} ريال`, `href="https://himmat.sa${g.encPath(g.pagePath(quba))}"`, "وزارة العدل", "/valuation?city="];
    for (const w of want) if (!html.includes(w)) return "ينقص بالصفحة: " + w;
    if (/undefined|NaN/.test(html)) return "الصفحة فيها undefined أو NaN";
    return true;
  }],
  ["خريطة الموقع الرئيسية: lastmod يُحسب من Git لكل صفحة (يستثني البوت)، يعدّل النص فقط، والـAction يشغّل السكربت ويحفظ sitemap.xml", async () => {
    const u = require("./update-sitemap-lastmod.js");
    if (u.fileForLoc("https://himmat.sa/") !== "index.html" || u.fileForLoc("https://himmat.sa/offers") !== "offers.html") return "تحويل الرابط لملف خاطئ";
    const xml = '<urlset><url>\n<loc>https://himmat.sa/</loc>\n<lastmod>2026-09-22</lastmod>\n<priority>1.0</priority></url><url><loc>https://himmat.sa/faq</loc><lastmod>2026-09-22</lastmod></url></urlset>';
    const r = u.rewrite(xml, (f) => (f === "index.html" ? "2026-10-02" : null));
    if (r.changed !== 1 || !r.xml.includes("<lastmod>2026-10-02</lastmod>\n<priority>1.0</priority>")) return "تعديل الصفحة الأولى غير صحيح";
    if (!r.xml.includes("faq</loc><lastmod>2026-09-22</lastmod>")) return "صفحة بلا تاريخ Git تغيّرت (لازم تبقى كما هي)";
    const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "generate-snapshot.yml"), "utf8");
    if (!/fetch-depth:\s*0/.test(wf) || !wf.includes("update-sitemap-lastmod.js") || !/git add [^\n]*\bsitemap\.xml\b/.test(wf)) return "الـAction ما يشغّل السكربت أو ما يحفظ sitemap.xml أو بدون fetch-depth: 0";
    const src = fs.readFileSync(path.join(__dirname, "update-sitemap-lastmod.js"), "utf8");
    if (!src.includes("--invert-grep") || !src.includes("himmat-snapshot-bot")) return "السكربت ما يستثني إيداعات البوت";
    return true;
  }],
  ["صفحات الأحياء الكاملة: 574 صفحة بلا روابط داخلية مكسورة، العروض تظهر بالحي الصحيح فقط، والخريطة كاملة، والحماية ترفض بيانات ناقصة", async () => {
    const g = require("./generate-district-pages.js");
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "district-prices-sample.json"), "utf8"));
    const offers = [{ id: "OFFER-1", title: "فيلا اختبار", city: "المدينة المنورة", district: "قباء", price_final: 1500000 }];
    const built = g.buildAll(rows, offers);
    if (built.files.length !== built.count + 5) return `عدد الصفحات ${built.files.length} (مؤهَّل ${built.count} + مدن 4 + رئيسية)`;
    if (built.entries.length !== built.files.length) return "عدد مدخلات الخريطة لا يطابق الصفحات";
    const dirs = new Set(built.files.map((f) => f.dir));
    const decode = (u) => decodeURIComponent(u);
    for (const f of built.files) {
      if (/undefined|NaN/.test(f.html)) return "undefined/NaN في " + f.dir;
      for (const m of f.html.matchAll(/href="(\/[^"#?]*)"/g)) {
        const u = decode(m[1]);
        if (u.startsWith("/أحياء") && !dirs.has(u)) return `رابط مكسور ${u} في ${f.dir}`;
      }
    }
    const get = (city, d) => built.files.find((f) => f.dir === `/أحياء/${city.replace(/ /g, "-")}/${d.replace(/ /g, "-")}/`).html;
    if (!get("المدينة المنورة", "قباء").includes("/offer/OFFER-1/")) return "العرض ما ظهر بحي قباء";
    if (get("المدينة المنورة", "العصبة").includes("OFFER-1")) return "العرض ظهر بحي ثاني";
    if (!get("المدينة المنورة", "العصبة").includes("ما فيه عروض منشورة")) return "حي بلا عروض ما عرض الرسالة البديلة";
    // الحماية: بيانات ناقصة = رفض قبل أي كتابة
    let threw = false;
    try { g.writeAll(g.buildAll(rows.slice(0, 20), [])); } catch { threw = true; }
    if (!threw) return "writeAll قبل بيانات ناقصة (20 حياً)";
    return true;
  }],
  ["رابط «أسعار الأحياء» بذيل كل الصفحات + ترجمته", async () => {
    const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && !["404.html", "admin.html"].includes(f));
    for (const f of files) if (!fs.readFileSync(path.join(ROOT, f), "utf8").includes('href="/أحياء/" data-i18n="footer_districts"')) return "ينقص الرابط في " + f;
    if ((SITE_JS.match(/footer_districts:/g) || []).length !== 2) return "مفتاح الترجمة footer_districts ليس بالعربي والإنجليزي";
    return true;
  }],
  ["الأسماء البديلة للأحياء: كل اسم بديل يشير لحي موجود بقاعدة الوزارة، والجديدة تعمل بالمؤشر", async () => {
    const pg = await loadPage("valuation.html", "/valuation");
    const w = pg.w;
    const names = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, "district-names.json"), "utf8")));
    const cases = [["مكة المكرمة", "الشبيكة", "الشبيكة الجديد"], ["مكة المكرمة", "الشامية", "الشامية الجديد"],
      ["الرياض", "الملك عبدالله", "الملك عبد الله"], ["الرياض", "الشفا", "الشفاء"],
      ["المدينة المنورة", "النسيم", "العيون"], ["المدينة المنورة", "الكردي", "الفتح"], ["المدينة المنورة", "مهزور", "وادي مهزور"]];
    for (const [c, from, to] of cases) {
      if (w.resolveDistrictAlias(c, from) !== to) return `${c}: ${from} لم يتحوّل إلى ${to}`;
      if (!names.has(to)) return `الهدف ${to} غير موجود بأحياء الوزارة`;
    }
    if (w.resolveDistrictAlias("جدة", "الشبيكة") !== "الشبيكة") return "الاسم البديل تسرّب لمدينة ثانية";
    return true;
  }],
  ["sw.js: التنقّل فقط يمر عبره، وفشل الشبكة ما يسبّب رفضاً غير ملتقَط", async () => {
    const handlers = {};
    const self = { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim() {} } };
    const Response = { error: () => "NETWORK_ERROR_RESPONSE" };
    const fetchFail = () => Promise.reject(new TypeError("Failed to fetch"));
    new Function("self", "fetch", "Response", fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"))(self, fetchFail, Response);
    const mk = (mode) => { const e = { request: { mode }, responded: null, respondWith(p) { this.responded = p; } }; return e; };
    const sub = mk("cors"); handlers.fetch(sub);
    if (sub.responded) return "طلب غير تنقّل (مثل Supabase) ما زال يمر عبر sw.js";
    const nav = mk("navigate"); handlers.fetch(nav);
    if (!nav.responded) return "طلب التنقّل ما عولج";
    const r = await nav.responded;
    return r === "NETWORK_ERROR_RESPONSE" || `فشل الشبكة أعطى: ${r}`;
  }],
  ["صفحة 404: ما فيه رابط مميَّز (active) بالقائمة", async () => {
    const bad = await loadPage("index.html", "/zzz/none");
    const act = bad.w.document.querySelectorAll(".links a.active").length;
    return act === 0 || `روابط نشطة: ${act}`;
  }],
  ["Analytics: ضغطة زر واتساب العائم = whatsapp_click", async ({ home }) => {
    const a = home.w.document.getElementById("whatsapp-float");
    if (!a) return "#whatsapp-float غير موجود";
    a.addEventListener("click", (e) => e.preventDefault());
    a.dispatchEvent(new home.w.MouseEvent("click", { bubbles: true }));
    const ev = home.gtagEvents.find((e) => e.name === "whatsapp_click");
    return (ev && ev.params.link_location === "float") || `الأحداث: ${JSON.stringify(home.gtagEvents)}`;
  }],
  ["الخطوط محلية: لا Google Fonts بالصفحات العامة، وكل ملف خط (preload و@font-face) موجود فعلاً", async () => {
    const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && f !== "admin.html");
    const srcs = pages.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]);
    srcs.push(["scripts/generate-district-pages.js", fs.readFileSync(path.join(ROOT, "scripts", "generate-district-pages.js"), "utf8")]);
    for (const [f, t] of srcs) {
      if (/fonts\.(googleapis|gstatic)\.com/.test(t)) return `${f} ما زال يشير إلى Google Fonts`;
    }
    const idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const pre = [...idx.matchAll(/<link rel="preload" href="(\/assets\/fonts\/[^"]+\.woff2)" as="font"[^>]*crossorigin>/g)].map((m) => m[1]);
    if (pre.length < 8) return `preload للخطوط ${pre.length} فقط (المتوقع 8)`;
    for (const u of pre) if (!fs.existsSync(path.join(ROOT, u.slice(1)))) return `ملف preload مفقود: ${u}`;
    const css = fs.readFileSync(path.join(ROOT, "css", "site.css"), "utf8");
    const urls = [...css.matchAll(/url\(\.\.\/assets\/fonts\/([^)]+\.woff2)\)/g)].map((m) => m[1]);
    if (urls.length < 10) return `@font-face لـ ${urls.length} ملف فقط (المتوقع 10)`;
    for (const u of urls) if (!fs.existsSync(path.join(ROOT, "assets", "fonts", u))) return `ملف خط مفقود: ${u}`;
    return true;
  }],
  ["الهيرو: صورتا WebP موجودتان وصغيرتان، والخلفية تستعملهما، وpreload لهما بالصفحات العامة", async () => {
    const small = path.join(ROOT, "assets", "images", "hero-madinah-800.webp");
    const big = path.join(ROOT, "assets", "images", "hero-madinah-1600.webp");
    if (!fs.existsSync(small) || !fs.existsSync(big)) return "ملف WebP للهيرو مفقود";
    if (fs.statSync(small).size > 120 * 1024) return "هيرو الجوال أكبر من 120KB";
    if (fs.statSync(big).size > 300 * 1024) return "هيرو الشاشة الكبيرة أكبر من 300KB";
    const css = fs.readFileSync(path.join(ROOT, "css", "site.css"), "utf8");
    if (!/\.hero::before\{[^}]*hero-madinah-800\.webp/.test(css)) return "خلفية الهيرو لا تستعمل نسخة الجوال WebP";
    if (!/min-width:821px\)\{\.hero::before\{background-image:url\('\.\.\/assets\/images\/hero-madinah-1600\.webp'\)/.test(css)) return "لا توجد نسخة الشاشة الكبيرة داخل media";
    const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && f !== "admin.html" && f !== "404.html"); // 404.html مجرد محوّل بلا CSS ولا هيرو
    const srcs = pages.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]);
    srcs.push(["scripts/generate-district-pages.js", fs.readFileSync(path.join(ROOT, "scripts", "generate-district-pages.js"), "utf8")]);
    for (const [f, t] of srcs) {
      if (!/rel="preload" as="image" href="\/assets\/images\/hero-madinah-800\.webp" fetchpriority="high" media="\(max-width:820px\)"/.test(t)) return `${f}: لا preload لهيرو الجوال`;
      if (!/rel="preload" as="image" href="\/assets\/images\/hero-madinah-1600\.webp" fetchpriority="high" media="\(min-width:821px\)"/.test(t)) return `${f}: لا preload لهيرو الشاشة الكبيرة`;
    }
    return true;
  }],
  ["تأجيل الطرف الثالث: لا GA ولا Turnstile يحجبان التحميل، وTurnstile يُحمَّل عند الحاجة وتنتظره النماذج", async () => {
    const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && f !== "admin.html" && f !== "404.html");
    for (const f of pages) {
      const t = fs.readFileSync(path.join(ROOT, f), "utf8");
      if (/<script[^>]*src="https:\/\/www\.googletagmanager\.com/.test(t)) return `${f}: سكربت GA ما زال بوسم مباشر`;
      if (/<script[^>]*src="https:\/\/challenges\.cloudflare\.com/.test(t)) return `${f}: سكربت Turnstile ما زال بوسم مباشر`;
      if (!/requestIdleCallback\(go/.test(t)) return `${f}: محمّل GA المؤجَّل غير موجود`;
      if (!/function gtag\(\)\{dataLayer\.push\(arguments\);\}/.test(t)) return `${f}: دالة gtag الفورية مفقودة`;
      if (/<link rel="preconnect" href="https:\/\/wlebcvwsleoieodjtrcf\.supabase\.co">/.test(t)) return `${f}: preconnect لـSupabase بلا crossorigin`;
    }
    // سلوك: النموذج يطلب توكن قبل ما يوجد window.turnstile → يُحقن السكربت وينتظر، ثم يُرسل بالرمز الذي يصل متأخراً
    const g = await loadPage("add-property.html", "/add-property");
    g.w.__noTurnstileErr = true;
    delete g.w.turnstile;
    const $ = (id) => g.w.document.getElementById(id);
    $("add-type").value = "شقة"; $("add-type").dispatchEvent(new g.w.Event("change"));
    $("add-city").value = "المدينة المنورة"; $("add-district").value = "العزيزية"; $("add-price").value = "900000"; $("add-area").value = "300";
    $("add-name") && ($("add-name").value = "اختبار"); $("add-phone") && ($("add-phone").value = "0500000000");
    const i0 = g.invoke.length;
    $("btn-add-property").click();
    await new Promise((r) => setTimeout(r, 300));
    const tag = [...g.w.document.head.querySelectorAll("script")].find((x) => /challenges\.cloudflare\.com/.test(x.src));
    if (!tag) return "لم يُحقن سكربت Turnstile عند الحاجة";
    if (g.invoke.slice(i0).some((x) => x.name === "public-submit")) return "أُرسل الطلب قبل وصول Turnstile";
    g.w.turnstile = { render: (c, o) => { setTimeout(() => o.callback("tok-late"), 5); return "w"; }, remove() {} };
    await new Promise((r) => setTimeout(r, 600));
    const sent = g.invoke.slice(i0).find((x) => x.name === "public-submit");
    if (!sent) return "ما أُرسل الطلب بعد وصول Turnstile المتأخر";
    return sent.opts.body.turnstileToken === "tok-late" || `الرمز المرسل: ${sent.opts.body.turnstileToken}`;
  }],
  ["صفحات العروض: JSON-LD للعرض (RealEstateListing + Offer + BreadcrumbList) صحيح ومهرَّب، وحقوله الناقصة تُحذف", async () => {
    let g;
    try { g = require(path.join(ROOT, "scripts", "generate-offer-pages.js")); } catch (e) { return "تعذّر استيراد المولّد: " + e.message; }
    if (typeof g.buildOfferHtml !== "function") return "المولّد لا يصدّر buildOfferHtml";
    const tpl = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const parse = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
    const base = { id: "abc", title: "فيلا </script><b>x", description: "وصف", price_final: "3100000.00", price_original: null, city: "المدينة المنورة", district: "العيون", property_type: "فيلا", area_sqm: "410.00", rooms: 6, is_sold: false, created_at: "2026-09-01T10:00:00Z", image_urls: ["https://x/y.jpg"] };
    const html = g.buildOfferHtml(tpl, base);
    if (html.includes("</script><b>")) return "نص العرض يغلق وسم script (تهريب ناقص)";
    const ld = parse(html);
    if (ld.length !== 3) return `عدد كتل JSON-LD = ${ld.length} (المتوقع 3: الشركة + العرض + المسار)`;
    if (ld[0]["@type"] !== "RealEstateAgent") return "مخطط الشركة الأصلي اختفى";
    const L = ld.find((x) => x["@type"] === "RealEstateListing");
    const B = ld.find((x) => x["@type"] === "BreadcrumbList");
    if (!L || !B) return "RealEstateListing أو BreadcrumbList مفقود";
    if (L.url !== "https://himmat.sa/offer/abc/") return `رابط العرض: ${L.url}`;
    if (!(L.offers && L.offers.price === 3100000 && L.offers.priceCurrency === "SAR")) return `Offer: ${JSON.stringify(L.offers)}`;
    if (L.offers.availability !== "https://schema.org/InStock") return `التوفر: ${L.offers.availability}`;
    if (!(L.about && L.about["@type"] === "Accommodation" && L.about.floorSize.value === 410 && L.about.numberOfRooms === 6)) return `about: ${JSON.stringify(L.about)}`;
    if (L.about.address.addressLocality !== "المدينة المنورة" || L.about.address.addressCountry !== "SA") return "عنوان العقار ناقص";
    if (B.itemListElement.length !== 3 || B.itemListElement[1].item !== "https://himmat.sa/offers" || B.itemListElement[2].item !== L.url) return "مسار الفتات غير صحيح";
    // مباع → SoldOut
    const sold = parse(g.buildOfferHtml(tpl, { ...base, is_sold: true })).find((x) => x["@type"] === "RealEstateListing");
    if (sold.offers.availability !== "https://schema.org/SoldOut") return "العرض المباع لا يظهر SoldOut";
    // بلا سعر/مساحة/غرف → تُحذف الحقول (لا قيم فارغة ولا NaN)
    const bare = parse(g.buildOfferHtml(tpl, { ...base, price_final: null, price_original: null, area_sqm: null, rooms: null, created_at: null })).find((x) => x["@type"] === "RealEstateListing");
    if (bare.offers || bare.about.floorSize || bare.about.numberOfRooms || bare.datePosted) return `حقول ناقصة لم تُحذف: ${JSON.stringify(bare)}`;
    // أرض → Place بخاصية مساحة
    const land = parse(g.buildOfferHtml(tpl, { ...base, property_type: "أرض سكنية" })).find((x) => x["@type"] === "RealEstateListing");
    if (land.about["@type"] !== "Place" || !land.about.additionalProperty || land.about.additionalProperty.value !== 410) return `الأرض: ${JSON.stringify(land.about)}`;
    return true;
  }],
  // #40 فرملة المولّدات: فشل HTTP يجب أن يوقف المولّد (لا يرجع [] فيحذف صفحات العروض)، و200 مع [] حالة سليمة
  ["فرملة المولّدات: supaSelect يرمي عند HTTP غير ناجح ويقبل 200 + []", async () => {
    const realFetch = global.fetch;
    const realErr = console.error;
    try {
      console.error = () => {};
      for (const file of ["generate-offer-pages.js", "generate-snapshot.js"]) {
        const g = require(path.join(ROOT, "scripts", file));
        if (typeof g.supaSelect !== "function") return file + ": supaSelect غير مُصدَّر";
        for (const status of [500, 403, 404]) {
          global.fetch = async () => ({ ok: false, status, text: async () => "boom", json: async () => ({}) });
          let threw = false;
          try { await g.supaSelect("offers", "select=id"); } catch (e) { threw = /offers/.test(e.message) && new RegExp(String(status)).test(e.message); }
          if (!threw) return `${file}: HTTP ${status} لم يُوقف المولّد`;
        }
        global.fetch = async () => ({ ok: true, status: 200, text: async () => "[]", json: async () => [] });
        const r = await g.supaSelect("offers", "select=id");
        if (!Array.isArray(r) || r.length !== 0) return `${file}: 200 + [] لم تُرجع مصفوفة فارغة`;
      }
      return true;
    } finally { global.fetch = realFetch; console.error = realErr; }
  }],
  // #41 CSS مضمَّن بالرئيسية: مطابق لـcss/site.css (المصدر الوحيد) ولا يوجد رابط خارجي للتنسيق
  ["الرئيسية: CSS مضمَّن ومطابق لـcss/site.css، بمسارات مطلقة، وصفحات العروض المولَّدة ترثه", async () => {
    let m;
    try { m = require(path.join(ROOT, "scripts", "inline-css.js")); } catch (e) { return "تعذّر استيراد inline-css.js: " + e.message; }
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const css = fs.readFileSync(path.join(ROOT, "css", "site.css"), "utf8");
    if (/<link[^>]+css\/site\.css/.test(html)) return "ما زال رابط css/site.css الخارجي موجوداً بـindex.html";
    const tags = html.match(/<style id="site-css">/g) || [];
    if (tags.length !== 1) return `عدد وسوم <style id="site-css"> = ${tags.length} (المتوقع 1)`;
    if (m.inlineCss(html, css) !== html) return "الـCSS المضمَّن لا يطابق css/site.css — شغّل: node scripts/inline-css.js";
    const tag = m.buildStyleTag(css);
    if (/url\(['"]?\.\.\//.test(tag)) return "مسار نسبي ../ داخل الـCSS المضمَّن";
    if (!/url\(\/assets\/fonts\//.test(tag)) return "مسارات الخطوط المطلقة غير موجودة";
    const g = require(path.join(ROOT, "scripts", "generate-offer-pages.js"));
    const out = g.buildOfferHtml(html, { id: "3a144c74-3194-4e35-95d0-da19b724e625", title: "اختبار", description: "وصف", city: "المدينة المنورة", district: "العيون", price_final: 100, is_sold: false, created_at: "2026-01-01T00:00:00Z" });
    if (!out.includes('<style id="site-css">')) return "صفحة العرض المولَّدة فقدت الـCSS المضمَّن";
    return true;
  }],
  // #42 قياس Core Web Vitals الفعلي: مؤجَّل، مستضاف عندنا، ويرسل أحداثاً صحيحة لـGA4
  ["Web Vitals: المكتبة مستضافة عندنا، تُحقن مرة واحدة فقط بعد التفاعل/الخمول، وتُرسل LCP/CLS لـGA4 بالشكل الصحيح", async () => {
    const lib = path.join(ROOT, "lib", "web-vitals.iife.js");
    if (!fs.existsSync(lib)) return "lib/web-vitals.iife.js غير موجود";
    const src = fs.readFileSync(lib, "utf8");
    if (src.length > 20000 || !/onINP/.test(src) || !/onLCP/.test(src) || !/onCLS/.test(src)) return "ملف المكتبة غير سليم";
    for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith(".html"))) {
      if (/<script[^>]*web-vitals/.test(fs.readFileSync(path.join(ROOT, f), "utf8"))) return `${f}: المكتبة محمّلة بوسم مباشر (يجب أن تُحقن مؤجَّلة)`;
    }
    const g = await loadPage("index.html", "/");
    const tags = () => [...g.w.document.head.querySelectorAll("script")].filter((x) => /web-vitals/.test(x.src));
    if (tags().length) return "المكتبة حُقنت قبل أي تفاعل/خمول";
    g.w.dispatchEvent(new g.w.Event("pointerdown"));
    g.w.dispatchEvent(new g.w.Event("keydown"));
    if (tags().length !== 1) return `عدد وسوم المكتبة بعد التفاعل = ${tags().length} (المتوقع 1)`;
    if (!/\/lib\/web-vitals\.iife\.js$/.test(tags()[0].src)) return "مسار المكتبة خاطئ: " + tags()[0].src;
    const reg = {};
    g.w.webVitals = {};
    for (const n of ["FCP", "LCP", "CLS", "INP", "TTFB"]) g.w.webVitals["on" + n] = (cb) => { reg[n] = cb; };
    tags()[0].dispatchEvent(new g.w.Event("load"));
    const missing = ["FCP", "LCP", "CLS", "INP", "TTFB"].filter((n) => !reg[n]);
    if (missing.length) return "لم تُسجَّل المقاييس: " + missing.join(",");
    const n0 = g.gtagEvents.length;
    reg.LCP({ name: "LCP", delta: 1234.4, value: 1234.4, id: "v1-a", rating: "good", navigationType: "navigate" });
    reg.CLS({ name: "CLS", delta: 0.0432, value: 0.0432, id: "v1-b", rating: "good", navigationType: "navigate" });
    const ev = g.gtagEvents.slice(n0);
    const lcp = ev.find((e) => e.name === "LCP"), cls = ev.find((e) => e.name === "CLS");
    if (!lcp || !cls) return "لم تُرسَل أحداث LCP/CLS لـGA4: " + JSON.stringify(ev);
    if (lcp.params.value !== 1234 || lcp.params.metric_rating !== "good" || lcp.params.metric_id !== "v1-a" || lcp.params.non_interaction !== true) return "شكل حدث LCP خاطئ: " + JSON.stringify(lcp.params);
    if (cls.params.value !== 43) return "CLS يجب أن يُضرب بـ1000 ويُقرَّب: " + JSON.stringify(cls.params);
    // فشل gtag لا يكسر الصفحة
    g.w.gtag = () => { throw new Error("boom"); };
    try { reg.LCP({ name: "LCP", delta: 1, value: 1, id: "x", rating: "good" }); } catch (e) { return "استثناء من القياس تسرّب للصفحة"; }
    return true;
  }],
  // #43 Web Vitals → Worker: دفعة واحدة مجهولة عند الإخفاء، مرة واحدة لكل مقياس، وتُتجاهل أدوات الفحص الآلي
  ["Web Vitals: دفعة /vitals واحدة عند إخفاء الصفحة (صفحة/جهاز صحيحان)، بلا تكرار، وLighthouse لا يُقاس", async () => {
    const start = async (file, urlPath, extra, mut) => {
      const g = await loadPage(file, urlPath, extra);
      const beacons = [];
      g.w.navigator.sendBeacon = (u, d) => { beacons.push({ u, d }); return true; };
      g.w.dispatchEvent(new g.w.Event("pointerdown"));
      const tag = [...g.w.document.head.querySelectorAll("script")].find((x) => /web-vitals/.test(x.src));
      return { g, beacons, tag };
    };
    const hide = (w) => { Object.defineProperty(w.document, "visibilityState", { value: "hidden", configurable: true }); w.document.dispatchEvent(new w.Event("visibilitychange")); };
    // 1) مسار طبيعي
    const a = await start("offers.html", "/offers");
    if (!a.tag) return "المكتبة لم تُحقن";
    const reg = {};
    a.g.w.webVitals = {};
    for (const n of ["FCP", "LCP", "CLS", "INP", "TTFB"]) a.g.w.webVitals["on" + n] = (cb) => { reg[n] = cb; };
    a.tag.dispatchEvent(new a.g.w.Event("load"));
    reg.LCP({ name: "LCP", delta: 2100, value: 2100, id: "i1", rating: "good" });
    reg.CLS({ name: "CLS", delta: 0.04, value: 0.04, id: "i2", rating: "good" });
    if (a.beacons.length) return "أُرسلت دفعة قبل إخفاء الصفحة";
    hide(a.g.w);
    if (a.beacons.length !== 1) return `عدد الدفعات بعد الإخفاء = ${a.beacons.length} (المتوقع 1)`;
    if (!/himmat-ai-backend\.ahmedvall\.workers\.dev\/vitals$/.test(a.beacons[0].u)) return "عنوان الإرسال خاطئ: " + a.beacons[0].u;
    const p = JSON.parse(a.beacons[0].d);
    if (p.page !== "offers" || p.device !== "desktop") return "صفحة/جهاز خاطئان: " + a.beacons[0].d;
    const names = p.metrics.map((m) => m.name).sort().join(",");
    if (names !== "CLS,LCP") return "المقاييس المرسلة خاطئة: " + names;
    if (p.metrics.find((m) => m.name === "LCP").value !== 2100) return "قيمة LCP خاطئة";
    hide(a.g.w); a.g.w.dispatchEvent(new a.g.w.Event("pagehide"));
    if (a.beacons.length !== 1) return "تكرّر الإرسال عند إخفاء ثانٍ";
    // 2) الرئيسية = home (والعروض المولَّدة offer/<id>/ = offer-detail)، والجوال = mobile
    const b = await start("index.html", "/");
    b.g.w.matchMedia = (q) => ({ matches: /max-width: 820px/.test(q), addEventListener() {}, addListener() {} });
    // الجهاز يُحسب عند التحميل؛ نتحقق فقط من مفتاح الصفحة هنا
    const regB = {}; b.g.w.webVitals = {};
    for (const n of ["FCP", "LCP", "CLS", "INP", "TTFB"]) b.g.w.webVitals["on" + n] = (cb) => { regB[n] = cb; };
    b.tag.dispatchEvent(new b.g.w.Event("load"));
    regB.TTFB({ name: "TTFB", delta: 80, value: 80, id: "t", rating: "good" });
    hide(b.g.w);
    if (JSON.parse(b.beacons[0].d).page !== "home") return "مفتاح صفحة الرئيسية خاطئ: " + b.beacons[0].d;
    // 3) بلا أي قيمة لا يُرسل شيء
    const c = await start("index.html", "/");
    c.g.w.webVitals = { onFCP() {}, onLCP() {}, onCLS() {}, onINP() {}, onTTFB() {} };
    c.tag.dispatchEvent(new c.g.w.Event("load")); hide(c.g.w);
    if (c.beacons.length) return "أُرسلت دفعة فارغة";
    // 4) أدوات الفحص الآلي لا تُقاس (لا حقن ولا إرسال)
    const d = await start("index.html", "/", { userAgent: "Mozilla/5.0 (Linux; Android 11) Chrome/130 Mobile Safari/537.36 Chrome-Lighthouse" });
    if (d.tag) return "Lighthouse يجب ألا يُحقن له قياس الزوّار";
    return true;
  }],
  // #44 بطاقة لوحة الإدارة: عنصرها موجود، تستدعي الدالة الصحيحة، وتعرض الألوان/الحالات الصحيحة
  ["لوحة الإدارة: بطاقة سرعة الموقع الفعلية تعرض p75 بألوانه، العيّنة القليلة، والغياب، ورسالة التفعيل", async () => {
    const html = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
    const js = fs.readFileSync(path.join(ROOT, "js", "admin.js"), "utf8");
    if (!/id="web-vitals-box"/.test(html)) return "عنصر web-vitals-box غير موجود بـadmin.html";
    if (!/loadDashboard[\s\S]*?loadWebVitals\(\);\s*\}/.test(js)) return "loadWebVitals لا تُستدعى من loadDashboard";
    const a = js.indexOf("const VITALS_META"), b = js.indexOf("async function loadMostViewed");
    if (a < 0 || b < 0 || b < a) return "كود البطاقة غير موجود بـadmin.js";
    const code = js.slice(a, b);
    const run = async (rpc) => {
      const dom = new JSDOM('<div id="web-vitals-box"></div>', { runScripts: "outside-only" });
      const w = dom.window;
      w.supa = { rpc };
      w.console.error = () => {};
      w.eval(code + "; window.__load = loadWebVitals;");
      await w.__load();
      return w.document.getElementById("web-vitals-box").innerHTML;
    };
    const rows = [
      { metric: "LCP", device: "mobile", samples: 120, p75: 2000, p50: 1500, good: 100, needs: 15, poor: 5 },
      { metric: "LCP", device: "desktop", samples: 60, p75: 5200, p50: 3000, good: 20, needs: 10, poor: 30 },
      { metric: "INP", device: "mobile", samples: 40, p75: 300, p50: 150, good: 20, needs: 15, poor: 5 },
      { metric: "CLS", device: "mobile", samples: 5, p75: 0.05, p50: 0.02, good: 5, needs: 0, poor: 0 },
    ];
    const ok = await run(async (name, args) => (name === "web_vitals_summary" && args.p_days === 28 ? { data: rows, error: null } : { data: null, error: { message: "wrong call" } }));
    if (!/🟢 2\.00 ث/.test(ok)) return "LCP جوال 2000 يجب أن يكون 🟢 «2.00 ث»: " + ok.slice(0, 300);
    if (!/🔴 5\.20 ث/.test(ok)) return "LCP حاسوب 5200 يجب أن يكون 🔴";
    if (!/🟠 300 م\.ث/.test(ok)) return "INP 300 يجب أن يكون 🟠 (يحتاج تحسين)";
    if (!/⚪ 0\.050/.test(ok) || !/عيّنة قليلة/.test(ok)) return "عيّنة قليلة (5) يجب أن تظهر رمادية مع تنبيه";
    if (!/لا بيانات/.test(ok)) return "الغياب (FCP/TTFB) يجب أن يظهر «لا بيانات»";
    const empty = await run(async () => ({ data: [], error: null }));
    if (!/لا توجد قياسات بعد/.test(empty)) return "حالة بلا بيانات خاطئة";
    const missing = await run(async () => ({ data: null, error: { message: "Could not find the function public.web_vitals_summary(p_days) in the schema cache" } }));
    if (!/migration_web_vitals\.sql/.test(missing)) return "رسالة التفعيل غير ظاهرة عند غياب الدالة";
    const other = await run(async () => ({ data: null, error: { message: "network down" } }));
    if (!/تعذّر تحميل سرعة الموقع/.test(other)) return "رسالة الخطأ العامة خاطئة";
    return true;
  }],
  // #45 صلاحيات: الحالة والسرعة وإضافة المدن/الأحياء للمالك وحده
  ["لوحة الإدارة: بطاقتا حالة الوظائف وسرعة الزوّار وإضافة المدن/الأحياء للمالك فقط (واجهة + عدم التحميل لغيره)", async () => {
    const html = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
    const js = fs.readFileSync(path.join(ROOT, "js", "admin.js"), "utf8");
    const css = fs.readFileSync(path.join(ROOT, "css", "admin.css"), "utf8");
    const card = (id) => { const i = html.indexOf('id="' + id + '"'); const o = html.lastIndexOf('<div class="card"', i); return html.slice(o, html.indexOf(">", o)); };
    if (!/data-owner-only/.test(card("job-status-list"))) return "بطاقة حالة الوظائف ليست data-owner-only";
    if (!/data-owner-only/.test(card("web-vitals-box"))) return "بطاقة سرعة الزوّار ليست data-owner-only";
    if (!/body\[data-role="editor"\] \[data-owner-only\]\s*\{\s*display:none/.test(css) || !/body\[data-role="viewer"\] \[data-owner-only\]/.test(css)) return "قاعدة CSS لإخفاء owner-only عن المحرّر/المشاهد غير موجودة";
    const m = html.match(/<section class="tab-panel" id="panel-cities">[\s\S]*?<\/section>/);
    if (!m) return "لوحة المدن غير موجودة";
    const adds = (m[0].match(/<div class="card" style="flex:1 1 320px;padding:20px"[^>]*>/g) || []);
    if (adds.length !== 3 || adds.some(t => !/data-owner-only/.test(t))) return "بطاقات إضافة المدن/الأحياء الثلاث يجب أن تكون owner-only";
    if (!/if \(currentUserRole === 'owner'\)\{\s*loadJobStatus\(\);\s*loadWebVitals\(\);\s*\}/.test(js)) return "loadDashboard تحمّل الحالة/السرعة لغير المالك";
    return true;
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
