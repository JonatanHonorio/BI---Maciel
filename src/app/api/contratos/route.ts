import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeEditarContrato, podeVerBanco, unidadesContrato, tiposContrato } from "@/lib/contratos";
import { limparContrato, validarBase, json, type CorpoContrato } from "@/lib/contratos-api";
import { UNIDADES_FECHAMENTO } from "@/lib/fechamento";

/**
 * Quadro do setor de contratos.
 *
 * O escopo é aplicado no SQL (e não peneirando depois) pra que dado de unidade
 * que a pessoa não pode ver nem saia do banco.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getDb();
  const unidades = unidadesContrato(session);
  const tipos = tiposContrato(session);
  const q = req.nextUrl.searchParams;
  const arquivados = q.get("arquivados") === "1";

  /*
   * Filtros da tela (pedido da Ana em 25/09/2026): período, fase, unidade,
   * corretor e vertical.
   *
   * Ficam no SQL e NÃO substituem o escopo — são um `AND` depois dele. Filtrar
   * na tela seria mais simples, mas com o quadro crescendo mandaria a base
   * inteira de contratos para o navegador de todo gerente.
   *
   * Cada filtro só entra quando vem preenchido: `${x}::tipo IS NULL OR ...` é
   * o jeito de ter um WHERE opcional sem montar string de SQL na mão.
   */
  const soData = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const desde = soData(q.get("desde"));
  const ate = soData(q.get("ate"));
  const fase = Number(q.get("fase")) || null;
  const unidadeFiltro = q.get("unidade") || null;
  const tipoFiltro = q.get("tipo") === "venda" || q.get("tipo") === "locacao" ? q.get("tipo") : null;
  const corretor = q.get("corretor")?.trim() || null;

  const linhas = (await sql`
    SELECT c.*, u.nome AS criado_por_nome
    FROM contratos c
    LEFT JOIN usuarios_bi u ON u.id = c.criado_por
    WHERE c.arquivado = ${arquivados}
      AND (${unidades}::text[] IS NULL OR c.unidade = ANY(${unidades}::text[]))
      AND (${tipos}::text[] IS NULL OR c.tipo = ANY(${tipos}::text[]))
      AND (${desde}::date IS NULL OR c.criado_em >= ${desde}::date)
      AND (${ate}::date IS NULL OR c.criado_em < ${ate}::date + 1)
      AND (${fase}::int IS NULL OR c.fase = ${fase}::int)
      AND (${unidadeFiltro}::text IS NULL OR c.unidade = ${unidadeFiltro}::text)
      AND (${tipoFiltro}::text IS NULL OR c.tipo = ${tipoFiltro}::text)
      AND (${corretor}::text IS NULL OR c.corretor_nome ILIKE '%' || ${corretor}::text || '%')
    ORDER BY c.fase,
      -- No recebimento a ordem é a da fila (senha crescente); nas outras fases,
      -- o que mexeu por último vem primeiro.
      CASE WHEN c.fase = 1 THEN c.senha END ASC,
      c.atualizado_em DESC
  `) as Record<string, unknown>[];

  /*
   * Posição na fila do recebimento — calculada sobre TODOS os contratos em
   * espera, de propósito ignorando o escopo de quem perguntou.
   *
   * É o ponto do pedido: a gerente quer saber se está chegando a vez dela, e
   * ela só enxerga a própria unidade. Numerar dentro do que ela vê diria "você
   * é a 2ª" quando há oito contratos de outras unidades na frente — uma
   * resposta pior que nenhuma.
   */
  const fila = (await sql`
    SELECT id,
      row_number() OVER (ORDER BY senha)::int AS posicao,
      count(*) OVER ()::int AS total
    FROM contratos WHERE fase = 1 AND arquivado = false
  `) as { id: number; posicao: number; total: number }[];
  const posicaoPorId = new Map(fila.map((f) => [Number(f.id), f]));

  /*
   * Opções do seletor de corretor: saem de TODOS os contratos no escopo da
   * pessoa, não dos filtrados. Tiradas da lista filtrada, escolher um corretor
   * esvaziaria o próprio seletor e não haveria como trocar de escolha.
   */
  const corretores = (await sql`
    SELECT DISTINCT corretor_nome FROM contratos
    WHERE corretor_nome <> '' AND arquivado = ${arquivados}
      AND (${unidades}::text[] IS NULL OR unidade = ANY(${unidades}::text[]))
      AND (${tipos}::text[] IS NULL OR tipo = ANY(${tipos}::text[]))
    ORDER BY corretor_nome
  `) as { corretor_nome: string }[];

  const verBanco = podeVerBanco(session);
  return NextResponse.json({
    contratos: linhas.map((c) => {
      const naFila = posicaoPorId.get(Number(c.id));
      return {
        ...limparContrato(c, verBanco),
        fila_posicao: naFila?.posicao ?? null,
        fila_total: naFila?.total ?? null,
      };
    }),
    // `unidades` é o escopo de quem pediu; `todasUnidades` é a lista oficial
    // para o seletor do formulário — o componente é client e não pode importar
    // @/lib/fechamento, que usa fs.
    permissoes: { editar: podeEditarContrato(session), verBanco, unidades, tipos },
    todasUnidades: UNIDADES_FECHAMENTO,
    corretoresNoQuadro: corretores.map((c) => c.corretor_nome),
  });
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!podeEditarContrato(session)) {
    return NextResponse.json({ error: "só o setor de contratos cria card" }, { status: 403 });
  }

  const body = (await req.json()) as CorpoContrato;
  const erro = validarBase(body);
  if (erro) return NextResponse.json({ error: erro }, { status: 400 });

  const sql = getDb();
  const [novo] = (await sql`
    INSERT INTO contratos (
      ref, imovel_id, tipo, unidade, corretor_id, corretor_nome, fase,
      vendedor, comprador, imovel_endereco, imovel_dados, banco,
      pagamento, observacao, garantia, garantia_detalhe, criado_por, atualizado_por
    ) VALUES (
      ${body.ref!.trim()}, ${body.imovel_id ?? null}, ${body.tipo!}, ${body.unidade!},
      ${body.corretor_id ?? null}, ${body.corretor_nome ?? ""}, ${body.fase ?? 1},
      ${json(body.vendedor, "[]")}, ${json(body.comprador, "[]")},
      ${body.imovel_endereco ?? null}, ${json(body.imovel_dados, "{}")},
      ${json(body.banco, "{}")}, ${body.pagamento ?? null}, ${body.observacao ?? null},
      ${body.garantia || null}, ${body.garantia_detalhe ?? null},
      ${session.id}, ${session.id}
    ) RETURNING *
  `) as Record<string, unknown>[];

  await sql`
    INSERT INTO contrato_eventos (contrato_id, de, para, comentario, criado_por, criado_por_nome)
    VALUES (${novo.id as number}, NULL, ${novo.fase as number}, 'Card criado', ${session.id}, ${session.nome})
  `;

  return NextResponse.json({ contrato: limparContrato(novo, podeVerBanco(session)) });
}
