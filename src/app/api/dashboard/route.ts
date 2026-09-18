import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDateRange } from "@/lib/date-utils";
import { getSession } from "@/lib/auth";
import { corretoresDaUnidade, correcoesManuais } from "@/lib/unidade";

const EMPRESA_UNIDADE: Record<number, string> = {
  1: "Satélite",
  2: "Esplanada",
  3: "Pq. Industrial",
  4: "Vista Verde",
  5: "Dutra",
  6: "Aquarius",
  9: "Urbanova",
};

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getDb();
  const { since, until } = parseDateRange(req.nextUrl.searchParams);
  const corretorIds = await corretoresDaUnidade(sql, session.unidade, session.tipo);
  const semRestricao = corretorIds === null;

  // `responsavel_atual` = corretor mais recente por lead (mesma regra do resto do BI —
  // ver comentário em lead_responsaveis no schema.sql). É por aí que "leads" é escopado,
  // nunca por leads.corretor_id (aponta pra caixa da unidade, não pra pessoa).
  const [leads] = await sql`
    WITH responsavel_atual AS (
      SELECT DISTINCT ON (lead_id) lead_id, corretor_id
      FROM lead_responsaveis WHERE corretor_id > 0
      ORDER BY lead_id, data DESC NULLS LAST, id DESC
    )
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE l.locacao_venda = 'V') as venda,
      COUNT(*) FILTER (WHERE l.locacao_venda = 'L') as locacao
    FROM leads l
    LEFT JOIN responsavel_atual ra ON ra.lead_id = l.id
    WHERE l.data_inicio >= ${since} AND l.data_inicio <= ${until}::date + 1
      AND (${corretorIds}::int[] IS NULL OR ra.corretor_id = ANY(${corretorIds}::int[]))`;

  const [propostas] = await sql`
    SELECT COUNT(*) as total FROM propostas
    WHERE data >= ${since} AND data <= ${until}::date + 1
      AND (${corretorIds}::int[] IS NULL OR corretor_id = ANY(${corretorIds}::int[]))`;

  const [conversoes] = await sql`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(valor), 0) as receita,
      COALESCE(SUM(valor) FILTER (WHERE locacao_venda = 'V'), 0) as receita_venda,
      COALESCE(SUM(valor) FILTER (WHERE locacao_venda = 'L'), 0) as receita_locacao,
      COUNT(*) FILTER (WHERE locacao_venda = 'V') as vendas,
      COUNT(*) FILTER (WHERE locacao_venda = 'L') as locacoes
    FROM conversoes c
    WHERE c.data_assinatura >= ${since} AND c.data_assinatura <= ${until}
      AND (${corretorIds}::int[] IS NULL OR EXISTS (
        SELECT 1 FROM conversao_corretores cc
        WHERE cc.conversao_id = c.id AND cc.corretor_id = ANY(${corretorIds}::int[])
      ))`;

  // Marketing é bloco à parte: quem não tem acesso a tráfego nem consulta o gasto.
  let trafego = null;
  if (session.marketing) {
    const [t] = await sql`
      SELECT
        COALESCE(SUM(gasto), 0) as investimento,
        COALESCE(SUM(impressoes), 0) as impressoes,
        COALESCE(SUM(cliques), 0) as cliques,
        COALESCE(SUM(leads), 0) as leads_trafego,
        COALESCE(SUM(conversas_iniciadas), 0) as conversas
      FROM meta_insights_diarios WHERE data >= ${since} AND data <= ${until}`;
    const investimento = Number(t.investimento);
    const leadsTotal = Number(leads.total);
    trafego = {
      investimento,
      impressoes: Number(t.impressoes),
      cliques: Number(t.cliques),
      leads: Number(t.leads_trafego),
      conversas: Number(t.conversas),
      cpl: leadsTotal > 0 ? investimento / leadsTotal : 0,
      roas: investimento > 0 ? Number(conversoes.receita) / investimento : 0,
    };
  }

  // Site de visitas não tem corretor/unidade no schema — só faz sentido pro admin.
  let visitasSite = 0;
  if (semRestricao) {
    const [visitas] = await sql`
      SELECT COUNT(*) as total FROM imovel_visitas
      WHERE data >= ${since} AND data <= ${until}::date + 1`;
    visitasSite = Number(visitas.total);
  }

  // Metas são da empresa inteira, sem quebra por unidade — não é "número dele".
  let metas = null;
  if (session.role === "admin") {
    const [m] = await sql`
      SELECT * FROM metas WHERE mes = date_trunc('month', ${since}::date) LIMIT 1`;
    metas = m || null;
  }

  // DISTINCT: protege contra linha de rateio duplicada em conversao_corretores
  // (mesmo corretor lançado 2x no mesmo negócio) — sem isso o valor da
  // conversão entra 2x na soma.
  const receitaUnidadeRows = await sql`
    SELECT DISTINCT c.id as conversao_id, c.valor, c.locacao_venda,
      cor.id as corretor_id, cor.empresa
    FROM conversoes c
    JOIN conversao_corretores cc ON cc.conversao_id = c.id
    JOIN corretores cor ON cor.id = cc.corretor_id
    WHERE c.data_assinatura >= ${since} AND c.data_assinatura <= ${until}
      AND (${corretorIds}::int[] IS NULL OR cc.corretor_id = ANY(${corretorIds}::int[]))`;

  // Agrupa por unidade "corrigida": parte da empresa cadastrada no Kurole,
  // mas aplica correcoes_manuais.json (mesma correção usada em
  // corretoresDaUnidade/unidadeDoCorretor) — sem isso um corretor que já foi
  // realocado pra outra unidade (ex: cadastro errado no Kurole) aparece com
  // a receita num card de unidade errada.
  const correcoes = correcoesManuais().unidade_por_corretor;
  const porUnidade = new Map<
    string,
    { receita: number; receita_venda: number; receita_locacao: number; conversoes: number }
  >();
  const conversoesVistas = new Set<string>();
  for (const r of receitaUnidadeRows) {
    let unidade = EMPRESA_UNIDADE[r.empresa as number] ?? "Outro";
    const correcao = correcoes[String(r.corretor_id)];
    if (correcao && unidade === correcao.de) unidade = correcao.para;

    // Uma conversão só conta 1x pra cada unidade, mesmo com 2+ corretores
    // dela no rateio (ex: levantamento + fechamento do mesmo escritório).
    const chave = `${r.conversao_id}|${unidade}`;
    if (conversoesVistas.has(chave)) continue;
    conversoesVistas.add(chave);

    const acc = porUnidade.get(unidade) ?? { receita: 0, receita_venda: 0, receita_locacao: 0, conversoes: 0 };
    const valor = Number(r.valor);
    acc.receita += valor;
    if (r.locacao_venda === "V") acc.receita_venda += valor;
    else acc.receita_locacao += valor;
    acc.conversoes += 1;
    porUnidade.set(unidade, acc);
  }
  const receitaUnidade = [...porUnidade.entries()]
    .map(([unidade, v]) => ({ unidade, ...v }))
    .sort((a, b) => b.receita - a.receita);

  return NextResponse.json({
    periodo: { since, until },
    leads: {
      total: Number(leads.total),
      venda: Number(leads.venda),
      locacao: Number(leads.locacao),
    },
    propostas: Number(propostas.total),
    conversoes: {
      total: Number(conversoes.total),
      vendas: Number(conversoes.vendas),
      locacoes: Number(conversoes.locacoes),
      receita: Number(conversoes.receita),
      receita_venda: Number(conversoes.receita_venda),
      receita_locacao: Number(conversoes.receita_locacao),
    },
    trafego,
    visitas_site: visitasSite,
    receita_unidade: receitaUnidade.map((r) => ({
      unidade: r.unidade,
      receita: Number(r.receita),
      receita_venda: Number(r.receita_venda),
      receita_locacao: Number(r.receita_locacao),
      conversoes: Number(r.conversoes),
    })),
    metas,
  });
}
