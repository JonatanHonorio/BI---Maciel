import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  podeEditarContrato, podeVerBanco, podeVerContrato,
  motivoBloqueioMover, faseValida, FASES_QUE_AVISAM,
} from "@/lib/contratos";
import { limparContrato, validarBase, json, type CorpoContrato } from "@/lib/contratos-api";
import { avisarGerenteDoContrato } from "@/lib/contratos-aviso";

/** Next 16: `params` chega como Promise nas rotas dinâmicas. */
type Ctx = { params: Promise<{ id: string }> };

async function carregar(id: number) {
  const sql = getDb();
  const [c] = (await sql`SELECT * FROM contratos WHERE id = ${id}`) as Record<string, unknown>[];
  return c ?? null;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const contrato = await carregar(id);
  if (!contrato) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  if (!podeVerContrato(session, contrato as { unidade?: string; tipo?: string })) {
    return NextResponse.json({ error: "sem acesso a este contrato" }, { status: 403 });
  }

  const sql = getDb();
  const eventos = await sql`
    SELECT id, de, para, comentario, criado_em, criado_por_nome
    FROM contrato_eventos WHERE contrato_id = ${id} ORDER BY id
  `;

  /*
   * A posição na fila vem também aqui, e não só na listagem: o gerente abre o
   * card justamente para ver se está chegando a vez dele, e sem isto o painel
   * perdia a informação que o cartão mostrava.
   *
   * Contada sobre a fila INTEIRA, pelo mesmo motivo da listagem — ele só
   * enxerga a própria unidade.
   */
  const [naFila] = (await sql`
    SELECT posicao, total FROM (
      SELECT id,
        row_number() OVER (ORDER BY senha)::int AS posicao,
        count(*) OVER ()::int AS total
      FROM contratos WHERE fase = 1 AND arquivado = false
    ) f WHERE f.id = ${id}
  `) as { posicao: number; total: number }[];

  return NextResponse.json({
    contrato: {
      ...limparContrato(contrato, podeVerBanco(session)),
      fila_posicao: naFila?.posicao ?? null,
      fila_total: naFila?.total ?? null,
    },
    eventos,
  });
}

interface CorpoPatch extends CorpoContrato {
  comentario?: string;
  arquivado?: boolean;
}

