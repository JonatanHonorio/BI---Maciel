import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession, type Session } from "@/lib/auth";
import { normalizaLinhaRateio, type Papel, type RateioEntrada } from "@/lib/fechamento";
import { PERMITE_NOME_LIVRE_NO_RATEIO } from "@/lib/flags";
import { podeAcessarPeriodo } from "@/lib/permissoes";

interface RateioInput extends RateioEntrada {
  papel: Papel;
  percentual: number | null;
}

/**
 * Só edita/remove se o período estiver 'aberto' (ou o usuário for admin) E
 * o período for da própria unidade/tipo do gerente — sem isso, um gerente
 * poderia mandar um periodo_id de outra unidade/tipo direto na requisição.
 */
async function periodoEditavel(sql: ReturnType<typeof getDb>, negocioId: number, session: Session) {
  const [row] = await sql`
    SELECT p.status, p.unidade, p.tipo FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE n.id = ${negocioId}
  `;
  if (!row) return { ok: false, status: 404 as const };
  if (!podeAcessarPeriodo(session, row)) return { ok: false, status: 403 as const };
  if (row.status !== "aberto" && session.role !== "admin") return { ok: false, status: 409 as const };
  return { ok: true as const };
}

function erroPeriodoEditavel(status: 404 | 403 | 409) {
  if (status === 404) return "negócio não encontrado";
  if (status === 403) return "sem acesso a este período";
  return "período já foi enviado — peça pro admin reabrir";
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const negocioId = Number(id);
  const check = await periodoEditavel(getDb(), negocioId, session);
  if (!check.ok) {
    return NextResponse.json({ error: erroPeriodoEditavel(check.status) }, { status: check.status });
  }

  const body = await req.json();
  const rateio = ((body.rateio ?? []) as RateioInput[]).map((r) => {
    const destino = normalizaLinhaRateio(r, PERMITE_NOME_LIVRE_NO_RATEIO);
    return destino && { ...destino, papel: r.papel, percentual: r.percentual };
  });
  if (rateio.some((r) => !r)) {
    return NextResponse.json(
      { error: "rateio inválido: cada item precisa de papel e de um corretor (da lista ou pelo nome)" },
      { status: 400 }
    );
  }

  const sql = getDb();
  await sql`
    UPDATE fechamento_negocios SET
      data_contrato = ${body.data_contrato}, ref = ${body.ref}, contrato = ${body.contrato},
      endereco = ${body.endereco}, origem = ${body.origem}, valor = ${body.valor},
      comissao = ${body.comissao}, pagamento = ${body.pagamento}, observacao = ${body.observacao},
      atualizado_em = NOW(), atualizado_por = ${session.id}
    WHERE id = ${negocioId}
  `;

  await sql`DELETE FROM fechamento_negocio_corretores WHERE negocio_id = ${negocioId}`;
  for (const r of rateio) {
    await sql`
      INSERT INTO fechamento_negocio_corretores (negocio_id, papel, corretor_id, nome_livre, percentual)
      VALUES (${negocioId}, ${r!.papel}, ${r!.corretor_id}, ${r!.nome_livre}, ${r!.percentual})
    `;
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const negocioId = Number(id);
  const sql = getDb();
  const check = await periodoEditavel(sql, negocioId, session);
  if (!check.ok) {
    return NextResponse.json({ error: erroPeriodoEditavel(check.status) }, { status: check.status });
  }

  await sql`DELETE FROM fechamento_negocios WHERE id = ${negocioId}`;
  return NextResponse.json({ ok: true });
}
