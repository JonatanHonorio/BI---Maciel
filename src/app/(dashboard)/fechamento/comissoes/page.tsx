"use client";
import { useEffect, useState, useCallback } from "react";
import { fmtMoney } from "@/lib/format";

type Rateio = { corretor_id: number; nome: string; papel: "levantamento" | "fechamento"; percentual: number | null };
type Negocio = {
  id: number; ref: string | null; endereco: string | null; valor: number | null; comissao: number | null;
  comissao_paga: boolean; unidade: string; tipo: "venda" | "locacao"; rateio: Rateio[];
};

const nomesPapel = (rateio: Rateio[], papel: string) =>
  rateio.filter((r) => r.papel === papel).map((r) => r.nome).join(", ") || "—";

function competenciaAtualISO() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Visão do financeiro: todos os negócios do mês, checkbox de comissão paga. */
export default function ComissoesPage() {
  const [competencia, setCompetencia] = useState(competenciaAtualISO());
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [filtroPago, setFiltroPago] = useState<"todos" | "pagos" | "pendentes">("todos");
  const [carregando, setCarregando] = useState(true);
  const [semAcesso, setSemAcesso] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const r = await fetch(`/api/fechamento/comissoes?competencia=${competencia}`);
    if (!r.ok) {
      setSemAcesso(true);
      setCarregando(false);
      return;
    }
    const j = await r.json();
    setNegocios(j.negocios ?? []);
    setCarregando(false);
  }, [competencia]);

  useEffect(() => { carregar(); }, [carregar]);

  if (semAcesso) {
    return <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Acesso restrito a administradores.</div>;
  }

  async function marcarPago(id: number, pago: boolean) {
    setNegocios((prev) => prev.map((n) => (n.id === id ? { ...n, comissao_paga: pago } : n)));
    await fetch(`/api/fechamento/negocios/${id}/pago`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pago }),
    });
  }

  const filtrados = negocios.filter((n) =>
    filtroPago === "todos" ? true : filtroPago === "pagos" ? n.comissao_paga : !n.comissao_paga
  );
  const totalComissao = filtrados.reduce((s, n) => s + (n.comissao ? Number(n.comissao) : 0), 0);
  const totalPendente = filtrados.filter((n) => !n.comissao_paga).reduce((s, n) => s + (n.comissao ? Number(n.comissao) : 0), 0);

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
          <select value={filtroPago} onChange={(e) => setFiltroPago(e.target.value as typeof filtroPago)} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm">
            <option value="todos">Todos</option>
            <option value="pendentes">Pendentes</option>
            <option value="pagos">Pagos</option>
          </select>
        </div>
      </div>

      <div className="flex gap-6 rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <span><span className="text-gray-500">Negócios: </span><span className="font-semibold">{filtrados.length}</span></span>
        <span><span className="text-gray-500">Comissão total: </span><span className="font-semibold">{fmtMoney(totalComissao)}</span></span>
        <span><span className="text-gray-500">Pendente: </span><span className="font-semibold text-amber-600">{fmtMoney(totalPendente)}</span></span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
              <th className="px-3 py-2.5">Unidade</th>
              <th className="px-3 py-2.5">Tipo</th>
              <th className="px-3 py-2.5">Ref</th>
              <th className="px-3 py-2.5">Endereço</th>
              <th className="px-3 py-2.5">Levantamento</th>
              <th className="px-3 py-2.5">Fechamento</th>
              <th className="px-3 py-2.5 text-right">Comissão</th>
              <th className="px-3 py-2.5 text-center">Paga</th>
            </tr>
          </thead>
          <tbody>
            {carregando ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-gray-400">Carregando...</td></tr>
            ) : filtrados.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-gray-400">Nenhum negócio neste mês.</td></tr>
            ) : (
              filtrados.map((n, i) => (
                <tr key={n.id} className={i % 2 === 1 ? "bg-gray-50/50" : ""}>
                  <td className="px-3 py-2">{n.unidade}</td>
                  <td className="px-3 py-2">{n.tipo === "venda" ? "Vendas" : "Locação"}</td>
                  <td className="px-3 py-2">{n.ref || "—"}</td>
                  <td className="px-3 py-2">{n.endereco || "—"}</td>
                  <td className="px-3 py-2">{nomesPapel(n.rateio, "levantamento")}</td>
                  <td className="px-3 py-2">{nomesPapel(n.rateio, "fechamento")}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{n.comissao ? fmtMoney(n.comissao) : "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={n.comissao_paga}
                      onChange={(e) => marcarPago(n.id, e.target.checked)}
                      className="size-4 cursor-pointer accent-emerald-600"
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
