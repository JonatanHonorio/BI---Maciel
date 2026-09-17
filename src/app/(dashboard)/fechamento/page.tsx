"use client";
import { useEffect, useState, useCallback } from "react";
import { Plus, Send, Download, Lock, Unlock } from "lucide-react";
import DataTable from "@/components/DataTable";
import FechamentoForm from "@/components/FechamentoForm";
import { fmtMoney, fmtDate } from "@/lib/format";

type Rateio = { corretor_id: number; nome: string; papel: "levantamento" | "fechamento"; percentual: number | null };
type Negocio = {
  id: number; data_contrato: string | null; ref: string | null; contrato: string | null;
  endereco: string | null; origem: string | null; valor: number | null; comissao: number | null;
  pagamento: string | null; observacao: string | null; comissao_paga: boolean; rateio: Rateio[];
};
type Periodo = { id: number; competencia: string; unidade: string; tipo: "venda" | "locacao"; status: "aberto" | "enviado" };
type Resposta = {
  session: { role: "admin" | "gerente"; unidade: string | null; tipo: "venda" | "locacao" | null; nome: string };
  unidades: readonly string[];
  periodo: Periodo | null;
  negocios: Negocio[];
};

const nomesPapel = (rateio: Rateio[], papel: string) =>
  rateio.filter((r) => r.papel === papel).map((r) => r.nome).join(", ") || "—";

