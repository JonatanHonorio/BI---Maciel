import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDateRange } from "@/lib/date-utils";

/**
 * Ranking de criativos por produto.
 *
 * O nome da campanha nao revela o produto anunciado — "IMOVEIS TERCEIROS",
 * por exemplo, roda Casa do Cristian. Por isso o produto e o tipo de
 * resultado sao mapeados aqui pelo ID da campanha.
 */
const CAMPANHAS = {
  "120238196154690348": { produto: "Casa do Cristian", tipo: "conv", campanha: "Cristian I.A" },
  "120223270230350348": { produto: "Casa do Cristian", tipo: "conv", campanha: "Terceiros WhatsApp" },
  "120247189968180348": { produto: "Casa do Cristian", tipo: "lead", campanha: "Terceiros Formulário" },
  "120252961921950348": { produto: "Vila Amélia", tipo: "lead", campanha: "Vila Amélia Teste AB" },
  "120250848034760348": { produto: "Vila Amélia", tipo: "conv", campanha: "Vila Amélia Conversas" },
  "120254277067030348": { produto: "Quadria", tipo: "lead", campanha: "Quadria Vista Verde" },
} as const;

/** Investimento minimo para o custo por resultado ser confiavel. */
const MIN_GASTO = 50;

type Tipo = "lead" | "conv";

interface Criativo {
  nome: string;
  produto: string;
  campanha: string;
  tipo: Tipo;
  thumbnail_url: string | null;
  preview_url: string | null;
  gasto: number;
  resultados: number;
  impressoes: number;
  cliques: number;
  custo_por_resultado: number | null;
  ctr: number;
}

export async function GET(req: NextRequest) {
  const sql = getDb();
  const { since, until } = parseDateRange(req.nextUrl.searchParams);
  const campanhaIds = Object.keys(CAMPANHAS);

  const rows = await sql`
    SELECT
      a.nome,
      a.campanha_id,
      MAX(a.thumbnail_url) as thumbnail_url,
      MAX(a.preview_url) as preview_url,
      COALESCE(SUM(i.gasto), 0) as gasto,
      COALESCE(SUM(i.impressoes), 0) as impressoes,
      COALESCE(SUM(i.cliques), 0) as cliques,
      COALESCE(SUM(i.leads), 0) as leads,
      COALESCE(SUM(i.conversas_iniciadas), 0) as conversas
    FROM meta_anuncios a
    JOIN meta_anuncio_insights i ON i.anuncio_id = a.id
      AND i.data >= ${since} AND i.data <= ${until}
    WHERE a.campanha_id = ANY(${campanhaIds})
    GROUP BY a.nome, a.campanha_id
    HAVING SUM(i.gasto) > 0
    ORDER BY gasto DESC`;

  // Um mesmo criativo roda em varios conjuntos: agrupa por produto + tipo + nome.
  const mapa = new Map<string, Criativo>();

  for (const r of rows) {
    const cfg = CAMPANHAS[r.campanha_id as keyof typeof CAMPANHAS];
    if (!cfg) continue;

    const nome = String(r.nome || "")
      .replace(/^AD\s*/i, "")
      .replace(/\s*-\s*(Vila Amelia|Vila Amélia|Quadria Vista Verde)\s*$/i, "")
      .replace(/\s*\d{2}\/\d{2}\s*$/, "")
      .trim() || String(r.nome);

    const chave = `${cfg.produto}|${cfg.tipo}|${nome}`;
    const atual = mapa.get(chave) ?? {
      nome,
      produto: cfg.produto,
      campanha: cfg.campanha,
      tipo: cfg.tipo as Tipo,
      thumbnail_url: r.thumbnail_url,
      preview_url: r.preview_url,
      gasto: 0,
      resultados: 0,
      impressoes: 0,
      cliques: 0,
      custo_por_resultado: null,
      ctr: 0,
    };

    atual.gasto += Number(r.gasto);
    atual.resultados += Number(cfg.tipo === "lead" ? r.leads : r.conversas);
    atual.impressoes += Number(r.impressoes);
    atual.cliques += Number(r.cliques);
    if (!atual.thumbnail_url) atual.thumbnail_url = r.thumbnail_url;
    if (!atual.preview_url) atual.preview_url = r.preview_url;

    mapa.set(chave, atual);
  }

  const criativos = [...mapa.values()].map((c) => ({
    ...c,
    custo_por_resultado: c.resultados > 0 ? c.gasto / c.resultados : null,
    ctr: c.impressoes > 0 ? (c.cliques / c.impressoes) * 100 : 0,
  }));

  const ranking = criativos
    .filter((c) => c.resultados > 0 && c.gasto >= MIN_GASTO)
    .sort((a, b) => (a.custo_por_resultado ?? 0) - (b.custo_por_resultado ?? 0));

  const semVolume = criativos
    .filter((c) => !(c.resultados > 0 && c.gasto >= MIN_GASTO))
    .sort((a, b) => b.gasto - a.gasto);

  return NextResponse.json({
    periodo: { since, until },
    min_gasto: MIN_GASTO,
    total_gasto: criativos.reduce((s, c) => s + c.gasto, 0),
    total_resultados: criativos.reduce((s, c) => s + c.resultados, 0),
    total_criativos: criativos.length,
    ranking,
    sem_volume: semVolume,
  });
}
