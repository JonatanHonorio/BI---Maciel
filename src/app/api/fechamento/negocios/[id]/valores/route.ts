import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeAcessarPeriodo, podeLancarComissao } from "@/lib/permissoes";

/**
 * Corrige o VALOR e a COMISSÃO de um negócio já lançado, sem tocar no rateio.
 *
 * Existe por um caso real (26/09/2026): a comissão recebida veio maior que a
 * cadastrada, e a Tatiane não conseguia lançar o recebimento — a rota de
 * recebimento recusa parcela que passe da comissão do negócio, trava que está
 * lá para pegar dígito a mais na digitação.
 *
 * Por que NÃO usar o PUT do negócio: ele apaga e recria as linhas do rateio, e
 * `fechamento_pagamentos` tem FK em CASCADE para elas — corrigir a comissão por
 * lá apagaria em silêncio todas as baixas já lançadas. Aqui só dois campos
 * mudam, e as baixas ficam de pé.
 *
 * Como o rateio é percentual, subir a comissão sobe sozinho o quanto cada um
 * tem a receber: quem já recebeu continua com o que recebeu, e a diferença
 * vira saldo a pagar.
 *
 * Funciona com o período já enviado de propósito: correção de comissão chega
 * depois do fechamento, como o distrato.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  if (!podeLancarComissao(session)) {
    return NextResponse.json({ error: "sem permissão para corrigir valores" }, { status: 403 });
  }

  const sql = getDb();
  const [linha] = (await sql`
    SELECT n.id, n.valor, n.comissao, p.unidade, p.tipo
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE n.id = ${id}
  `) as { id: number; valor: string | null; comissao: string | null; unidade: string; tipo: string }[];
  if (!linha) return NextResponse.json({ error: "negócio não encontrado" }, { status: 404 });
  if (!podeAcessarPeriodo(session, linha)) {
    return NextResponse.json({ error: "sem acesso a este período" }, { status: 403 });
  }

  const body = (await req.json()) as { valor?: number | string | null; comissao?: number | string | null };
  const numero = (v: unknown, atual: string | null) => {
    if (v === undefined) return atual === null ? null : Number(atual);
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const valor = numero(body.valor, linha.valor);
  const comissao = numero(body.comissao, linha.comissao);
  if (Number.isNaN(valor) || Number.isNaN(comissao)) {
    return NextResponse.json({ error: "valor e comissão precisam ser números não negativos" }, { status: 400 });
  }

  /*
   * Não dá para baixar a comissão para menos do que já foi pago aos
   * destinatários: o rateio ficaria com gente "devendo" à imobiliária, e a
   * tela de comissões não tem como mostrar isso.
   */
  const [{ pago }] = (await sql`
    SELECT COALESCE(SUM(fp.valor), 0)::float AS pago
    FROM fechamento_pagamentos fp
    JOIN fechamento_negocio_corretores rc ON rc.id = fp.negocio_corretor_id
    WHERE rc.negocio_id = ${id}
  `) as { pago: number }[];
  const novoPool = Number(linha.tipo === "venda" ? comissao : valor) || 0;
  if (pago > novoPool + 0.01) {
    return NextResponse.json({
      error: `já foram pagos R$ ${pago.toFixed(2)} deste negócio — a comissão não pode ficar abaixo disso`,
    }, { status: 400 });
  }

  await sql`
    UPDATE fechamento_negocios
    SET valor = ${valor}, comissao = ${comissao}, atualizado_em = NOW(), atualizado_por = ${session.id}
    WHERE id = ${id}
  `;

  return NextResponse.json({ ok: true, valor, comissao });
}
