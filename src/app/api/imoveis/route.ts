import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDateRange } from "@/lib/date-utils";
import { getSession } from "@/lib/auth";
import { corretoresDaUnidade, unidadeDoDepartamento } from "@/lib/unidade";

// Logins que a diretoria pediu para NÃO contar como captação de unidade —
// mesma lista de scripts/unidade_captacao.py (DIRETORIA_IDS), fixada por id
// de propósito (casar por nome pegaria homônimos).
const IDS_DIRETORIA = [775, 279, 182, 272];

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getDb();
  const { since, until } = parseDateRange(req.nextUrl.searchParams);
  const corretorIds = await corretoresDaUnidade(sql, session.unidade, session.tipo);
  // A diretoria (admin) enxerga as próprias captações; só os gerentes não veem.
  const idsExcluirDiretoria = session.role === "admin" ? [] : IDS_DIRETORIA;

  // Imóvel não tem unidade própria no schema — o escopo é "captado pelo time
  // dele" (imovel_captadores), único vínculo que existe entre imóvel e corretor.
  const doTime = sql`(${corretorIds}::int[] IS NULL OR i.id IN (
    SELECT imovel_id FROM imovel_captadores WHERE corretor_id = ANY(${corretorIds}::int[])
  ))`;

  const maisVisitados = await sql`
    SELECT i.id, i.codigo, i.titulo, i.tipo_imovel, i.bairro, i.cidade,
      i.valor, i.locacao_venda, i.dormitorios, COUNT(v.*) as visitas
    FROM imovel_visitas v
    JOIN imoveis i ON i.id = v.imovel_id
    WHERE v.data >= ${since} AND v.data <= ${until}::date + 1 AND ${doTime}
    GROUP BY i.id ORDER BY visitas DESC LIMIT 20`;

  const porTipo = await sql`
    SELECT COALESCE(tipo_imovel, 'Outros') as tipo, COUNT(*) as total,
      AVG(valor) as valor_medio
    FROM imoveis i WHERE valor > 0 AND ${doTime}
    GROUP BY COALESCE(tipo_imovel, 'Outros') ORDER BY total DESC LIMIT 15`;

  const porBairro = await sql`
    SELECT COALESCE(bairro, 'N/A') as bairro, COUNT(*) as total,
      AVG(valor) FILTER (WHERE locacao_venda IN ('V', 'VE', 'LV', 'LVE')) as valor_medio_venda,
      AVG(valor) FILTER (WHERE locacao_venda IN ('L', 'LE', 'LV', 'LVE')) as valor_medio_locacao
    FROM imoveis i WHERE valor > 0 AND ${doTime}
    GROUP BY COALESCE(bairro, 'N/A') ORDER BY total DESC LIMIT 20`;

  const estoque = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE locacao_venda IN ('V', 'VE', 'LV', 'LVE')) as venda,
      COUNT(*) FILTER (WHERE locacao_venda IN ('L', 'LE', 'LV', 'LVE')) as locacao,
      AVG(valor) FILTER (WHERE valor > 0) as valor_medio
    FROM imoveis i WHERE ${doTime}`;

  const visitasPorDia = await sql`
    SELECT v.data::date as dia, COUNT(*) as total
    FROM imovel_visitas v
    JOIN imoveis i ON i.id = v.imovel_id
    WHERE v.data >= ${since} AND v.data <= ${until}::date + 1 AND ${doTime}
    GROUP BY dia ORDER BY dia`;

  // Imóveis parados: sem atualização de cadastro há mais de 90 dias E ainda
  // com status "Disponível" no Kurole (situacao_codigo_venda/locacao = 1 —
  // confirmado em 15/09/2026 comparando contra a planilha que o Jonatan já
  // mandava pros gerentes). Sem esse filtro o número mistura estoque
  // vendido/alugado/reservado com o que ainda está disponível — inflava de
  // ~3.200 pra ~28.600. Fonte: imoveis.data_atualizacao (já vem do dump),
  // não depende de export manual do Kurole como a skill `unidade-captacao`.
  // Sem data de atualização não entra — não dá pra afirmar que está
  // desatualizado sem saber quando foi a última vez.
  const disponivel = sql`(
    (i.locacao_venda LIKE '%V%' AND i.situacao_codigo_venda = 1) OR
    (i.locacao_venda LIKE '%L%' AND i.situacao_codigo_locacao = 1)
  )`;

  const desatualizadosRaw = await sql`
    WITH captador_principal AS (
      SELECT DISTINCT ON (imovel_id) imovel_id, corretor_id
      FROM imovel_captadores
      WHERE corretor_id != ALL(${idsExcluirDiretoria})
      ORDER BY imovel_id, percentual DESC NULLS LAST, data DESC NULLS LAST
    )
    SELECT i.id, i.codigo, i.titulo, i.bairro, i.cidade, i.locacao_venda, i.valor,
      i.data_atualizacao,
      EXTRACT(DAY FROM NOW() - i.data_atualizacao)::int AS dias_sem_atualizar,
      cp.corretor_id, u.departamento_id AS dep_captador,
      COALESCE(
        NULLIF(TRIM(u.nome_comercial),''), NULLIF(TRIM(u.nome),''),
        NULLIF(initcap(replace(split_part(COALESCE(u.email,''),'@',1),'.',' ')),'')
      ) AS captador,
      COUNT(*) OVER() AS total_geral
    FROM imoveis i
    LEFT JOIN captador_principal cp ON cp.imovel_id = i.id
    LEFT JOIN corretores u ON u.id = cp.corretor_id
    WHERE i.data_atualizacao IS NOT NULL
      AND i.data_atualizacao < NOW() - INTERVAL '90 days'
      AND ${disponivel}
      AND (${corretorIds}::int[] IS NULL OR cp.corretor_id = ANY(${corretorIds}::int[]))
    ORDER BY i.data_atualizacao ASC
    LIMIT 500`;

  const totalGeralDesatualizados = desatualizadosRaw.length ? Number(desatualizadosRaw[0].total_geral) : 0;

  // Contagem por unidade não pode vir só dos 500 da lista (subrepresenta) —
  // busca todos os departamento_id que batem no filtro, sem o LIMIT.
  const departamentosDesatualizados = await sql`
    WITH captador_principal AS (
      SELECT DISTINCT ON (imovel_id) imovel_id, corretor_id
      FROM imovel_captadores
      WHERE corretor_id != ALL(${idsExcluirDiretoria})
      ORDER BY imovel_id, percentual DESC NULLS LAST, data DESC NULLS LAST
    )
    SELECT u.departamento_id AS dep_captador
    FROM imoveis i
    LEFT JOIN captador_principal cp ON cp.imovel_id = i.id
    LEFT JOIN corretores u ON u.id = cp.corretor_id
    WHERE i.data_atualizacao IS NOT NULL
      AND i.data_atualizacao < NOW() - INTERVAL '90 days'
      AND ${disponivel}
      AND (${corretorIds}::int[] IS NULL OR cp.corretor_id = ANY(${corretorIds}::int[]))`;

  const desatualizados = desatualizadosRaw.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    titulo: r.titulo,
    bairro: r.bairro,
    cidade: r.cidade,
    locacao_venda: r.locacao_venda,
    valor: Number(r.valor),
    dias_sem_atualizar: Number(r.dias_sem_atualizar),
    captador: r.captador,
    unidade: unidadeDoDepartamento(r.dep_captador),
  }));

  const porUnidadeDesatualizados = new Map<string, number>();
  for (const d of departamentosDesatualizados) {
    const u = unidadeDoDepartamento(d.dep_captador);
    porUnidadeDesatualizados.set(u, (porUnidadeDesatualizados.get(u) || 0) + 1);
  }

  return NextResponse.json({
    mais_visitados: maisVisitados,
    por_tipo: porTipo,
    por_bairro: porBairro,
    estoque: estoque[0],
    visitas_por_dia: visitasPorDia,
    desatualizados: {
      total: totalGeralDesatualizados,
      por_unidade: [...porUnidadeDesatualizados.entries()].map(([unidade, total]) => ({ unidade, total })).sort((a, b) => b.total - a.total),
      lista: desatualizados,
    },
  });
}
