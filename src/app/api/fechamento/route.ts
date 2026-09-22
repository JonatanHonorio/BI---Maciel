import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { competenciaAtual, UNIDADES_FECHAMENTO, gerenteDaUnidade, escopoUnidade } from "@/lib/fechamento";
import { unidadesFechamento, tiposFechamento, podeAcessarPeriodo, podeReabrir, podeLancarComissao } from "@/lib/permissoes";
import type { Tipo } from "@/lib/unidade";

/** Valor do seletor que pede o mês inteiro, sem separar por unidade. */
const TODAS_AS_UNIDADES = "__todas";

/**
 * Período do mês pedido. Quem tem UMA opção só é resolvido aqui no servidor
 * (o gerente é preso na unidade+vertical dele; a gerente administrativa, na
 * unidade dela); quem tem mais de uma escolhe por query param, e a escolha é
 * validada contra o que ela pode. Admin escolhe qualquer uma.
 *
 * Dois pedidos caem numa LEITURA consolidada, sem período: `unidade=__todas`
 * e uma faixa `de`/`ate` de mais de um mês. Os dois pelo mesmo motivo — um
 * período é sempre de UM mês, UMA unidade e UMA vertical, então nada que
 * atravesse isso pode ser editado ou enviado. E por isso o consolidado
 * também não faz o upsert de período abaixo: faria período vazio em toda
 * unidade de todo mês da faixa, a cada visita à tela.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const unidadesOk = unidadesFechamento(session); // null = todas
  const tiposOk = tiposFechamento(session); // null = as duas

  const unidade = unidadesOk?.length === 1 ? unidadesOk[0] : req.nextUrl.searchParams.get("unidade");
  const tipo = (tiposOk?.length === 1 ? tiposOk[0] : req.nextUrl.searchParams.get("tipo")) as Tipo | null;
  // Faixa de competências. `competencia` continua aceito pra não quebrar link
  // antigo nem a rotina que chama esta rota com um mês só.
  const q = req.nextUrl.searchParams;
  const umMes = q.get("competencia");
  const de = q.get("de") || umMes || competenciaAtual();
  const ate = q.get("ate") || umMes || de;
  const competencia = de;

  for (const d of [de, ate]) {
    if (!/^\d{4}-\d{2}-01$/.test(d)) {
      return NextResponse.json({ error: "competência inválida" }, { status: 400 });
    }
  }
  if (ate < de) return NextResponse.json({ error: "competência final antes da inicial" }, { status: 400 });

  // "Todas as unidades" só faz sentido pra quem tem mais de uma — e nunca
  // amplia o que a pessoa já podia ver: `unidadesOk` continua sendo o escopo.
  const querTodasUnidades = unidade === TODAS_AS_UNIDADES && (unidadesOk === null || unidadesOk.length > 1);
  // Faixa de mais de um mês não tem período possível, então é sempre leitura —
  // mesmo com uma unidade escolhida.
  const faixaLonga = de !== ate;
  const querTodas = !!unidade && (querTodasUnidades || faixaLonga);

  const sessaoInfo = { role: session.role, unidade: session.unidade, tipo: session.tipo, nome: session.nome };
  const permissoes = {
    unidades: unidadesOk ?? [...UNIDADES_FECHAMENTO],
    escolheUnidade: unidadesOk === null || unidadesOk.length > 1,
    escolheTipo: tiposOk === null || tiposOk.length > 1,
    podeReabrir: podeReabrir(session),
    podeComissoes: podeLancarComissao(session),
  };

  if (querTodas && tipo) {
    const sqlTodas = getDb();
    // Uma unidade escolhida dentro da faixa continua valendo como filtro, e
    // passa pelo mesmo cruzamento com a permissão de sempre.
    const escopo = querTodasUnidades ? unidadesOk : escopoUnidade(unidadesOk, unidade);
    const todasPermitidas = escopo === null;
    const negociosTodos = await sqlTodas`
      SELECT n.id, n.data_contrato, n.ref, n.contrato, n.endereco, n.origem,
        n.valor, n.comissao, n.pagamento, n.observacao,
        n.comissao_paga, n.comissao_paga_em, p.unidade, p.status AS periodo_status,
        to_char(p.competencia, 'YYYY-MM') AS competencia,
        COALESCE(
          json_agg(
            json_build_object(
              'corretor_id', rc.corretor_id, 'nome', COALESCE(NULLIF(TRIM(cor.nome_comercial), ''), NULLIF(TRIM(cor.nome), ''), rc.nome_livre),
              'papel', rc.papel, 'percentual', rc.percentual
            )
          ) FILTER (WHERE rc.id IS NOT NULL), '[]'
        ) AS rateio
      FROM fechamento_negocios n
      JOIN fechamento_periodos p ON p.id = n.periodo_id
      LEFT JOIN fechamento_negocio_corretores rc ON rc.negocio_id = n.id
      LEFT JOIN corretores cor ON cor.id = rc.corretor_id
      WHERE p.competencia BETWEEN ${de} AND ${ate} AND p.tipo = ${tipo}
        AND (${todasPermitidas} OR p.unidade = ANY(${escopo ?? []}::text[]))
      GROUP BY n.id, p.competencia, p.unidade, p.status
      ORDER BY p.competencia, p.unidade, n.id
    `;
    // Quais unidades já fecharam o mês — é a primeira coisa que se pergunta
    // olhando o consolidado, e sem isso um total baixo parece erro quando na
    // verdade é unidade que ainda não lançou.
    const periodos = await sqlTodas`
      SELECT to_char(competencia, 'YYYY-MM') AS competencia, unidade, status
      FROM fechamento_periodos
      WHERE competencia BETWEEN ${de} AND ${ate} AND tipo = ${tipo}
        AND (${todasPermitidas} OR unidade = ANY(${escopo ?? []}::text[]))
      ORDER BY competencia, unidade
    `;
    return NextResponse.json({
      session: sessaoInfo, permissoes, unidades: permissoes.unidades,
      periodo: null, gerente: null,
      consolidado: { de, ate, tipo, unidade, periodos },
      negocios: negociosTodos,
    });
  }

  // Ainda falta escolher: devolve as opções, sem abrir período (não sabe qual).
  if (!unidade || !tipo) {
    if (permissoes.escolheUnidade || permissoes.escolheTipo) {
      return NextResponse.json({
        session: sessaoInfo, permissoes, unidades: permissoes.unidades, periodo: null, negocios: [],
      });
    }
    return NextResponse.json({ error: "unidade e tipo são obrigatórios" }, { status: 400 });
  }

  // Validar ANTES do upsert abaixo: ele cria período pra qualquer trio que
  // chegue aqui, então unidade inventada viraria lixo permanente na tabela e
  // unidade de outra pessoa viraria acesso indevido.
  if (!(UNIDADES_FECHAMENTO as readonly string[]).includes(unidade) || (tipo !== "venda" && tipo !== "locacao")) {
    return NextResponse.json({ error: "unidade ou tipo inválido" }, { status: 400 });
  }
  if (!podeAcessarPeriodo(session, { unidade, tipo })) {
    return NextResponse.json({ error: "sem acesso a esta unidade" }, { status: 403 });
  }

  const sql = getDb();

  const [periodo] = await sql`
    INSERT INTO fechamento_periodos (competencia, unidade, tipo)
    VALUES (${competencia}, ${unidade}, ${tipo})
    ON CONFLICT (competencia, unidade, tipo) DO UPDATE SET competencia = EXCLUDED.competencia
    RETURNING id, competencia, unidade, tipo, status, enviado_por, enviado_em
  `;

  const negocios = await sql`
    SELECT n.id, n.data_contrato, n.ref, n.contrato, n.endereco, n.origem,
      n.valor, n.comissao, n.pagamento, n.observacao,
      n.comissao_paga, n.comissao_paga_em,
      COALESCE(
        json_agg(
          json_build_object(
            'corretor_id', rc.corretor_id, 'nome', COALESCE(NULLIF(TRIM(cor.nome_comercial), ''), NULLIF(TRIM(cor.nome), ''), rc.nome_livre),
            'papel', rc.papel, 'percentual', rc.percentual
          )
        ) FILTER (WHERE rc.id IS NOT NULL), '[]'
      ) AS rateio
    FROM fechamento_negocios n
    LEFT JOIN fechamento_negocio_corretores rc ON rc.negocio_id = n.id
    LEFT JOIN corretores cor ON cor.id = rc.corretor_id
    WHERE n.periodo_id = ${periodo.id}
    GROUP BY n.id
    ORDER BY n.id
  `;

  // O gerente da unidade vai junto pro formulário preencher sozinho o bloco
  // Gerência (10% da comissão). Nulo em Diretoria e Lançamento.
  const gerente = await gerenteDaUnidade(sql, periodo.unidade, periodo.tipo);

  return NextResponse.json({ session: sessaoInfo, permissoes, unidades: permissoes.unidades, periodo, gerente, negocios });
}
