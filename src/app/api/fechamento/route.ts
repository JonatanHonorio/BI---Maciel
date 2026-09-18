import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { competenciaAtual, UNIDADES_FECHAMENTO } from "@/lib/fechamento";
import { unidadesFechamento, tiposFechamento, podeAcessarPeriodo, podeReabrir, podeLancarComissao } from "@/lib/permissoes";
import type { Tipo } from "@/lib/unidade";

/**
 * Período do mês pedido. Quem tem UMA opção só é resolvido aqui no servidor
 * (o gerente é preso na unidade+vertical dele; a gerente administrativa, na
 * unidade dela); quem tem mais de uma escolhe por query param, e a escolha é
 * validada contra o que ela pode. Admin escolhe qualquer uma.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const unidadesOk = unidadesFechamento(session); // null = todas
  const tiposOk = tiposFechamento(session); // null = as duas

  const unidade = unidadesOk?.length === 1 ? unidadesOk[0] : req.nextUrl.searchParams.get("unidade");
  const tipo = (tiposOk?.length === 1 ? tiposOk[0] : req.nextUrl.searchParams.get("tipo")) as Tipo | null;
  const competencia = req.nextUrl.searchParams.get("competencia") || competenciaAtual();

  if (!/^\d{4}-\d{2}-01$/.test(competencia)) {
    return NextResponse.json({ error: "competência inválida" }, { status: 400 });
  }

  const sessaoInfo = { role: session.role, unidade: session.unidade, tipo: session.tipo, nome: session.nome };
  const permissoes = {
    unidades: unidadesOk ?? [...UNIDADES_FECHAMENTO],
    escolheUnidade: unidadesOk === null || unidadesOk.length > 1,
    escolheTipo: tiposOk === null || tiposOk.length > 1,
    podeReabrir: podeReabrir(session),
    podeComissoes: podeLancarComissao(session),
  };

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
            'corretor_id', rc.corretor_id, 'nome', cor.nome_comercial,
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

  return NextResponse.json({ session: sessaoInfo, permissoes, unidades: permissoes.unidades, periodo, negocios });
}
