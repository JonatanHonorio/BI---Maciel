import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession, type Session } from "@/lib/auth";
import { normalizaLinhaRateio, type Papel, type RateioEntrada } from "@/lib/fechamento";
import { PERMITE_NOME_LIVRE_NO_RATEIO } from "@/lib/flags";
import { podeAcessarPeriodo } from "@/lib/permissoes";
import { camposFaltando, erroCamposFaltando, type TipoNegocio } from "@/lib/negocio-obrigatorio";

interface RateioInput extends RateioEntrada {
  papel: Papel;
  percentual: number | null;
}

/**
 * Só edita/remove se o período estiver 'aberto' (ou o usuário for admin) E
 * o período for da própria unidade/tipo do gerente — sem isso, um gerente
 * poderia mandar um periodo_id de outra unidade/tipo direto na requisição.
 */
type Editavel =
  | { ok: false; status: 404 | 403 | 409 }
  | { ok: true; tipo: TipoNegocio };

// Tipo declarado à mão: sem ele o TypeScript funde os dois lados da união e
// `check.tipo` vira `TipoNegocio | undefined` mesmo depois do `if (!check.ok)`.
async function periodoEditavel(
  sql: ReturnType<typeof getDb>, negocioId: number, session: Session
): Promise<Editavel> {
  const [row] = await sql`
    SELECT p.status, p.unidade, p.tipo FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE n.id = ${negocioId}
  `;
  if (!row) return { ok: false, status: 404 as const };
  if (!podeAcessarPeriodo(session, row)) return { ok: false, status: 403 as const };
  if (row.status !== "aberto" && session.role !== "admin") return { ok: false, status: 409 as const };
  // A vertical sobe junto: é ela que decide se forma de pagamento é exigida.
  return { ok: true as const, tipo: row.tipo as TipoNegocio };
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
      {
        // A mensagem acompanha a chave: com a digitação livre desligada,
        // mandar "ou pelo nome" faria a adm tentar de novo o que não existe.
        error: PERMITE_NOME_LIVRE_NO_RATEIO
          ? "rateio inválido: cada item precisa de papel e de um corretor (da lista ou pelo nome)"
          : "rateio inválido: cada item precisa de papel e de um corretor da lista",
      },
      { status: 400 }
    );
  }

  // Mesma trava do POST: editar não pode ser a porta dos fundos para deixar
  // um campo obrigatório em branco.
  const faltam = camposFaltando(body, check.tipo);
  if (faltam.length > 0) {
    return NextResponse.json({ error: erroCamposFaltando(faltam) }, { status: 400 });
  }

  const sql = getDb();

  /*
   * Esta rota reescreve o rateio (DELETE + INSERT abaixo), e
   * `fechamento_pagamentos` tem FK em CASCADE para as linhas do rateio — ou
   * seja, editar um negócio que já teve baixa apagaria as baixas EM SILÊNCIO.
   *
   * Para corrigir só valor/comissão existe `negocios/[id]/valores`, que não
   * encosta no rateio e por isso preserva os pagamentos.
   */
  const [{ pagamentos }] = (await sql`
    SELECT count(*)::int AS pagamentos
    FROM fechamento_pagamentos fp
    JOIN fechamento_negocio_corretores rc ON rc.id = fp.negocio_corretor_id
    WHERE rc.negocio_id = ${negocioId}
  `) as { pagamentos: number }[];
  if (pagamentos > 0) {
    return NextResponse.json({
      error: `este negócio já tem ${pagamentos} baixa(s) de comissão lançada(s) — editá-lo apagaria os pagamentos. Para acertar valor ou comissão, use a correção de valores.`,
    }, { status: 409 });
  }

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
