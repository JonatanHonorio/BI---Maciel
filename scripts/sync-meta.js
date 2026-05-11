#!/usr/bin/env node
/**
 * Sync Meta Ads → BI Maciel
 * Puxa campanhas e insights diários da API do Meta Ads
 * Uso: node scripts/sync-meta.js [--days 30]
 */

const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);
const TOKEN = process.env.META_ADS_ACCESS_TOKEN;
const ACCOUNT = process.env.META_ADS_ACCOUNT_ID;
const API_VERSION = "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

async function fetchMeta(endpoint, params = {}) {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set("access_token", TOKEN);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Meta API error: ${err.error?.message || res.statusText}`);
  }
  return res.json();
}

async function fetchAllPages(endpoint, params = {}) {
  let all = [];
  let data = await fetchMeta(endpoint, { ...params, limit: "500" });
  all.push(...(data.data || []));

  while (data.paging?.next) {
    const res = await fetch(data.paging.next);
    data = await res.json();
    all.push(...(data.data || []));
  }

  return all;
}

async function syncCampaigns() {
  console.log("📢 Sincronizando campanhas...");

  const campaigns = await fetchAllPages(`${ACCOUNT}/campaigns`, {
    fields: "name,status,objective,daily_budget,lifetime_budget",
  });

  for (const c of campaigns) {
    await sql`INSERT INTO meta_campanhas (id, nome, status, objetivo, budget_diario, budget_total, updated_at)
      VALUES (${c.id}, ${c.name}, ${c.status}, ${c.objective || ""}, ${(c.daily_budget || 0) / 100}, ${(c.lifetime_budget || 0) / 100}, NOW())
      ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, status=EXCLUDED.status, objetivo=EXCLUDED.objetivo, budget_diario=EXCLUDED.budget_diario, budget_total=EXCLUDED.budget_total, updated_at=NOW()`;
  }

  console.log(`   ✅ ${campaigns.length} campanhas`);
  return campaigns;
}

async function syncAdSets() {
  console.log("📦 Sincronizando conjuntos de anúncios...");

  const adsets = await fetchAllPages(`${ACCOUNT}/adsets`, {
    fields: "name,status,campaign_id,daily_budget",
  });

  for (const a of adsets) {
    await sql`INSERT INTO meta_conjuntos (id, campanha_id, nome, status, budget_diario, updated_at)
      VALUES (${a.id}, ${a.campaign_id}, ${a.name}, ${a.status}, ${(a.daily_budget || 0) / 100}, NOW())
      ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, status=EXCLUDED.status, budget_diario=EXCLUDED.budget_diario, updated_at=NOW()`;
  }

  console.log(`   ✅ ${adsets.length} conjuntos`);
}

function getAction(actions, type) {
  const a = (actions || []).find((x) => x.action_type === type);
  return a ? parseInt(a.value) : 0;
}

async function syncInsights(days) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split("T")[0];
  const untilStr = new Date().toISOString().split("T")[0];

  console.log(`📊 Sincronizando insights (adset) de ${sinceStr} a ${untilStr}...`);

  const insights = await fetchAllPages(`${ACCOUNT}/insights`, {
    fields: "campaign_id,adset_id,spend,impressions,clicks,cpc,cpm,ctr,reach,actions",
    time_range: { since: sinceStr, until: untilStr },
    time_increment: "1",
    level: "adset",
    limit: "500",
  });

  let count = 0;
  for (const row of insights) {
    const actions = row.actions || [];
    const lpViews = getAction(actions, "landing_page_view");

    await sql`INSERT INTO meta_insights_diarios
      (campanha_id, conjunto_id, data, impressoes, cliques, gasto, cpc, cpm, ctr, alcance, leads, conversas_iniciadas, link_clicks, video_views, landing_page_views)
      VALUES (
        ${row.campaign_id}, ${row.adset_id || ""}, ${row.date_start},
        ${parseInt(row.impressions || 0)}, ${parseInt(row.clicks || 0)},
        ${parseFloat(row.spend || 0)}, ${parseFloat(row.cpc || 0)},
        ${parseFloat(row.cpm || 0)}, ${parseFloat(row.ctr || 0)},
        ${parseInt(row.reach || 0)},
        ${getAction(actions, "lead") + getAction(actions, "onsite_conversion.lead_grouped")},
        ${getAction(actions, "onsite_conversion.messaging_conversation_started_7d")},
        ${getAction(actions, "link_click")},
        ${getAction(actions, "video_view")},
        ${lpViews}
      )
      ON CONFLICT (campanha_id, conjunto_id, data) DO UPDATE SET
        impressoes=EXCLUDED.impressoes, cliques=EXCLUDED.cliques, gasto=EXCLUDED.gasto,
        cpc=EXCLUDED.cpc, cpm=EXCLUDED.cpm, ctr=EXCLUDED.ctr, alcance=EXCLUDED.alcance,
        leads=EXCLUDED.leads, conversas_iniciadas=EXCLUDED.conversas_iniciadas,
        link_clicks=EXCLUDED.link_clicks, video_views=EXCLUDED.video_views,
        landing_page_views=EXCLUDED.landing_page_views`;
    count++;
  }

  console.log(`   ✅ ${count} registros de insights (adset)`);
}

async function syncAds() {
  console.log("🎨 Sincronizando anúncios (criativos)...");

  const ads = await fetchAllPages(`${ACCOUNT}/ads`, {
    fields: "name,status,campaign_id,adset_id,creative{id,name,thumbnail_url,object_type}",
  });

  let count = 0;
  for (const ad of ads) {
    const creative = ad.creative || {};
    const tipo = creative.object_type || "UNKNOWN";
    const thumb = creative.thumbnail_url || null;

    await sql`INSERT INTO meta_anuncios (id, campanha_id, conjunto_id, nome, status, tipo_criativo, thumbnail_url, updated_at)
      VALUES (${ad.id}, ${ad.campaign_id}, ${ad.adset_id}, ${ad.name}, ${ad.status}, ${tipo}, ${thumb}, NOW())
      ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, status=EXCLUDED.status, tipo_criativo=EXCLUDED.tipo_criativo, thumbnail_url=EXCLUDED.thumbnail_url, updated_at=NOW()`;
    count++;
  }

  console.log(`   ✅ ${count} anúncios`);
}

async function syncAdInsights(days) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split("T")[0];
  const untilStr = new Date().toISOString().split("T")[0];

  console.log(`📊 Sincronizando insights (anúncio) de ${sinceStr} a ${untilStr}...`);

  const insights = await fetchAllPages(`${ACCOUNT}/insights`, {
    fields: "ad_id,campaign_id,spend,impressions,clicks,cpc,cpm,ctr,reach,actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions",
    time_range: { since: sinceStr, until: untilStr },
    time_increment: "1",
    level: "ad",
    limit: "500",
  });

  let count = 0;
  for (const row of insights) {
    const actions = row.actions || [];
    const vp25 = row.video_p25_watched_actions ? parseInt(row.video_p25_watched_actions[0]?.value || 0) : 0;
    const vp50 = row.video_p50_watched_actions ? parseInt(row.video_p50_watched_actions[0]?.value || 0) : 0;
    const vp75 = row.video_p75_watched_actions ? parseInt(row.video_p75_watched_actions[0]?.value || 0) : 0;
    const vp100 = row.video_p100_watched_actions ? parseInt(row.video_p100_watched_actions[0]?.value || 0) : 0;

    await sql`INSERT INTO meta_anuncio_insights
      (anuncio_id, campanha_id, data, impressoes, cliques, gasto, ctr, cpc, cpm, alcance, leads, conversas_iniciadas, link_clicks, video_views, video_p25, video_p50, video_p75, video_p100, landing_page_views)
      VALUES (
        ${row.ad_id}, ${row.campaign_id}, ${row.date_start},
        ${parseInt(row.impressions || 0)}, ${parseInt(row.clicks || 0)},
        ${parseFloat(row.spend || 0)}, ${parseFloat(row.ctr || 0)},
        ${parseFloat(row.cpc || 0)}, ${parseFloat(row.cpm || 0)},
        ${parseInt(row.reach || 0)},
        ${getAction(actions, "lead") + getAction(actions, "onsite_conversion.lead_grouped")},
        ${getAction(actions, "onsite_conversion.messaging_conversation_started_7d")},
        ${getAction(actions, "link_click")},
        ${getAction(actions, "video_view")},
        ${vp25}, ${vp50}, ${vp75}, ${vp100},
        ${getAction(actions, "landing_page_view")}
      )
      ON CONFLICT (anuncio_id, data) DO UPDATE SET
        impressoes=EXCLUDED.impressoes, cliques=EXCLUDED.cliques, gasto=EXCLUDED.gasto,
        ctr=EXCLUDED.ctr, cpc=EXCLUDED.cpc, cpm=EXCLUDED.cpm, alcance=EXCLUDED.alcance,
        leads=EXCLUDED.leads, conversas_iniciadas=EXCLUDED.conversas_iniciadas,
        link_clicks=EXCLUDED.link_clicks, video_views=EXCLUDED.video_views,
        video_p25=EXCLUDED.video_p25, video_p50=EXCLUDED.video_p50,
        video_p75=EXCLUDED.video_p75, video_p100=EXCLUDED.video_p100,
        landing_page_views=EXCLUDED.landing_page_views`;
    count++;
  }

  console.log(`   ✅ ${count} registros de insights (anúncio)`);
}

async function main() {
  const daysArg = process.argv.indexOf("--days");
  const days = daysArg !== -1 ? parseInt(process.argv[daysArg + 1]) : 30;

  console.log("\n🔄 Sync Meta Ads → BI Maciel\n");

  await syncCampaigns();
  await syncAdSets();
  await syncAds();
  await syncInsights(days);
  await syncAdInsights(days);

  await sql`INSERT INTO importacoes (tipo, registros, status)
    VALUES ('meta_ads', 0, 'ok')`;

  console.log("\n✅ Sync completo!\n");
}

main().catch((err) => {
  console.error("❌ Erro:", err.message);
  process.exit(1);
});
