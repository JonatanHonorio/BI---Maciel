"use client";
import { Fragment, useEffect, useState, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { fmtMoney } from "@/lib/format";

type Papel = "levantamento" | "fechamento";
type StatusPagamento = "pendente" | "parcial" | "pago";

type Pagamento = { id: number; valor: number; data_pagamento: string; observacao: string | null };
type Rateio = {
  id: number; corretor_id: number; nome: string; papel: Papel; percentual: number | null;
  pagamentos: Pagamento[]; valorDevido: number | null; valorPago: number;
};
type Negocio = {
  id: number; ref: string | null; endereco: string | null; valor: number | null; comissao: number | null;
  unidade: string; tipo: "venda" | "locacao"; rateio: Rateio[];
  valor_devido_total: number; valor_pago_total: number; ficou_pra_imobiliaria: number;
  status_pagamento: StatusPagamento;
};

const nomesPapel = (rateio: Rateio[], papel: Papel) =>
  rateio.filter((r) => r.papel === papel).map((r) => r.nome).join(", ") || "—";

const labelPapel: Record<Papel, string> = { levantamento: "Levantamento", fechamento: "Fechamento" };

const badgeStatus: Record<StatusPagamento, { label: string; cls: string }> = {
  pendente: { label: "Pendente", cls: "bg-amber-50 text-amber-700" },
  parcial: { label: "Parcial", cls: "bg-blue-50 text-blue-700" },
  pago: { label: "Pago", cls: "bg-emerald-50 text-emerald-700" },
};

// DATE vem como "YYYY-MM-DD..." — new Date() trataria como UTC e mostraria 1 dia antes no fuso do Brasil.
const fmtDataISO = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

function competenciaAtualISO() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Visão do financeiro: todos os negócios do mês, histórico de pagamento por destinatário do rateio. */
export default function ComissoesPage() {
  const [competencia, setCompetencia] = useState(competenciaAtualISO());
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [filtroStatus, setFiltroStatus] = useState<"todos" | StatusPagamento>("todos");
  const [carregando, setCarregando] = useState(true);
  const [semAcesso, setSemAcesso] = useState(false);
  const [erro, setErro] = useState("");
  const [expandido, setExpandido] = useState<number | null>(null);
  const [novoPagamento, setNovoPagamento] = useState<Record<number, { valor: string; data: string }>>({});

  // Trocar de mês rápido dispara buscas simultâneas, e elas não voltam
  // necessariamente na ordem em que saíram — sem isso uma resposta antiga
  // chegando depois mostra o mês errado na tela. Só a última busca manda.
  const buscaAtual = useRef(0);

  // 401/403 é falta de permissão mesmo; qualquer outro erro (banco fora do ar,
  // timeout do Neon) é falha temporária — não pode virar "acesso restrito",
  // que manda a gerente administrativa procurar permissão que ela já tem.
  const carregar = useCallback(async () => {
    const minhaBusca = ++buscaAtual.current;
    setCarregando(true);
    setErro("");
    try {
      const r = await fetch(`/api/fechamento/comissoes?competencia=${competencia}`);
      if (minhaBusca !== buscaAtual.current) return;
      if (r.status === 401 || r.status === 403) {
        setSemAcesso(true);
        return;
      }
      if (!r.ok) throw new Error("Não foi possível carregar as comissões. Tente de novo.");
      const j = await r.json();
      if (minhaBusca !== buscaAtual.current) return;
      setSemAcesso(false);
      setNegocios(j.negocios ?? []);
    } catch {
      if (minhaBusca !== buscaAtual.current) return;
      setErro("Não foi possível carregar as comissões. Tente de novo.");
    } finally {
      if (minhaBusca === buscaAtual.current) setCarregando(false);
    }
  }, [competencia]);

  useEffect(() => { carregar(); }, [carregar]);

  if (semAcesso) {
    return <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Acesso restrito ao administrativo.</div>;
  }

  // Sem o aviso de erro aqui o lançamento falha calado: a gerente clica,
  // nada acontece na tela e ela não sabe se gravou ou não.
  async function registrarPagamento(negocioCorretorId: number) {
    const form = novoPagamento[negocioCorretorId];
    if (!form?.valor || !form?.data) {
      setErro("Informe valor e data do pagamento.");
      return;
    }
    setErro("");
    try {
      const r = await fetch("/api/fechamento/pagamentos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ negocio_corretor_id: negocioCorretorId, valor: Number(form.valor), data_pagamento: form.data, observacao: null }),
      });
      if (!r.ok) throw new Error();
      setNovoPagamento((s) => ({ ...s, [negocioCorretorId]: { valor: "", data: "" } }));
      carregar();
    } catch {
      setErro("Não foi possível registrar o pagamento. Tente de novo.");
    }
  }

  async function excluirPagamento(pagamentoId: number) {
    setErro("");
    try {
      const r = await fetch(`/api/fechamento/pagamentos/${pagamentoId}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      carregar();
    } catch {
      setErro("Não foi possível excluir o pagamento. Tente de novo.");
    }
  }

  const filtrados = negocios.filter((n) => (filtroStatus === "todos" ? true : n.status_pagamento === filtroStatus));
  const totalDevido = filtrados.reduce((s, n) => s + n.valor_devido_total, 0);
  const totalPago = filtrados.reduce((s, n) => s + n.valor_pago_total, 0);
  const totalFicou = filtrados.reduce((s, n) => s + n.ficou_pra_imobiliaria, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Controle de comissões</h2>
        <div className="flex gap-2">
          <input
            type="month"
            value={competencia.slice(0, 7)}
            onChange={(e) => setCompetencia(`${e.target.value}-01`)}
            className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm"
          />
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm">
            <option value="todos">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="parcial">Parcial</option>
            <option value="pago">Pago</option>
          </select>
        </div>
      </div>

      {erro && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {erro}
          <button onClick={carregar} className="font-medium underline hover:no-underline">Tentar de novo</button>
        </div>
      )}

      <div className="flex flex-wrap gap-6 rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <span><span className="text-gray-500">Negócios: </span><span className="font-semibold">{filtrados.length}</span></span>
        <span><span className="text-gray-500">Devido: </span><span className="font-semibold">{fmtMoney(totalDevido)}</span></span>
        <span><span className="text-gray-500">Pago: </span><span className="font-semibold text-emerald-700">{fmtMoney(totalPago)}</span></span>
        <span><span className="text-gray-500">Pendente: </span><span className="font-semibold text-amber-600">{fmtMoney(totalDevido - totalPago)}</span></span>
        <span><span className="text-gray-500">Ficou pra Imobiliária: </span><span className="font-semibold">{fmtMoney(totalFicou)}</span></span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
              <th className="px-3 py-2.5"></th>
              <th className="px-3 py-2.5">Unidade</th>
              <th className="px-3 py-2.5">Tipo</th>
              <th className="px-3 py-2.5">Ref</th>
              <th className="px-3 py-2.5">Endereço</th>
              <th className="px-3 py-2.5">Levantamento</th>
              <th className="px-3 py-2.5">Fechamento</th>
              <th className="px-3 py-2.5 text-right">Status</th>
              <th className="px-3 py-2.5 text-right">Ficou pra Imobiliária</th>
            </tr>
          </thead>
          <tbody>
            {carregando ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-gray-400">Carregando...</td></tr>
            ) : filtrados.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-gray-400">Nenhum negócio neste mês.</td></tr>
            ) : (
              filtrados.map((n, i) => {
                const aberto = expandido === n.id;
                const badge = badgeStatus[n.status_pagamento];
                return (
                  <Fragment key={n.id}>
                    <tr
                      onClick={() => setExpandido(aberto ? null : n.id)}
                      className={`cursor-pointer ${i % 2 === 1 ? "bg-gray-50/50" : ""} hover:bg-blue-50/40`}
                    >
                      <td className="px-3 py-2 text-gray-400">{aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td className="px-3 py-2">{n.unidade}</td>
                      <td className="px-3 py-2">{n.tipo === "venda" ? "Vendas" : "Locação"}</td>
                      <td className="px-3 py-2">{n.ref || "—"}</td>
                      <td className="px-3 py-2">{n.endereco || "—"}</td>
                      <td className="px-3 py-2">{nomesPapel(n.rateio, "levantamento")}</td>
                      <td className="px-3 py-2">{nomesPapel(n.rateio, "fechamento")}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                        <div className="mt-0.5 text-[11px] text-gray-400">{fmtMoney(n.valor_pago_total)} / {fmtMoney(n.valor_devido_total)}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtMoney(n.ficou_pra_imobiliaria)}</td>
                    </tr>
                    {aberto && (
                      <tr className="bg-gray-50/70">
                        <td></td>
                        <td colSpan={8} className="space-y-3 px-3 py-3">
                          {n.rateio.length === 0 ? (
                            <p className="text-xs text-gray-400">Nenhum destinatário de rateio neste negócio.</p>
                          ) : (
                            n.rateio.map((r) => {
                              const form = novoPagamento[r.id] ?? { valor: "", data: "" };
                              return (
                                <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                    <span className="font-medium text-gray-800">
                                      {r.nome} <span className="text-gray-400">— {labelPapel[r.papel]}{r.percentual != null ? ` (${(r.percentual * 100).toFixed(0)}%)` : ""}</span>
                                    </span>
                                    <span className="text-gray-500">
                                      Devido: <span className="font-medium text-gray-700">{r.valorDevido != null ? fmtMoney(r.valorDevido) : "—"}</span>
                                      {" · "}Pago: <span className="font-medium text-emerald-700">{fmtMoney(r.valorPago)}</span>
                                    </span>
                                  </div>

                                  {r.pagamentos.length > 0 && (
                                    <ul className="mt-2 space-y-1">
                                      {r.pagamentos.map((p) => (
                                        <li key={p.id} className="flex items-center justify-between text-xs text-gray-600">
                                          <span>{fmtDataISO(p.data_pagamento)} — {fmtMoney(p.valor)}{p.observacao ? ` (${p.observacao})` : ""}</span>
                                          <button onClick={() => excluirPagamento(p.id)} className="text-gray-300 hover:text-red-600">
                                            <Trash2 size={12} />
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}

                                  <div className="mt-2 flex items-center gap-1.5">
                                    <input
                                      type="number" step="0.01" placeholder="Valor"
                                      value={form.valor}
                                      onChange={(e) => setNovoPagamento((s) => ({ ...s, [r.id]: { ...form, valor: e.target.value } }))}
                                      className="w-28 rounded-md border border-gray-200 px-2 py-1 text-xs"
                                    />
                                    <input
                                      type="date"
                                      value={form.data}
                                      onChange={(e) => setNovoPagamento((s) => ({ ...s, [r.id]: { ...form, data: e.target.value } }))}
                                      className="rounded-md border border-gray-200 px-2 py-1 text-xs"
                                    />
                                    <button
                                      onClick={() => registrarPagamento(r.id)}
                                      className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                                    >
                                      Registrar pagamento
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