export default function FechamentoPage() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [corretores, setCorretores] = useState<{ id: number; nome: string }[]>([]);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [unidadeAdmin, setUnidadeAdmin] = useState("");
  const [tipoAdmin, setTipoAdmin] = useState<"venda" | "locacao" | "">("");
  const [carregando, setCarregando] = useState(true);
  const [confirmarEnvio, setConfirmarEnvio] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const isAdminEscolhendo = dados?.session.role === "admin";
    const qs = isAdminEscolhendo && unidadeAdmin && tipoAdmin ? `?unidade=${encodeURIComponent(unidadeAdmin)}&tipo=${tipoAdmin}` : "";
    const r = await fetch(`/api/fechamento${qs}`);
    const j = (await r.json()) as Resposta;
    setDados(j);
    setCarregando(false);
  }, [dados?.session.role, unidadeAdmin, tipoAdmin]);

  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (unidadeAdmin && tipoAdmin) carregar(); }, [unidadeAdmin, tipoAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dados?.periodo) return;
    const params = dados.session.role === "admin" ? `?unidade=${encodeURIComponent(dados.periodo.unidade)}&tipo=${dados.periodo.tipo}` : "";
    fetch(`/api/fechamento/corretores${params}`).then((r) => r.json()).then(setCorretores);
  }, [dados?.periodo, dados?.session.role]);

  async function enviar() {
    if (!dados?.periodo) return;
    await fetch("/api/fechamento/enviar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodo_id: dados.periodo.id }),
    });
    setConfirmarEnvio(false);
    carregar();
  }

  async function reabrir() {
    if (!dados?.periodo) return;
    await fetch("/api/fechamento/reabrir", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodo_id: dados.periodo.id }),
    });
    carregar();
  }

  async function excluir(negocioId: number) {
    await fetch(`/api/fechamento/negocios/${negocioId}`, { method: "DELETE" });
    setConfirmarExclusao(null);
    carregar();
  }

  if (carregando && !dados) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }
  if (!dados) return null;

  const isAdmin = dados.session.role === "admin";
  const periodo = dados.periodo;
  const travado = periodo?.status === "enviado";
  const totalValor = dados.negocios.reduce((s, n) => s + (n.valor ? Number(n.valor) : 0), 0);
  const totalComissao = dados.negocios.reduce((s, n) => s + (n.comissao ? Number(n.comissao) : 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Fechamento mensal</h2>
          {periodo && (
            <p className="text-sm text-gray-500">
              {periodo.unidade} · {periodo.tipo === "venda" ? "Vendas" : "Locação"} ·{" "}
              {new Date(periodo.competencia).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
              {" — "}
              <span className={travado ? "font-medium text-amber-600" : "font-medium text-emerald-600"}>
                {travado ? "Enviado" : "Em aberto"}
              </span>
            </p>
          )}
        </div>

        {isAdmin && (
          <div className="flex gap-2">
            <select value={unidadeAdmin} onChange={(e) => setUnidadeAdmin(e.target.value)} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm">
              <option value="">Unidade...</option>
              {dados.unidades.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <select value={tipoAdmin} onChange={(e) => setTipoAdmin(e.target.value as "venda" | "locacao" | "")} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm">
              <option value="">Tipo...</option>
              <option value="venda">Vendas</option>
              <option value="locacao">Locação</option>
            </select>
          </div>
        )}
      </div>

      {!periodo && isAdmin && (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Escolha unidade e tipo acima pra abrir o fechamento do mês.
        </div>
      )}

      {periodo && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex gap-6 text-sm">
              <span><span className="text-gray-500">Negócios: </span><span className="font-semibold">{dados.negocios.length}</span></span>
              <span><span className="text-gray-500">Total: </span><span className="font-semibold">{fmtMoney(totalValor)}</span></span>
              {periodo.tipo === "venda" && (
                <span><span className="text-gray-500">Comissão: </span><span className="font-semibold">{fmtMoney(totalComissao)}</span></span>
              )}
            </div>
            <div className="flex gap-2">
              <a
                href={`/api/fechamento/exportar?periodo_id=${periodo.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Download size={14} /> Excel
              </a>
              {!travado && (
                <button onClick={() => setMostrarForm(true)} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                  <Plus size={14} /> Adicionar negócio
                </button>
              )}
              {!travado ? (
                confirmarEnvio ? (
                  <span className="inline-flex items-center gap-2 rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
                    Confirma o envio? Depois só o admin edita.
                    <button onClick={enviar} className="font-semibold text-emerald-700 hover:underline">Sim</button>
                    <button onClick={() => setConfirmarEnvio(false)} className="text-gray-500 hover:underline">Não</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmarEnvio(true)} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
                    <Send size={14} /> Enviar fechamento
                  </button>
                )
              ) : isAdmin ? (
                <button onClick={reabrir} className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50">
                  <Unlock size={14} /> Reabrir
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-500">
                  <Lock size={14} /> Travado
                </span>
              )}
            </div>
          </div>

          {mostrarForm && (
            <FechamentoForm
              periodoId={periodo.id}
              tipo={periodo.tipo}
              corretores={corretores}
              onSalvo={() => { setMostrarForm(false); carregar(); }}
              onCancelar={() => setMostrarForm(false)}
            />
          )}

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <DataTable
              searchable
              columns={[
                { key: "data_contrato", label: "Data", format: (v) => (v ? fmtDate(v as string) : "—") },
                { key: "ref", label: "Ref" },
                { key: "endereco", label: "Endereço" },
                { key: "levantamento", label: "Levantamento" },
                { key: "fechamento", label: "Fechamento" },
                { key: "valor", label: "Valor", align: "right", format: (v) => (v ? fmtMoney(v as number) : "—") },
                ...(periodo.tipo === "venda"
                  ? [{ key: "comissao", label: "Comissão", align: "right" as const, format: (v: unknown) => (v ? fmtMoney(v as number) : "—") }]
                  : []),
                { key: "origem", label: "Origem" },
              ]}
              data={dados.negocios.map((n) => ({
                ...n,
                levantamento: nomesPapel(n.rateio, "levantamento"),
                fechamento: nomesPapel(n.rateio, "fechamento"),
              }))}
            />
            {!travado && dados.negocios.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 pt-3">
                {dados.negocios.map((n) =>
                  confirmarExclusao === n.id ? (
                    <span key={n.id} className="inline-flex items-center gap-1.5 text-xs text-amber-700">
                      Excluir #{n.id}?
                      <button onClick={() => excluir(n.id)} className="font-semibold text-red-600 hover:underline">Sim</button>
                      <button onClick={() => setConfirmarExclusao(null)} className="text-gray-500 hover:underline">Não</button>
                    </span>
                  ) : (
                    <button
                      key={n.id}
                      onClick={() => setConfirmarExclusao(n.id)}
                      className="text-xs text-gray-400 hover:text-red-600 hover:underline"
                    >
                      excluir #{n.id} ({n.ref || n.endereco || "sem ref"})
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
