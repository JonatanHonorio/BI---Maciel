import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDateRange } from "@/lib/date-utils";
import { getSession } from "@/lib/auth";
import { corretoresDaUnidade, unidadeDoDepartamento } from "@/lib/unidade";

/**
 * Produtividade por corretor: leads recebidos, captações, atualizações de
 * imóvel e remanejamentos de carteira.
 *
 * --- DEFINIÇÕES (decididas com o Jonatan em 14/09/2026) ---
 *
 * LEADS = por ATRIBUIÇÃO (`lead_responsaveis.data`), não por abertura da ordem.
 *   Um lead aberto em agosto e transferido em setembro conta para quem recebeu,
 *   em setembro — é o que ele teve para trabalhar.
 *
 * CAPTAÇÕES = por CABEÇA e pela IDADE DO IMÓVEL. Imóvel captado em dupla conta
 *   1 inteiro para cada um, e só entra se o imóvel também foi CADASTRADO no
 *   período. Sem a segunda regra, remanejamento de carteira vira "captação":
 *   em 01/09/2026 um corretor recebeu 56 imóveis num dia, cadastrados entre
 *   2022 e 2026, e liderava o ranking sem ter captado nada.
 *
 * VENDAS ficam FORA de propósito: os corretores ainda não têm cultura de
 *   registrar venda no Kurole, então o número mede adesão ao sistema, não
 *   produção — e um painel que mostra zero faz o gerente concluir o que não é.
 */

/*
 * Nome do corretor com os mesmos fallbacks do resto do BI: há cadastro com nome
 * vazio (jerson.lima, id 157, que é corretor de verdade da Locação Dutra), e
 * descartá-lo faria a ordem parecer sem responsável.
 */
