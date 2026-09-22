import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  moedaDoObjetivo, rotuloCampanha, produtoDoAnuncio, faixaDoProduto,
  produtoConhecido, situacaoDoCusto, tendencia, type Moeda,
} from "@/lib/trafego";

/**
 * O quadro de campanhas ativas — o formato que o Jonatan usa pra decidir onde
 * mexer: quanto cada campanha gasta por dia, o que produziu no período, o
 * custo por resultado e se os últimos 7 dias estão melhores ou piores.
 *
 * As regras de contagem estão em `@/lib/trafego` e vieram do handoff de
 * tráfego pago. Duas que decidem o número inteiro:
 *
 *   - resultado é LEAD ou CONVERSA conforme o objetivo da campanha, e os dois
 *     nunca se somam numa linha (só no total do mês, como "oportunidades");
 *   - `leads` já vem sem a duplicata de `lead_grouped`, resolvida no sync.
 */
export async function GET(req: NextRequest) {
  const sql = getDb();
  const p = req.nextUrl.searchParams;

  const hoje = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const primeiroDoMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
  const de = p.get("de") || primeiroDoMes;
  const ate = p.get("ate") || fmt(hoje);

  // Janela recente: 7 dias terminando no fim do período, nunca ultrapassando o
  // início. Comparar dia a dia não serve — com 2 a 6 resultados por dia o custo
  // diário oscila a ponto de inventar tendência que não existe.
  const inicio7 = new Date(`${ate}T12:00:00`);
  inicio7.setDate(inicio7.getDate() - 6);
  const de7 = fmt(inicio7) < de ? de : fmt(inicio7);

  const linhas = (await sql`
    WITH periodo AS (
      SELECT campanha_id,
        SUM(gasto) AS gasto, SUM(leads) AS leads, SUM(conversas_iniciadas) AS conversas,
        SUM(impressoes) AS impressoes, MAX(frequencia) AS frequencia
      FROM meta_insights_diarios WHERE data BETWEEN ${de} AND ${ate} GROUP BY campanha_id
    ),
    recente AS (
      SELECT campanha_id,
        SUM(gasto) AS gasto, SUM(leads) AS leads, SUM(conversas_iniciadas) AS conversas
      FROM meta_insights_diarios WHERE data BETWEEN ${de7} AND ${ate} GROUP BY campanha_id
    ),
    -- Campanha CBO tem a verba na CAMPANHA e os conjuntos vêm com R$0. Somar
    -- só o nível de conjunto errava R$80/dia; ler só a campanha zera as que
    -- distribuem por conjunto. Por isso os dois, com a campanha na frente.
    orcamento AS (
      SELECT campanha_id, SUM(budget_diario) AS dos_conjuntos
      FROM meta_conjuntos WHERE status = 'ACTIVE' GROUP BY campanha_id
    )
    SELECT mc.id, mc.nome, mc.objetivo, mc.status,
      COALESCE(NULLIF(mc.budget_diario, 0), o.dos_conjuntos, 0) AS orcamento_dia,
      COALESCE(pe.gasto, 0) AS gasto, COALESCE(pe.leads, 0) AS leads,
      COALESCE(pe.conversas, 0) AS conversas, COALESCE(pe.impressoes, 0) AS impressoes,
      pe.frequencia,
      COALESCE(re.gasto, 0) AS gasto_7d, COALESCE(re.leads, 0) AS leads_7d,
      COALESCE(re.conversas, 0) AS conversas_7d
    FROM meta_campanhas mc
    LEFT JOIN periodo pe ON pe.campanha_id = mc.id
    LEFT JOIN recente re ON re.campanha_id = mc.id
    LEFT JOIN orcamento o ON o.campanha_id = mc.id
    WHERE mc.status = 'ACTIVE' OR COALESCE(pe.gasto, 0) > 0
    ORDER BY mc.nome
  `) as Record<string, string | number | null>[];

  /**
   * Produtos de cada campanha, pelo nome do ANÚNCIO.
   *
   * `[IMÓVEIS TERCEIROS]` roda Casa do Cristian e Jardim Limoeiro juntos: sem
   * olhar o anúncio, a campanha parece um produto só e o custo de cada um fica
   * invisível.
   */
  const anuncios = (await sql`
    SELECT a.campanha_id, mc.nome AS campanha, a.nome AS anuncio, SUM(ai.gasto) AS gasto
    FROM meta_anuncio_insights ai
    JOIN meta_anuncios a ON a.id = ai.anuncio_id
    JOIN meta_campanhas mc ON mc.id = a.campanha_id
    WHERE ai.data BETWEEN ${de} AND ${ate}
    GROUP BY a.campanha_id, mc.nome, a.nome
    HAVING SUM(ai.gasto) > 0
  `) as { campanha_id: string; campanha: string; anuncio: string }[];

  const produtosPorCampanha = new Map<string, Set<string>>();
  for (const a of anuncios) {
    const set = produtosPorCampanha.get(a.campanha_id) ?? new Set<string>();
    set.add(produtoDoAnuncio(a.campanha, a.anuncio));
    produtosPorCampanha.set(a.campanha_id, set);
  }

  const campanhas = linhas.map((l) => {
    const moeda: Moeda = moedaDoObjetivo(String(l.objetivo ?? ""));
    const gasto = Number(l.gasto);
    const resultados = Number(moeda === "leads" ? l.leads : l.conversas);
    const gasto7d = Number(l.gasto_7d);
    const resultados7d = Number(moeda === "leads" ? l.leads_7d : l.conversas_7d);
    const custo = resultados > 0 ? gasto / resultados : 0;
    const custo7d = resultados7d > 0 ? gasto7d / resultados7d : 0;
    const faixa = faixaDoProduto(String(l.nome ?? ""));
    // Mais de um produto na mesma campanha é informação, não ruído: é o caso
    // do Cristian + Limoeiro. Um produto só não precisa ser repetido.
    const produtos = [...(produtosPorCampanha.get(String(l.id)) ?? [])].sort();

    return {
      id: String(l.id),
      nome: String(l.nome ?? ""),
      rotulo: rotuloCampanha(String(l.nome ?? "")),
      ativa: l.status === "ACTIVE",
      moeda,
      produtos: produtos.length > 1 ? produtos : [],
      // Campanha pausada não gasta por dia. O conjunto dela pode continuar
      // marcado como ativo no cadastro, e aí o número apareceria como se a
      // verba ainda estivesse rodando.
      orcamento_dia: l.status === "ACTIVE" ? Number(l.orcamento_dia) : 0,
      gasto, resultados, custo,
      gasto_7d: gasto7d, resultados_7d: resultados7d, custo_7d: custo7d,
      tendencia: tendencia(custo, custo7d),
      frequencia: l.frequencia != null ? Number(l.frequencia) : null,
      faixa,
      situacao: situacaoDoCusto(custo, faixa),
      // Campanha que NINGUÉM mapeou precisa APARECER, não sumir — o Altus já
      // caiu em "outros" e quase foi publicado assim. Produto conhecido que
      // simplesmente não tem faixa comparável (a Área) não é alerta.
      sem_regua: !produtoConhecido(String(l.nome ?? "")),
    };
  })
    // Sem resultado e sem gasto não diz nada — e campanha recém-ligada não
    // pode empurrar as que estão gastando pra baixo da tela.
    .filter((c) => c.gasto > 0 || c.ativa)
    .sort((a, b) => {
      if (a.custo === 0) return 1;
      if (b.custo === 0) return -1;
      return a.custo - b.custo;
    });

  const ativas = campanhas.filter((c) => c.ativa);
  const leads = campanhas.reduce((s, c) => s + (c.moeda === "leads" ? c.resultados : 0), 0);
  const conversas = campanhas.reduce((s, c) => s + (c.moeda === "conversas" ? c.resultados : 0), 0);
  const gasto = campanhas.reduce((s, c) => s + c.gasto, 0);

  // Quando foi a última vez que o sync rodou. Sem isto, tela parada parece
  // resultado ruim — foi assim que o tráfego ficou dois meses sem ninguém ver.
  const [ultimo] = (await sql`
    SELECT MAX(updated_at) AS em, (SELECT MAX(data) FROM meta_insights_diarios) AS ultimo_dia
    FROM meta_campanhas
  `) as { em: string | null; ultimo_dia: string | null }[];

  return NextResponse.json({
    de, ate, de7,
    atualizado_em: ultimo?.em ?? null,
    ultimo_dia: ultimo?.ultimo_dia ?? null,
    campanhas,
    totais: {
      // Leads e conversas só se somam AQUI, e o nome da soma é "oportunidades" —
      // é a unidade que o Jonatan usa pro mês.
      gasto, leads, conversas,
      oportunidades: leads + conversas,
      custo_oportunidade: leads + conversas > 0 ? gasto / (leads + conversas) : 0,
      orcamento_dia: ativas.reduce((s, c) => s + c.orcamento_dia, 0),
      campanhas_ativas: ativas.length,
      // "Ativas" não é "o mês inteiro": campanha pausada no meio do mês
      // produziu oportunidade que conta.
      pausadas_com_gasto: campanhas.filter((c) => !c.ativa && c.gasto > 0).length,
    },
  });
}
