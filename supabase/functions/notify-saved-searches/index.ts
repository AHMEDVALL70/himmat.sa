// ============================================================================
// notify-saved-searches — Supabase Edge Function (Deno)
// ============================================================================
// ميزة "نبّهني" — يُشغَّل يومياً (نفس نمط update-district-prices/
// generate-snapshot)، يقارن كل بحث محفوظ (saved_searches, notified=false)
// بالعروض المنشورة الحالية. أول تطابق يلقاه:
//   - عنده بريد إلكتروني → يُرسَل له مباشرة برابط العرض المطابق (رابط
//     حقيقي /offer/<id>/ من المستوى الثاني لإصلاح السيو — نفس البنية).
//   - رقم جوال بس بدون بريد (لا نقدر نرسل تلقائياً — SMS/واتساب التلقائي
//     غير متوفرين بعد) → يُرسَل تنبيه داخلي لفريقنا للمتابعة اليدوية.
// بالحالتين، notified تصير true بعد أول تطابق — إشعار واحد لكل بحث.
//
// نفس أسرار Resend الموجودة أصلاً بالمشروع (send-reminders):
//   RESEND_API_KEY, NOTIFICATIONS_FROM_EMAIL
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") || "onboarding@resend.dev";
const SITE_ORIGIN = "https://himmat.sa";

// بريدي الفريق لتنبيهات الحالات اللي عندها جوال بس بدون بريد إلكتروني.
const TEAM_ALERT_EMAILS = ["ahmedvalljemaldine@gmail.com", "Fadhel-906@hotmail.com"];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function money(n?: number | null) {
  return n ? Math.round(n).toLocaleString("en-US") : "—";
}

async function sendEmail(to: string[], subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.log("[email skipped — RESEND_API_KEY غير مضبوط]", to, subject);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `همة المدينة العقارية <${FROM_EMAIL}>`,
        to,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error("فشل إرسال البريد عبر Resend:", res.status, await res.text());
    } else {
      console.log("[email sent]", to, subject);
    }
  } catch (e) {
    console.error("خطأ أثناء إرسال البريد:", e);
  }
}

function offerRowHtml(o: any) {
  const url = `${SITE_ORIGIN}/offer/${o.id}/`;
  return `<li style="margin-bottom:10px">
      <a href="${url}" style="color:#b8860b;font-weight:bold">${o.title}</a> —
      ${o.district ? o.district + '، ' : ''}${o.city} — ${money(o.price_final)} ريال سعودي
    </li>`;
}

async function handleOne(search: any) {
  let query = supabase
    .from("offers")
    .select("id, title, city, district, price_final")
    .eq("is_published", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(3);

  if (search.city) query = query.eq("city", search.city);
  if (search.property_type) query = query.eq("property_type", search.property_type);
  if (search.max_price) query = query.lte("price_final", search.max_price);
  if (search.min_rooms) query = query.gte("rooms", search.min_rooms);

  const { data: matches, error } = await query;
  if (error) {
    console.error("[notify-saved-searches] خطأ بجلب العروض المطابقة:", error.message);
    return false;
  }
  if (!matches || matches.length === 0) return false;

  const criteriaLine = [
    search.property_type,
    search.city,
    search.max_price ? `حتى ${money(search.max_price)} ريال` : null,
    search.min_rooms ? `${search.min_rooms}+ غرف` : null,
  ].filter(Boolean).join(" — ");

  if (search.contact_email) {
    await sendEmail(
      [search.contact_email],
      "وجدنا عقاراً يطابق بحثك — همة المدينة العقارية",
      `<div style="font-family:Tahoma,Arial,sans-serif;line-height:1.9;color:#152435">
        <p>مرحباً،</p>
        <p>بحثك المحفوظ (<b>${criteriaLine || "بحث عام"}</b>) عنده تطابق جديد فعلاً:</p>
        <ul>${matches.map(offerRowHtml).join("")}</ul>
        <p>تقدر تتصفح باقي العروض أو تعدّل بحثك من <a href="${SITE_ORIGIN}/offers">صفحة العروض</a>.</p>
        <p style="color:#546678;font-size:13px;margin-top:24px">همة المدينة العقارية — رخصة فال: 1200030428</p>
      </div>`
    );
  } else {
    await sendEmail(
      TEAM_ALERT_EMAILS,
      "🔔 تطابق بحث محفوظ (جوال بس) — يحتاج متابعة يدوية",
      `<div style="font-family:Tahoma,Arial,sans-serif;line-height:1.9;color:#152435">
        <p>عميل حفظ بحث (${criteriaLine || "بحث عام"}) بدون بريد إلكتروني، رقم جواله:
          <b dir="ltr">${search.contact_phone}</b></p>
        <p>عندنا عرض/عروض تطابق طلبه الآن — يستاهل تواصل يدوي (واتساب/اتصال):</p>
        <ul>${matches.map(offerRowHtml).join("")}</ul>
      </div>`
    );
  }

  await supabase.from("saved_searches").update({ notified: true }).eq("id", search.id);
  return true;
}

Deno.serve(async (req) => {
  // حماية إضافية (2026-09-24): نفس القاعدة المطبَّقة على update-district-prices
  // — تشغيل مقصور على مفتاح service_role (الجدولة التلقائية)، صفر تأثير عليها.
  const providedKey = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (providedKey !== SERVICE_KEY) {
    return new Response(JSON.stringify({ status: "error", message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const startedAt = Date.now();
  try {
    const { data: searches, error } = await supabase
      .from("saved_searches")
      .select("*")
      .eq("notified", false);

    if (error) throw error;

    let matched = 0;
    for (const search of searches ?? []) {
      const found = await handleOne(search);
      if (found) matched++;
    }

    await supabase.from("job_runs").insert({
      job_name: "notify-saved-searches",
      status: "success",
      summary: { total: (searches ?? []).length, matched },
      started_at: new Date(startedAt).toISOString(),
    });
    return new Response(JSON.stringify({ status: "ok", total: (searches ?? []).length, matched }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    await supabase.from("job_runs").insert({
      job_name: "notify-saved-searches",
      status: "failed",
      summary: { message: String(err) },
      started_at: new Date(startedAt).toISOString(),
    });
    return new Response(JSON.stringify({ status: "error", message: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