type LinhaBanco = {
  id: number; nome: string; dep: number | null; n: string | number;
  proprios?: string | number;
};

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getDb();
  const { since, until } = parseDateRange(req.nextUrl.searchParams);
  // `until` é inclusivo na UI; no SQL usamos o dia seguinte como limite aberto.
  const ate = `${until} 23:59:59`;
  const corretorIds = await corretoresDaUnidade(sql, session.unidade, session.tipo);

  const [leads, captacoes, atualizacoes, movimentos, cobertura, imoveisNovos, imoveisAtualizados] = await Promise.all([
    sql`
      SELECT r.corretor_id AS id, COALESCE(
               NULLIF(TRIM(u.nome_comercial),''), NULLIF(TRIM(u.nome),''),
               NULLIF(initcap(replace(split_part(COALESCE(u.email,''),'@',1),'.',' ')),''),
               'corretor ' || u.id) AS nome,
             u.departamento_id AS dep, count(DISTINCT r.lead_id) AS n
      FROM lead_responsaveis r JOIN corretores u ON u.id = r.corretor_id
      WHERE r.data >= ${since} AND r.data <= ${ate} AND r.corretor_id > 0
        AND (${corretorIds}::int[] IS NULL OR r.corretor_id = ANY(${corretorIds}::int[]))
      GROUP BY r.corretor_id, u.nome_comercial, u.nome, u.email, u.id, u.departamento_id
      ORDER BY n DESC` as unknown as Promise<LinhaBanco[]>,

    sql`
      SELECT c.corretor_id AS id, COALESCE(
               NULLIF(TRIM(u.nome_comercial),''), NULLIF(TRIM(u.nome),''),
               NULLIF(initcap(replace(split_part(COALESCE(u.email,''),'@',1),'.',' ')),''),
               'corretor ' || u.id) AS nome,
             u.departamento_id AS dep, count(DISTINCT c.imovel_id) AS n
      FROM imovel_captadores c
      JOIN corretores u ON u.id = c.corretor_id
      JOIN imoveis i ON i.id = c.imovel_id
      WHERE c.data >= ${since} AND c.data <= ${ate} AND c.corretor_id > 0
        AND i.data_cadastro >= ${since} AND i.data_cadastro <= ${ate}
        AND (${corretorIds}::int[] IS NULL OR c.corretor_id = ANY(${corretorIds}::int[]))
      GROUP BY c.corretor_id, u.nome_comercial, u.nome, u.email, u.id, u.departamento_id
      ORDER BY n DESC` as unknown as Promise<LinhaBanco[]>,

    // `proprios` separa "cuidar da própria carteira" de "atualizar imóvel dos
    // outros para ganhar a captação" — são comportamentos diferentes.
    sql`
      SELECT a.corretor_id AS id, COALESCE(
               NULLIF(TRIM(u.nome_comercial),''), NULLIF(TRIM(u.nome),''),
               NULLIF(initcap(replace(split_part(COALESCE(u.email,''),'@',1),'.',' ')),''),
               'corretor ' || u.id) AS nome,
             u.departamento_id AS dep, count(DISTINCT a.imovel_id) AS n,
             count(DISTINCT a.imovel_id) FILTER (WHERE cap.corretor_id IS NOT NULL) AS proprios
      FROM imovel_atualizacoes a
      JOIN corretores u ON u.id = a.corretor_id
      LEFT JOIN imovel_captadores cap ON cap.imovel_id = a.imovel_id AND cap.corretor_id = a.corretor_id
      WHERE a.data >= ${since} AND a.data <= ${ate} AND a.corretor_id > 0
        AND (${corretorIds}::int[] IS NULL OR a.corretor_id = ANY(${corretorIds}::int[]))
      GROUP BY a.corretor_id, u.nome_comercial, u.nome, u.email, u.id, u.departamento_id
      ORDER BY n DESC` as unknown as Promise<LinhaBanco[]>,

    /*
     * Captador novo em imóvel ANTIGO. Dois fatos diferentes geram o mesmo
     * registro e só QUEM atualizou os separa:
     *   campanha  → quem atualizou é o próprio que ficou com a captação
     *   remanejo  → atualizou outra pessoa, ou ninguém
     * Checar apenas "houve atualização perto da data" não serve: os 56 imóveis
     * do caso de 01/09 tinham atualização, feita por alguém do Administrativo.
     */
    sql`
      SELECT COALESCE(
               NULLIF(TRIM(u.nome_comercial),''), NULLIF(TRIM(u.nome),''),
               NULLIF(initcap(replace(split_part(COALESCE(u.email,''),'@',1),'.',' ')),''),
               'corretor ' || u.id) AS nome, u.departamento_id AS dep,
             c.data::date AS dia, count(DISTINCT c.imovel_id) AS n,
             count(DISTINCT c.imovel_id) FILTER (WHERE a.imovel_id IS NOT NULL) AS proprios
      FROM imovel_captadores c
      JOIN corretores u ON u.id = c.corretor_id
      JOIN imoveis i ON i.id = c.imovel_id
      LEFT JOIN imovel_atualizacoes a
        ON a.imovel_id = c.imovel_id AND a.corretor_id = c.corretor_id
       AND a.data >= c.data - interval '7 days' AND a.data <= c.data + interval '7 days'
      WHERE c.data >= ${since} AND c.data <= ${ate} AND c.corretor_id > 0
        AND i.data_cadastro < ${since}
        AND (${corretorIds}::int[] IS NULL OR c.corretor_id = ANY(${corretorIds}::int[]))
      GROUP BY u.nome_comercial, u.nome, u.email, u.id, u.departamento_id, c.data::date
      ORDER BY n DESC` as unknown as Promise<(LinhaBanco & { dia: string })[]>,

    sql`SELECT max(data_inicio) AS ate FROM leads` as unknown as Promise<{ ate: string }[]>,

    sql`
      SELECT count(DISTINCT c.imovel_id) AS n
      FROM imovel_captadores c JOIN imoveis i ON i.id = c.imovel_id
      WHERE c.data >= ${since} AND c.data <= ${ate} AND c.corretor_id > 0
        AND i.data_cadastro >= ${since} AND i.data_cadastro <= ${ate}
        AND (${corretorIds}::int[] IS NULL OR c.corretor_id = ANY(${corretorIds}::int[]))` as unknown as Promise<{ n: string }[]>,

    // Imóveis distintos atualizados — mesma ressalva da captação: a soma por
    // corretor conta de novo quando mais de um corretor mexeu no mesmo
    // imóvel no período, e isso já confundiu a diretoria (perguntaram se
    // 3.364 batia com a realidade — eram 3.074 imóveis, 3.364 "participações").
    sql`
      SELECT count(DISTINCT a.imovel_id) AS n
      FROM imovel_atualizacoes a
      WHERE a.data >= ${since} AND a.data <= ${ate} AND a.corretor_id > 0
        AND (${corretorIds}::int[] IS NULL OR a.corretor_id = ANY(${corretorIds}::int[]))` as unknown as Promise<{ n: string }[]>,
  ]);

  const enfeitar = (linhas: LinhaBanco[]) =>
    linhas.map((x) => ({
      id: x.id, nome: x.nome, unidade: unidadeDoDepartamento(x.dep),
      total: Number(x.n),
      proprios: x.proprios === undefined ? undefined : Number(x.proprios),
      outros: x.proprios === undefined ? undefined : Number(x.n) - Number(x.proprios),
    }));

  /** `::date` volta como Date no driver; toISOString() tiraria um dia em UTC-3. */
  const paraISO = (v: unknown): string => {
    if (v instanceof Date) {
      const p = (n: number) => String(n).padStart(2, "0");
      return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    return String(v).slice(0, 10);
  };

  const mov = movimentos.map((x) => ({
    nome: x.nome, unidade: unidadeDoDepartamento(x.dep),
    dia: paraISO(x.dia),
    total: Number(x.n), proprios: Number(x.proprios ?? 0),
  }));

  const soma = (l: { total: number }[]) => l.reduce((s, x) => s + x.total, 0);
  const listaLeads = enfeitar(leads);
  const listaCapt = enfeitar(captacoes);
  const listaAtu = enfeitar(atualizacoes);
  const campanha = mov.filter((x) => x.proprios === x.total);
  const remanejamentos = mov.filter((x) => x.proprios < x.total);

  return NextResponse.json({
    periodo: { since, until },
    dados_ate: cobertura[0]?.ate ?? null,
    resumo: {
      leads: soma(listaLeads),
      // Imóveis distintos. A soma da coluna por corretor é maior porque imóvel
      // em dupla conta 1 para cada um — bom no ranking, errado como total.
      captacoes: Number(imoveisNovos[0]?.n ?? 0),
      captacoes_cabecas: soma(listaCapt),
      // Imóveis distintos. A soma da coluna por corretor (atualizacoes_cabecas)
      // é maior porque conta de novo quando mais de um corretor mexeu no
      // mesmo imóvel — bom no ranking, errado como número de destaque.
      atualizacoes: Number(imoveisAtualizados[0]?.n ?? 0),
      atualizacoes_cabecas: soma(listaAtu),
      campanha: soma(campanha),
      remanejados: soma(remanejamentos),
      corretores_com_lead: listaLeads.length,
    },
    leads: listaLeads,
    captacoes: listaCapt,
    atualizacoes: listaAtu,
    campanha,
    remanejamentos,
  });
}
