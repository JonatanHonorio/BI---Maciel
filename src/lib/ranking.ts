import type { SQL } from "./db";

/**
 * Ranking de vendedores (28/09/2026) — as quatro primeiras categorias pedidas
 * pelo Jonatan, com a diretoria ainda por definir o resto.
 *
 * FONTE: `fechamento_negocios`, não o Kurole. É o que a empresa efetivamente
 * pagou comissão em cima; o registro de venda no Kurole mede adesão ao
 * sistema, não produção (a página de Produtividade explica o mesmo caso).
 * Negócio CANCELADO fica de fora — é a razão de existir do flag.
 *
 * SOCIEDADE = meio para cada um. Regra dada pelo Jonatan: "quando parceria
 * entre corretor, considerar 0,5 pra cada". Vale para o VGV e para a
 * CONTAGEM: dois vendedores num negócio ficam com 0,5 imóvel e metade do
 * valor cada. Sem isso a soma do ranking passaria do que a empresa vendeu —
 * é o erro que já confundiu a diretoria na produtividade ("3.364
 * participações" para 3.074 imóveis).
 *
 * A divisão é por CABEÇA, não pelo percentual do rateio. Os percentuais
 * existem para pagar comissão e mudam com a regra da casa (o Girotto recebe
 * 20% de captação); usá-los faria o ranking premiar quem negociou melhor a
 * comissão, e não quem vendeu mais.
 *
 * A mesma pessoa lançada duas vezes no mesmo papel do mesmo negócio conta
 * UMA vez (acontece: o Kurole repete corretor, e o Fechamento herdou). Por
 * isso a dedupe vem antes da contagem de participantes — sem ela, um negócio
 * com o mesmo nome duplicado viraria "0,5 para cada" da mesma pessoa.
 */

export interface FiltroRanking {
  de: string; // competência inicial, YYYY-MM-01
  ate: string; // competência final, inclusive
  unidade: string | null;
  tipo: "venda" | "locacao";
}

export interface LinhaRanking {
  chave: string;
  nome: string;
  corretor_id: number | null;
  /** Soma das frações: 3,5 = três negócios sozinho e um dividido. */
  negocios: number;
  /** Negócios em que participou, sem dividir — serve de contexto. */
  participacoes: number;
  vgv: number;
}

export interface LinhaUnidade {
  unidade: string;
  gerente: string | null;
  negocios: number;
  vgv: number;
}

type Papel = "fechamento" | "levantamento";

/**
 * Ranking de pessoas num papel. `fechamento` = quem vendeu; `levantamento` =
 * quem captou o imóvel vendido.
 *
 * Captação aqui é a do NEGÓCIO FECHADO, não a carteira: quem captou muito e
 * não vendeu nada não aparece. Quem quiser captação bruta tem a página de
 * Produtividade, que conta pela data de cadastro do imóvel.
 */
export async function rankingPorPapel(
  sql: SQL, papel: Papel, f: FiltroRanking
): Promise<LinhaRanking[]> {
  const linhas = (await sql`
    WITH base AS (
      SELECT n.id, n.valor
      FROM fechamento_negocios n
      JOIN fechamento_periodos p ON p.id = n.periodo_id
      WHERE NOT n.cancelado
        AND p.tipo = ${f.tipo}
        AND p.competencia BETWEEN ${f.de}::date AND ${f.ate}::date
        AND (${f.unidade}::text IS NULL OR p.unidade = ${f.unidade})
    ),
    -- Uma linha por (negócio, pessoa): mata o corretor repetido.
    dedup AS (
      SELECT rc.negocio_id,
             COALESCE(rc.corretor_id::text, 'nome:' || lower(btrim(rc.nome_livre))) AS chave,
             max(rc.corretor_id) AS corretor_id,
             max(COALESCE(NULLIF(TRIM(k.nome_comercial), ''), NULLIF(TRIM(k.nome), ''),
                          btrim(rc.nome_livre))) AS nome
      FROM fechamento_negocio_corretores rc
      JOIN base b ON b.id = rc.negocio_id
      LEFT JOIN corretores k ON k.id = rc.corretor_id
      WHERE rc.papel = ${papel}
      GROUP BY rc.negocio_id, 2
    ),
    fatia AS (
      SELECT d.*, b.valor,
             count(*) OVER (PARTITION BY d.negocio_id) AS participantes
      FROM dedup d JOIN base b ON b.id = d.negocio_id
    )
    SELECT chave,
           max(nome) AS nome,
           max(corretor_id) AS corretor_id,
           sum(1.0 / participantes)::float AS negocios,
           count(*)::int AS participacoes,
           COALESCE(sum(COALESCE(valor, 0) / participantes), 0)::float AS vgv
    FROM fatia
    GROUP BY chave
    ORDER BY vgv DESC, negocios DESC
  `) as LinhaRanking[];
  return linhas;
}

/**
 * Volume por unidade, com o gerente que assina o mês.
 *
 * O agrupamento é pela UNIDADE do período, e não pela pessoa do bloco
 * Gerência: unidade que trocou de gerente no meio do ano continua sendo uma
 * linha só, que é como o Jonatan pediu ("volume por unidade"). O nome do
 * gerente vem de quem mais aparece no bloco Gerência daquela unidade, e vira
 * `null` quando não há nenhum — a Diretoria não tem gerente, e inventar um
 * faria parecer que alguém deixou de receber.
 */
export async function rankingUnidades(sql: SQL, f: FiltroRanking): Promise<LinhaUnidade[]> {
  const volume = (await sql`
    SELECT p.unidade,
           count(*)::int AS negocios,
           COALESCE(sum(n.valor), 0)::float AS vgv
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE NOT n.cancelado
      AND p.tipo = ${f.tipo}
      AND p.competencia BETWEEN ${f.de}::date AND ${f.ate}::date
      AND (${f.unidade}::text IS NULL OR p.unidade = ${f.unidade})
    GROUP BY p.unidade
    ORDER BY vgv DESC
  `) as { unidade: string; negocios: number; vgv: number }[];

  const gerentes = (await sql`
    SELECT DISTINCT ON (p.unidade) p.unidade,
           COALESCE(NULLIF(TRIM(k.nome_comercial), ''), NULLIF(TRIM(k.nome), ''),
                    btrim(rc.nome_livre)) AS gerente
    FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    LEFT JOIN corretores k ON k.id = rc.corretor_id
    WHERE rc.papel = 'gerencia'
      AND p.tipo = ${f.tipo}
      AND p.competencia BETWEEN ${f.de}::date AND ${f.ate}::date
      AND (${f.unidade}::text IS NULL OR p.unidade = ${f.unidade})
    GROUP BY p.unidade, 2
    ORDER BY p.unidade, count(*) DESC
  `) as { unidade: string; gerente: string | null }[];

  const porUnidade = new Map(gerentes.map((g) => [g.unidade, g.gerente]));
  return volume.map((v) => ({ ...v, gerente: porUnidade.get(v.unidade) ?? null }));
}