/**
 * Três coisas passam por aqui, e a permissão de cada uma é diferente:
 *
 * - **comentário**: quem enxerga o card pode escrever. É como o gerente pede
 *   documento sem ter que sair do BI.
 * - **mover fase**: a Ana move livre; o gerente só aprova ou devolve, e só
 *   estando na conferência (ver `motivoBloqueioMover`).
 * - **editar os dados**: só a Ana e o admin.
 *
 * Checar as três juntas num `podeEditar` único era o caminho curto e errado:
 * daria ao gerente ou poder demais (editar conta bancária) ou de menos (não
 * conseguir devolver o contrato com o motivo).
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const atual = await carregar(id);
  if (!atual) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  if (!podeVerContrato(session, atual as { unidade?: string; tipo?: string })) {
    return NextResponse.json({ error: "sem acesso a este contrato" }, { status: 403 });
  }

  const body = (await req.json()) as CorpoPatch;
  const sql = getDb();
  const editor = podeEditarContrato(session);
  const faseAtual = Number(atual.fase);
  const comentario = body.comentario?.trim() || null;

  // 1) Movimento de fase
  let novaFase = faseAtual;
  if (body.fase !== undefined && Number(body.fase) !== faseAtual) {
    if (!faseValida(Number(body.fase))) {
      return NextResponse.json({ error: "fase inválida" }, { status: 400 });
    }
    const bloqueio = motivoBloqueioMover(session, faseAtual, Number(body.fase));
    if (bloqueio) return NextResponse.json({ error: bloqueio }, { status: 403 });
    novaFase = Number(body.fase);
  }

  // 2) Edição dos dados — só quem opera o quadro
  const querEditarDados =
    body.ref !== undefined || body.tipo !== undefined || body.unidade !== undefined ||
    body.vendedor !== undefined || body.comprador !== undefined || body.banco !== undefined ||
    body.pagamento !== undefined || body.observacao !== undefined ||
    body.garantia !== undefined || body.garantia_detalhe !== undefined ||
    body.corretor_id !== undefined || body.corretor_nome !== undefined ||
    body.imovel_endereco !== undefined || body.imovel_dados !== undefined ||
    body.imovel_id !== undefined || body.arquivado !== undefined;

  if (querEditarDados) {
    if (!editor) {
      return NextResponse.json({ error: "só o setor de contratos edita o card" }, { status: 403 });
    }
    const base: CorpoContrato = {
      ref: body.ref ?? (atual.ref as string),
      tipo: body.tipo ?? (atual.tipo as string),
      unidade: body.unidade ?? (atual.unidade as string),
      garantia: body.garantia,
    };
    const erro = validarBase(base);
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });

    await sql`
      UPDATE contratos SET
        ref = ${base.ref!.trim()},
        imovel_id = ${body.imovel_id !== undefined ? body.imovel_id : (atual.imovel_id as number | null)},
        tipo = ${base.tipo!},
        unidade = ${base.unidade!},
        corretor_id = ${body.corretor_id !== undefined ? body.corretor_id : (atual.corretor_id as number | null)},
        corretor_nome = ${body.corretor_nome ?? (atual.corretor_nome as string)},
        vendedor = ${body.vendedor !== undefined ? json(body.vendedor, "[]") : JSON.stringify(atual.vendedor ?? [])},
        comprador = ${body.comprador !== undefined ? json(body.comprador, "[]") : JSON.stringify(atual.comprador ?? [])},
        imovel_endereco = ${body.imovel_endereco !== undefined ? body.imovel_endereco : (atual.imovel_endereco as string | null)},
        imovel_dados = ${body.imovel_dados !== undefined ? json(body.imovel_dados, "{}") : JSON.stringify(atual.imovel_dados ?? {})},
        banco = ${body.banco !== undefined ? json(body.banco, "{}") : JSON.stringify(atual.banco ?? {})},
        pagamento = ${body.pagamento !== undefined ? body.pagamento : (atual.pagamento as string | null)},
        observacao = ${body.observacao !== undefined ? body.observacao : (atual.observacao as string | null)},
        garantia = ${body.garantia !== undefined ? (body.garantia || null) : (atual.garantia as string | null)},
        garantia_detalhe = ${body.garantia_detalhe !== undefined ? body.garantia_detalhe : (atual.garantia_detalhe as string | null)},
        arquivado = ${body.arquivado !== undefined ? body.arquivado : (atual.arquivado as boolean)},
        atualizado_em = NOW(), atualizado_por = ${session.id}
      WHERE id = ${id}
    `;
  }

  // 3) Fase + histórico. A fase é escrita à parte de propósito: o gerente
  // aprova sem ter direito a nenhum dos campos acima.
  if (novaFase !== faseAtual) {
    await sql`
      UPDATE contratos SET fase = ${novaFase}, atualizado_em = NOW(), atualizado_por = ${session.id}
      WHERE id = ${id}
    `;
  }

  if (novaFase !== faseAtual || comentario) {
    await sql`
      INSERT INTO contrato_eventos (contrato_id, de, para, comentario, criado_por, criado_por_nome)
      VALUES (
        ${id}, ${novaFase !== faseAtual ? faseAtual : null},
        ${novaFase !== faseAtual ? novaFase : null}, ${comentario}, ${session.id}, ${session.nome}
      )
    `;
  }

  const depois = await carregar(id);

  // O e-mail é o último passo e não derruba a resposta: card já movido com
  // aviso não enviado é problema menor que a Ana achar que o clique falhou e
  // mover de novo.
  if (novaFase !== faseAtual && FASES_QUE_AVISAM.includes(novaFase)) {
    try {
      await avisarGerenteDoContrato(depois as never, novaFase, session.nome, comentario);
    } catch (e) {
      console.error("aviso de contrato não enviado:", (e as Error).message);
    }
  }

  return NextResponse.json({ contrato: limparContrato(depois!, podeVerBanco(session)) });
}
