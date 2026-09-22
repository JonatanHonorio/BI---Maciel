import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  competenciaAtual, calcularStatusPagamento, negociosDaCompetencia,
} from "@/lib/fechamento";
import { podeLancarComissao, unidadesFechamento, tiposFechamento } from "@/lib/permissoes";

/**
 * Negócios do mês pra tela de comissão: o admin vê todas as unidades; a
 * gerente administrativa, só as dela. Sem o filtro de unidade abaixo, as sete
 * adms veriam a comissão da empresa inteira.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session || !podeLancarComissao(session)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const unidades = unidadesFechamento(session);
  const tipos = tiposFechamento(session);
  if (unidades?.length === 0) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Faixa de competências. Sem parâmetro, o mês corrente — a tela abre no mês,
  // e quem quiser o ano inteiro amplia. `ate` sozinho vale como `de`, e
  // vice-versa, pra não devolver vazio quando só um lado vem preenchido.
  const p = req.nextUrl.searchParams;
  const de = p.get("de") || p.get("competencia") || competenciaAtual();
  const ate = p.get("ate") || p.get("competencia") || de;
  const sql = getDb();

  const negocios = await negociosDaCompetencia(sql, de, ate, unidades, tipos);

  const comNegociosComputados = negocios.map((n) => {
    const pool = n.tipo === "venda" ? n.comissao : n.valor;
    const { rateio, valorDevidoTotal, valorPagoTotal, ficouParaImobiliaria, status } = calcularStatusPagamento(pool, n.rateio);
    return {
      ...n,
      rateio: rateio.map(({ linha, valorDevido, valorPago }) => ({ ...linha, valorDevido, valorPago })),
      valor_devido_total: valorDevidoTotal,
      valor_pago_total: valorPagoTotal,
      ficou_pra_imobiliaria: ficouParaImobiliaria,
      status_pagamento: status,
    };
  });

  /**
   * Quanto cada destinatário tem a receber e quanto já recebeu no mês.
   *
   * Vem do servidor, e não somado na tela, porque a mesma conta alimenta a
   * exportação em Excel — duas somas escritas em lugares diferentes acabam
   * divergindo.
   *
   * A chave é o corretor quando existe e o rótulo quando é rubrica (Diretoria,
   * Lançamento, Brizola), que não tem pessoa.
   */
  const porDestinatario = new Map<string, {
    corretor_id: number | null; nome: string; papeis: Set<string>;
    devido: number; pago: number; negocios: number;
  }>();
  for (const n of comNegociosComputados) {
    for (const r of n.rateio) {
      const chave = r.corretor_id != null ? `c${r.corretor_id}` : `r:${r.nome}`;
      const atual = porDestinatario.get(chave) ?? {
        corretor_id: r.corretor_id ?? null, nome: r.nome,
        papeis: new Set<string>(), devido: 0, pago: 0, negocios: 0,
      };
      atual.papeis.add(r.papel);
      atual.devido += r.valorDevido ?? 0;
      atual.pago += r.valorPago;
      atual.negocios += 1;
      porDestinatario.set(chave, atual);
    }
  }

  const destinatarios = [...porDestinatario.values()]
    .map((d) => ({
      corretor_id: d.corretor_id, nome: d.nome, papeis: [...d.papeis],
      negocios: d.negocios, devido: d.devido, pago: d.pago,
      pendente: d.devido - d.pago,
    }))
    .sort((a, b) => b.pendente - a.pendente || a.nome.localeCompare(b.nome));

  const totais = {
    devido: comNegociosComputados.reduce((s, n) => s + n.valor_devido_total, 0),
    pago: comNegociosComputados.reduce((s, n) => s + n.valor_pago_total, 0),
    imobiliaria: comNegociosComputados.reduce((s, n) => s + n.ficou_pra_imobiliaria, 0),
    negocios: comNegociosComputados.length,
  };

  return NextResponse.json({
    de, ate, negocios: comNegociosComputados, destinatarios, totais,
  });
}
