import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDateRange } from "@/lib/date-utils";
import { getSession } from "@/lib/auth";
import { corretoresDaUnidade } from "@/lib/unidade";

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getDb();
  const { since, until } = parseDateRange(req.nextUrl.searchParams);
  const corretorIds = await corretoresDaUnidade(sql, session.unidade, session.tipo);
  const escopo = sql`(${corretorIds}::int[] IS NULL OR corretor_id = ANY(${corretorIds}::int[]))`;

  const resumo = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(corretor_nome) as com_corretor,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Venda') as vendas,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Aluguel') as alugueis
    FROM lais_visitas
    WHERE data_visita >= ${since} AND data_visita <= ${until}::date + 1 AND ${escopo}`;

  // referencia_imovel vinha de imoveis.codigo, que está gravado como "0" na
  // maioria das linhas (ver scripts/visitas-lais-gerentes.js) — a ref de
  // verdade da Lais é id_imovel ("L58235"), sempre preenchida. A parte
  // numérica do id_imovel É o imoveis.id (letra = locação/venda) — usa isso
  // pra trazer o valor, já que lais_visitas não guarda valor nenhum.
  const visitas = await sql`
    SELECT lv.id, lv.nome, lv.email, lv.tipo_transacao, lv.origem, lv.data_visita,
      lv.localizacao, lv.corretor_nome,
      COALESCE(NULLIF(lv.referencia_imovel, '0'), lv.id_imovel) as referencia_imovel,
      lv.match_method,
      CASE WHEN lv.tipo_transacao = 'Venda' THEN im.valor ELSE im.valor_locacao END as valor
    FROM lais_visitas lv
    LEFT JOIN imoveis im ON im.id = NULLIF(regexp_replace(COALESCE(lv.id_imovel, ''), '\\D', '', 'g'), '')::int
    WHERE lv.data_visita >= ${since} AND lv.data_visita <= ${until}::date + 1
      AND (${corretorIds}::int[] IS NULL OR lv.corretor_id = ANY(${corretorIds}::int[]))
    ORDER BY lv.data_visita DESC`;

  const porCorretor = await sql`
    SELECT COALESCE(corretor_nome, 'Não identificado') as corretor,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Venda') as vendas,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Aluguel') as alugueis
    FROM lais_visitas
    WHERE data_visita >= ${since} AND data_visita <= ${until}::date + 1 AND ${escopo}
    GROUP BY COALESCE(corretor_nome, 'Não identificado')
    ORDER BY total DESC`;

  const porMes = await sql`
    SELECT TO_CHAR(data_visita, 'YYYY-MM') as mes,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Venda') as vendas,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Aluguel') as alugueis
    FROM lais_visitas
    WHERE data_visita >= ${since} AND data_visita <= ${until}::date + 1 AND ${escopo}
    GROUP BY TO_CHAR(data_visita, 'YYYY-MM')
    ORDER BY mes`;

  const porOrigem = await sql`
    SELECT COALESCE(origem, 'Não informado') as origem, COUNT(*) as total
    FROM lais_visitas
    WHERE data_visita >= ${since} AND data_visita <= ${until}::date + 1 AND ${escopo}
    GROUP BY COALESCE(origem, 'Não informado')
    ORDER BY total DESC`;

  const porDia = await sql`
    SELECT data_visita::date as dia, COUNT(*) as total
    FROM lais_visitas
    WHERE data_visita >= ${since} AND data_visita <= ${until}::date + 1 AND ${escopo}
    GROUP BY data_visita::date
    ORDER BY dia`;

  return NextResponse.json({
    resumo: resumo[0],
    visitas,
    por_corretor: porCorretor,
    por_mes: porMes,
    por_origem: porOrigem,
    por_dia: porDia,
  });
}
