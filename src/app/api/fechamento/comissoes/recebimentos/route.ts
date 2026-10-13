import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  recebimentosNoPeriodo, escopoUnidade, escopoTipo, UNIDADES_FECHAMENTO,
} from "@/lib/fechamento";
import { podeLancarComissao, unidadesFechamento, tiposFechamento } from "@/lib/permissoes";

/**
 * O caixa da comissão: tudo que a imobiliária RECEBEU DO CLIENTE numa faixa de
 * datas, parcela a parcela.
 *
 * É outra pergunta, não outro filtro da mesma: a tela por competência responde
 * "quanto o mês gerou", esta responde "quanto entrou no mês". Em agosto/2026 a
 * primeira dá R$ 176 mil e a segunda R$ 310 mil, e quase não se sobrepõem —
 * 92% do que entrou em agosto era de negócio de maio a julho.
 *
 * Cada linha é uma PARCELA e carrega a competência de origem, porque é isso que
 * permite conferir o extrato: "entrou R$ 2.534,87 em 12/08, do lote E3 L23, que
 * é da competência 12/2025".
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session || !podeLancarComissao(session)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const unidades = unidadesFechamento(session);
  const tipos = tiposFechamento(session);
  if (unidades?.length === 0) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const { de, ate } = faixaDeDatas(p.get("de"), p.get("ate"));

  // Unidade e vertical estreitam o que a pessoa já podia ver — nunca ampliam.
  const recebimentos = await recebimentosNoPeriodo(
    getDb(), de, ate,
    escopoUnidade(unidades, p.get("unidade")),
    escopoTipo(tipos, p.get("tipo")),
  );

  const soma = (lista: { valor: number | string }[]) =>
    lista.reduce((s, r) => s + Number(r.valor), 0);

  // Os dois recortes que a Tatiane pediu junto com o total: de qual unidade
  // veio o dinheiro, e de qual competência ele é. O segundo é o que mostra o
  // descasamento entre o mês que vendeu e o mês que recebeu.
  const agrupar = <K extends string>(chave: (r: (typeof recebimentos)[number]) => K) => {
    const m = new Map<K, { parcelas: number; valor: number }>();
    for (const r of recebimentos) {
      const k = chave(r);
      const atual = m.get(k) ?? { parcelas: 0, valor: 0 };
      atual.parcelas += 1;
      atual.valor += Number(r.valor);
      m.set(k, atual);
    }
    return [...m.entries()].map(([k, v]) => ({ chave: k, ...v }));
  };

  return NextResponse.json({
    de, ate,
    unidade: p.get("unidade") || null,
    tipo: p.get("tipo") || null,
    unidades_disponiveis: unidades ?? [...UNIDADES_FECHAMENTO],
    recebimentos,
    totais: {
      valor: soma(recebimentos),
      parcelas: recebimentos.length,
      negocios: new Set(recebimentos.map((r) => r.negocio_id)).size,
    },
    por_unidade: agrupar((r) => r.unidade).sort((a, b) => b.valor - a.valor),
    por_competencia: agrupar((r) => String(r.competencia).slice(0, 7))
      .sort((a, b) => a.chave.localeCompare(b.chave)),
  });
}

/**
 * Faixa de datas da consulta. Sem parâmetro, o mês corrente inteiro — que é o
 * uso do dia a dia ("quanto entrou este mês").
 *
 * Datas fora de 2000–2100 são recusadas em silêncio e trocadas pelo padrão: a
 * tabela tem parcela gravada com ano 0005 e com ano 275760, as duas erros de
 * digitação no campo de data, e uma faixa assim na consulta varre a tabela
 * inteira sem o filtro significar nada.
 */
function faixaDeDatas(dePedido: string | null, atePedido: string | null) {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, "0");
  const ultimoDia = new Date(ano, hoje.getMonth() + 1, 0).getDate();
  const padraoDe = `${ano}-${mes}-01`;
  const padraoAte = `${ano}-${mes}-${String(ultimoDia).padStart(2, "0")}`;

  const valida = (d: string | null) =>
    d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= "2000-01-01" && d <= "2100-12-31" ? d : null;

  const de = valida(dePedido) ?? padraoDe;
  const ate = valida(atePedido) ?? padraoAte;
  // Invertido devolveria vazio sem explicar por quê.
  return de <= ate ? { de, ate } : { de: ate, ate: de };
}
