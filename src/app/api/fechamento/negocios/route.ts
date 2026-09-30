import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { normalizaLinhaRateio, type Papel, type RateioEntrada } from "@/lib/fechamento";
import { PERMITE_NOME_LIVRE_NO_RATEIO } from "@/lib/flags";
import { podeAcessarPeriodo } from "@/lib/permissoes";
import { camposFaltando, erroCamposFaltando } from "@/lib/negocio-obrigatorio";

interface RateioInput extends RateioEntrada {
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
  // Normaliza antes de gravar: cada linha vira (corretor do Kurole) OU
  // (nome digitado), nunca as duas coisas nem nenhuma.
  const rateio = (body.rateio ?? []).map((r) => {
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

  const sql = getDb();

  const [periodo] = await sql`SELECT id, status, unidade, tipo FROM fechamento_periodos WHERE id = ${body.periodo_id}`;
  if (!periodo) return NextResponse.json({ error: "período não encontrado" }, { status: 404 });

  if (!podeAcessarPeriodo(session, periodo)) {
    return NextResponse.json({ error: "sem acesso a este período" }, { status: 403 });
  }

  if (periodo.status !== "aberto" && session.role !== "admin") {
    return NextResponse.json({ error: "período já foi enviado — peça pro admin reabrir" }, { status: 409 });
  }

  /*
   * A trava dos campos obrigatórios fica aqui, e não só no formulário, porque
   * é aqui que ela vale: a tela é a primeira barreira, esta é a que garante.
   * A vertical vem do PERÍODO, não do corpo da requisição — forma de pagamento
   * só é exigida em venda.
   */
  const faltam = camposFaltando(body, periodo.tipo);
  if (faltam.length > 0) {
    return NextResponse.json({ error: erroCamposFaltando(faltam) }, { status: 400 });
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
      INSERT INTO fechamento_negocio_corretores (negocio_id, papel, corretor_id, nome_livre, percentual)
      VALUES (${negocio.id}, ${r!.papel}, ${r!.corretor_id}, ${r!.nome_livre}, ${r!.percentual})
    `;
  }

  return NextResponse.json({ id: negocio.id }, { status: 201 });
}
