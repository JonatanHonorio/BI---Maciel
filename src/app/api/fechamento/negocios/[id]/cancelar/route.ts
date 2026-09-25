import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeAcessarPeriodo, podeLancarComissao } from "@/lib/permissoes";

/**
 * Marca (ou desmarca) uma venda como cancelada/distratada.
 *
 * Rota própria, e não o PUT do negócio, por um motivo de regra: o PUT exige
 * período ABERTO, e cancelamento quase sempre chega DEPOIS do mês fechado —
 * a venda de dezembro que distrata em março. Travar por status impediria
 * justamente o caso real.
 *
 * Quem pode: as mesmas pessoas que lançam comissão (admin e gerente
 * administrativa), dentro do escopo da própria unidade. É quem já mexe em
 * dinheiro do fechamento.
 *
 * O registro nunca é apagado: a linha continua na lista com a marca, e quem
 * soma é que passa a ignorá-la. Apagar perderia o histórico de que o imóvel
 * chegou a ser vendido.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  if (!podeLancarComissao(session)) {
    return NextResponse.json({ error: "sem permissão para cancelar venda" }, { status: 403 });
  }

  const sql = getDb();
  const [linha] = await sql`
    SELECT n.id, n.cancelado, p.unidade, p.tipo
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE n.id = ${id}
  `;
  if (!linha) return NextResponse.json({ error: "negócio não encontrado" }, { status: 404 });
  if (!podeAcessarPeriodo(session, linha)) {
    return NextResponse.json({ error: "sem acesso a este período" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { cancelado?: boolean; motivo?: string };
  // Sem `cancelado` no corpo, alterna — é o que o botão da tela manda.
  const novo = typeof body.cancelado === "boolean" ? body.cancelado : !linha.cancelado;
  const motivo = body.motivo?.trim() || null;

  await sql`
    UPDATE fechamento_negocios SET
      cancelado = ${novo},
      cancelado_em = ${novo ? new Date().toISOString() : null},
      cancelado_por = ${novo ? session.id : null},
      cancelado_motivo = ${novo ? motivo : null}
    WHERE id = ${id}
  `;

  return NextResponse.json({ ok: true, cancelado: novo });
}
