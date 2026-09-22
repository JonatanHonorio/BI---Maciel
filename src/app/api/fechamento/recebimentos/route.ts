import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeLancarComissao, podeAcessarPeriodo } from "@/lib/permissoes";

interface Entrada {
  negocio_id: number;
  valor: number;
  data_recebimento: string;
  observacao?: string | null;
}

const cent = (v: number) => Math.round(v * 100) / 100;

/**
 * Registra uma PARCELA recebida da comissão e distribui sozinha entre os
 * destinatários do rateio, cada um pelo seu percentual.
 *
 * Pedido da Tatiane em 22/09/2026. Antes, uma comissão de R$20.000 em 3
 * parcelas de R$6.666,66 significava pegar cada parcela, multiplicar por 3%,
 * 1%, 30%... e lançar seis baixas à mão — por parcela, por negócio.
 *
 * O que sobra de cada parcela **fica com a imobiliária**: o rateio distribui
 * 54,5% numa venda cheia, e os outros 45,5% não são pagos a ninguém.
 */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session || !podeLancarComissao(session)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as Entrada;
  const valor = Number(body.valor);
  if (!body.negocio_id || !Number.isFinite(valor) || valor <= 0 || !body.data_recebimento) {
    return NextResponse.json(
      { error: "negocio_id, valor (>0) e data_recebimento são obrigatórios" }, { status: 400 });
  }

  const sql = getDb();
  const [negocio] = (await sql`
    SELECT n.id, n.valor AS valor_negocio, n.comissao, p.unidade, p.tipo
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE n.id = ${body.negocio_id}
  `) as { id: number; valor_negocio: string | null; comissao: string | null; unidade: string; tipo: string }[];
  if (!negocio) return NextResponse.json({ error: "negócio não encontrado" }, { status: 404 });
  if (!podeAcessarPeriodo(session, negocio)) {
    return NextResponse.json({ error: "sem acesso a este período" }, { status: 403 });
  }

  // O que se recebe é a COMISSÃO da venda, ou a prestação de serviço da
  // locação — a mesma base sobre a qual o rateio foi montado.
  const pool = Number(negocio.tipo === "venda" ? negocio.comissao : negocio.valor_negocio) || 0;
  if (pool <= 0) {
    return NextResponse.json(
      { error: "este negócio está sem valor de comissão — preencha antes de lançar o recebimento" },
      { status: 400 });
  }

  const [{ ja }] = (await sql`
    SELECT COALESCE(SUM(valor), 0)::float AS ja
    FROM fechamento_recebimentos WHERE negocio_id = ${body.negocio_id}
  `) as { ja: number }[];

  // Passar da comissão é quase sempre dígito a mais. Um centavo de folga
  // porque parcela quebrada (20.000 ÷ 3) nunca fecha exata.
  if (ja + valor > pool + 0.01) {
    return NextResponse.json({
      error: `recebimento de R$ ${valor.toFixed(2)} passa da comissão do negócio (R$ ${pool.toFixed(2)}, já recebidos R$ ${ja.toFixed(2)})`,
    }, { status: 400 });
  }

  const rateio = (await sql`
    SELECT rc.id, rc.percentual,
      COALESCE((SELECT SUM(fp.valor) FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id), 0)::float AS pago
    FROM fechamento_negocio_corretores rc
    WHERE rc.negocio_id = ${body.negocio_id} AND rc.percentual IS NOT NULL
    ORDER BY rc.id
  `) as { id: number; percentual: string; pago: number }[];
  if (!rateio.length) {
    return NextResponse.json({ error: "negócio sem rateio — nada a distribuir" }, { status: 400 });
  }

  // Esta parcela fecha a comissão? Aí cada um recebe exatamente o que falta,
  // em vez do percentual arredondado — senão um centavo de sobra deixaria o
  // negócio em "Parcial" para sempre, com todo mundo pago.
  const fecha = Math.abs(ja + valor - pool) < 0.01;

  const [recebimento] = await sql`
    INSERT INTO fechamento_recebimentos (negocio_id, valor, data_recebimento, observacao, criado_por)
    VALUES (${body.negocio_id}, ${valor}, ${body.data_recebimento}, ${body.observacao ?? null}, ${session.id})
    RETURNING id
  `;

  let distribuido = 0;
  for (const r of rateio) {
    const pct = Number(r.percentual);
    const devido = cent(pct * pool);
    const fatia = fecha ? cent(devido - r.pago) : Math.min(cent(pct * valor), cent(devido - r.pago));
    if (fatia <= 0) continue;
    await sql`
      INSERT INTO fechamento_pagamentos (negocio_corretor_id, valor, data_pagamento, observacao, criado_por, recebimento_id)
      VALUES (${r.id}, ${fatia}, ${body.data_recebimento}, ${body.observacao ?? null}, ${session.id}, ${recebimento.id})
    `;
    distribuido = cent(distribuido + fatia);
  }

  return NextResponse.json({
    id: recebimento.id,
    valor,
    distribuido,
    // O que não tem dono no rateio fica com a imobiliária — é o número que a
    // Tatiane pediu pra não sumir da tela.
    imobiliaria: cent(valor - distribuido),
    fechou: fecha,
  }, { status: 201 });
}
