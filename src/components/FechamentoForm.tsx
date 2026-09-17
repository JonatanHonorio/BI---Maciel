"use client";
import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { fmtMoney } from "@/lib/format";

type Corretor = { id: number; nome: string };
type LinhaRateio = { corretor_id: number | ""; percentual: string };

const ORIGENS = [
  "Cliente de Carteira", "Plantão de Vendas", "Canal Pro", "Indicação", "Site",
  "Placa", "OLX", "ZAP", "VivaReal", "ImovelWeb", "Fachada da Imobiliária",
  "V4", "Facebook", "Instagram", "Panfletos", "Status/Story",
];
const PAGAMENTOS = ["Financiamento", "A Vista", "Fgts", "Consórcio", "Parcelado"];
const TAXA_COMISSAO_VENDA = 0.06;

/**
 * Formulário de "novo negócio" do fechamento — mesmos campos da planilha de
 * hoje, só que com seletores em vez de digitação livre. Levantamento e
 * Fechamento aceitam mais de um corretor cada (é assim na vida real: já
 * teve negócio com 2 pessoas levantando e 2 fechando).
 */
export default function FechamentoForm({
  periodoId,
  tipo,
  corretores,
  onSalvo,
  onCancelar,
}: {
  periodoId: number;
  tipo: "venda" | "locacao";
  corretores: Corretor[];
  onSalvo: () => void;
  onCancelar: () => void;
}) {
  const [dataContrato, setDataContrato] = useState("");
  const [ref, setRef] = useState("");
  const [contrato, setContrato] = useState("");
  const [endereco, setEndereco] = useState("");
  const [origem, setOrigem] = useState("");
  const [pagamento, setPagamento] = useState("");
  const [comissao, setComissao] = useState(""); // venda
  const [valorLocacao, setValorLocacao] = useState(""); // locação
  const [observacao, setObservacao] = useState("");
  const [levantamento, setLevantamento] = useState<LinhaRateio[]>([{ corretor_id: "", percentual: "" }]);
  const [fechamento, setFechamento] = useState<LinhaRateio[]>([{ corretor_id: "", percentual: "" }]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const valorCalculado = tipo === "venda" && comissao ? Number(comissao) / TAXA_COMISSAO_VENDA : null;

  function atualizarLinha(
    lista: LinhaRateio[], set: (l: LinhaRateio[]) => void, i: number, campo: keyof LinhaRateio, valor: string
  ) {
    const copia = [...lista];
    copia[i] = { ...copia[i], [campo]: campo === "corretor_id" ? (valor ? Number(valor) : "") : valor };
    set(copia);
  }

  async function salvar() {
    setErro("");
    const rateio = [
      ...levantamento.filter((l) => l.corretor_id).map((l) => ({ ...l, papel: "levantamento" as const })),
      ...fechamento.filter((l) => l.corretor_id).map((l) => ({ ...l, papel: "fechamento" as const })),
    ];
    if (rateio.length === 0) {
      setErro("Informe pelo menos um corretor (Levantamento ou Fechamento).");
      return;
    }

    const valor = tipo === "venda" ? valorCalculado : (valorLocacao ? Number(valorLocacao) : null);
    setSalvando(true);
    try {
      const r = await fetch("/api/fechamento/negocios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodo_id: periodoId,
          data_contrato: dataContrato || null,
          ref: ref || null,
          contrato: contrato || null,
          endereco: endereco || null,
          origem: origem || null,
          valor,
          comissao: tipo === "venda" && comissao ? Number(comissao) : null,
          pagamento: tipo === "venda" ? (pagamento || null) : null,
          observacao: observacao || null,
          rateio: rateio.map((l) => ({
            corretor_id: l.corretor_id,
            papel: l.papel,
            percentual: l.percentual ? Number(l.percentual) / 100 : null,
          })),
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || "Erro ao salvar");
      }
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  const inputCls = "border-input bg-card w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";
  const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

  function BlocoRateio({ titulo, lista, set }: { titulo: string; lista: LinhaRateio[]; set: (l: LinhaRateio[]) => void }) {
    return (
      <div>
        <label className={labelCls}>{titulo}</label>
        <div className="space-y-1.5">
          {lista.map((linha, i) => (
            <div key={i} className="flex gap-1.5">
              <select
                value={linha.corretor_id}
                onChange={(e) => atualizarLinha(lista, set, i, "corretor_id", e.target.value)}
                className={inputCls}
              >
                <option value="">Corretor...</option>
                {corretores.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
              <input
                type="number" placeholder="%" min={0} max={100} step={1}
                value={linha.percentual}
                onChange={(e) => atualizarLinha(lista, set, i, "percentual", e.target.value)}
                className={inputCls + " w-20"}
              />
              {lista.length > 1 && (
                <button type="button" onClick={() => set(lista.filter((_, x) => x !== i))} className="text-muted-foreground hover:text-destructive px-1">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => set([...lista, { corretor_id: "", percentual: "" }])}
          className="mt-1.5 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
        >
          <Plus size={12} /> adicionar corretor
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700">Novo negócio</h4>
        <button onClick={onCancelar} className="text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className={labelCls}>Data Contrato</label>
          <input type="date" value={dataContrato} onChange={(e) => setDataContrato(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Ref</label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Contrato</label>
          <input value={contrato} onChange={(e) => setContrato(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Origem</label>
          <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={inputCls}>
            <option value="">Selecione...</option>
            {ORIGENS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="col-span-2 md:col-span-2">
          <label className={labelCls}>Endereço</label>
          <input value={endereco} onChange={(e) => setEndereco(e.target.value)} className={inputCls} />
        </div>

        {tipo === "venda" ? (
          <>
            <div>
              <label className={labelCls}>Comissão (R$)</label>
              <input type="number" step="0.01" value={comissao} onChange={(e) => setComissao(e.target.value)} className={inputCls} />
              {valorCalculado !== null && (
                <p className="mt-1 text-[11px] text-muted-foreground">Valor da venda: {fmtMoney(valorCalculado)} (÷6%)</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Pagamento</label>
              <select value={pagamento} onChange={(e) => setPagamento(e.target.value)} className={inputCls}>
                <option value="">Selecione...</option>
                {PAGAMENTOS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </>
        ) : (
          <div>
            <label className={labelCls}>Valor da Prestação de Serviço (R$)</label>
            <input type="number" step="0.01" value={valorLocacao} onChange={(e) => setValorLocacao(e.target.value)} className={inputCls} />
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <BlocoRateio titulo="Levantamento" lista={levantamento} set={setLevantamento} />
        <BlocoRateio titulo="Fechamento" lista={fechamento} set={setFechamento} />
      </div>

      <div className="mt-3">
        <label className={labelCls}>Observação</label>
        <input value={observacao} onChange={(e) => setObservacao(e.target.value)} className={inputCls} />
      </div>

      {erro && <p className="mt-3 text-xs text-red-600">{erro}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancelar} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          Cancelar
        </button>
        <button
          onClick={salvar}
          disabled={salvando}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {salvando ? "Salvando..." : "Salvar negócio"}
        </button>
      </div>
    </div>
  );
}
