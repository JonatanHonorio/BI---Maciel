import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { PAPEIS_RATEIO, type Papel } from "@/lib/fechamento";

interface RateioInput {
  corretor_id: number;
  papel: Papel;
  percentual: number | null;
}

interface NegocioInput {
  periodo_id: number;
  data_contrato: string | null;
  ref: string | null;
  contrato: string | null;
  endereco: string | null;
  origem: string | null;
  valor: number | null;
  comissao: number | null;
  pagamento: string | null;
  observacao: string | null;
  rateio: RateioInput[];
}

/**
 * Adiciona um negócio (+ rateio) no período. Recusa se o período não estiver
 * 'aberto' e o usuário não for admin — só admin escreve num período fechado
 * (reabertura é feita à parte, via /reabrir).
 */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as NegocioInput;
  if (!body.periodo_id) {
    return NextResponse.json({ error: "periodo_id obrigatório" }, { status: 400 });
  }
  const rateio = body.rateio ?? [];
  for (const r of rateio) {
    if (!r.corretor_id || !PAPEIS_RATEIO.includes(r.papel)) {
      return NextResponse.json({ error: "rateio inválido: cada item precisa de corretor_id e papel" }, { status: 400 });
    }
  }

  const sql = getDb();

  const [periodo] = await sql`SELECT id, status, unidade, tipo FROM fechamento_periodos WHERE id = ${body.periodo_id}`;
  if (!periodo) return NextResponse.json({ error: "período não encontrado" }, { status: 404 });

  const dono = session.role === "admin" || (session.unidade === periodo.unidade && session.tipo === periodo.tipo);
  if (!dono) return NextResponse.json({ error: "sem acesso a este período" }, { status: 403 });

  if (periodo.status !== "aberto" && session.role !== "admin") {
    return NextResponse.json({ error: "período já foi enviado — peça pro admin reabrir" }, { status: 409 });
  }

  const [negocio] = await sql`
    INSERT INTO fechamento_negocios
      (periodo_id, data_contrato, ref, contrato, endereco, origem, valor, comissao, pagamento, observacao, criado_por)
    VALUES
      (${body.periodo_id}, ${body.data_contrato}, ${body.ref}, ${body.contrato}, ${body.endereco},
       ${body.origem}, ${body.valor}, ${body.comissao}, ${body.pagamento}, ${body.observacao}, ${session.id})
    RETURNING id
  `;

  for (const r of rateio) {
    await sql`
      INSERT INTO fechamento_negocio_corretores (negocio_id, papel, corretor_id, percentual)
      VALUES (${negocio.id}, ${r.papel}, ${r.corretor_id}, ${r.percentual})
    `;
  }

  return NextResponse.json({ id: negocio.id }, { status: 201 });
}
