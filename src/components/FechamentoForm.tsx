"use client";
import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { fmtMoney } from "@/lib/format";
import { PERMITE_NOME_LIVRE_NO_RATEIO } from "@/lib/flags";

type Corretor = { id: number; nome: string };
// `texto` é o que está escrito no campo; `corretor_id` só é preenchido quando
// o texto casa com um corretor da lista. São separados porque enquanto a
// pessoa digita ("Dani...") ainda não existe corretor escolhido — com um
// campo só, o que ela digitou sumiria a cada tecla.
type LinhaRateio = { corretor_id: number | ""; percentual: string; texto: string };

const inputCls = "border-input bg-card w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

const ORIGENS = [
  "Cliente de Carteira", "Plantão de Vendas", "Canal Pro", "Indicação", "Site",
  "Placa", "OLX", "ZAP", "VivaReal", "ImovelWeb", "Fachada da Imobiliária",
  "V4", "Facebook", "Instagram", "Panfletos", "Status/Story",
];
const PAGAMENTOS = ["Financiamento", "A Vista", "Fgts", "Consórcio", "Parcelado"];
const TAXA_COMISSAO_VENDA = 0.06;

/**
 * Fora do componente de propósito: declarado dentro, o React trata como um
 * tipo novo a cada render e remonta os campos a cada tecla — o cursor saía do
 * campo de corretor e o que tinha sido digitado se perdia.
 *
 * Campo com busca em vez de select porque a lista tem ~78 corretores de todas
 * as unidades; num select nativo só dá pra pular pela primeira letra.
 */
function BlocoRateio({
  titulo, lista, set, corretores, atualizarLinha,
}: {
  titulo: string;
  lista: LinhaRateio[];
  set: (l: LinhaRateio[]) => void;
  corretores: Corretor[];
  atualizarLinha: (
    lista: LinhaRateio[], set: (l: LinhaRateio[]) => void, i: number, campos: Partial<LinhaRateio>
  ) => void;
}) {
  return (
    <div>
      <label className={labelCls}>{titulo}</label>
      <div className="space-y-1.5">
        {lista.map((linha, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              list="corretores-rateio"
              placeholder="Corretor..."
              value={linha.texto}
              onChange={(e) => {
                const texto = e.target.value;
                const achado = corretores.find((c) => c.nome === texto);
                atualizarLinha(lista, set, i, { texto, corretor_id: achado ? achado.id : "" });
              }}
              className={inputCls + (linha.texto && !linha.corretor_id ? " border-amber-400" : "")}
              title={
                linha.texto && !linha.corretor_id
                  ? PERMITE_NOME_LIVRE_NO_RATEIO
                    ? "Não está no Kurole — será gravado como nome digitado. Se a pessoa existe lá, confira a grafia."
                    : "Escolha um nome da lista"
                  : undefined
              }
            />
            {/* A borda âmbar continua aparecendo mesmo com o nome digitado
                valendo: ela deixou de significar "erro" e passou a significar
                "este não veio do Kurole". É o aviso que faz alguém perceber
                que digitou "Fabiana Olivera" quando a Fabiana existe. */}
            <input
              type="number" placeholder="%" min={0} max={100} step={1}
              value={linha.percentual}
              onChange={(e) => atualizarLinha(lista, set, i, { percentual: e.target.value })}
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
        onClick={() => set([...lista, { corretor_id: "", percentual: "", texto: "" }])}
        className="mt-1.5 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
      >
        <Plus size={12} /> adicionar corretor
      </button>
    </div>
  );
}

/**
 * Formulário de "novo negócio" do fechamento — mesmos campos da planilha de
 * hoje, só que com seletores em vez de digitação livre. Levantamento e
 * Fechamento aceitam mais de um corretor cada (é assim na vida real: já
 * teve negócio com 2 pessoas levantando e 2 fechando).
 *
 * Exceção enquanto `PERMITE_NOME_LIVRE_NO_RATEIO` estiver ligada: o rateio
 * aceita nome digitado, para os fechamentos antigos cujos corretores já não
 * existem no Kurole. A busca pela referência não muda — ela continua trazendo
 * o captador do cadastro; digitar é só a saída pra quem o Kurole não conhece.
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
  const [levantamento, setLevantamento] = useState<LinhaRateio[]>([{ corretor_id: "", percentual: "", texto: "" }]);
  const [fechamento, setFechamento] = useState<LinhaRateio[]>([{ corretor_id: "", percentual: "", texto: "" }]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const valorCalculado = tipo === "venda" && comissao ? Number(comissao) / TAXA_COMISSAO_VENDA : null;

  /**
   * A referência é a chave do imóvel no Kurole, então dá pra puxar endereço e
   * captador em vez de digitar de novo — menos trabalho e menos erro de
   * digitação. Só preenche o que está vazio: se a pessoa já escreveu alguma
   * coisa, o que ela escreveu manda.
   */
  async function buscarImovel() {
    if (!ref.trim()) return;
    setAviso("");
    try {
      const r = await fetch(`/api/fechamento/imovel?ref=${encodeURIComponent(ref)}&tipo=${tipo}`);
      if (r.status === 404) {
        setAviso(`Nenhum imóvel com a referência ${ref} — confira o número ou preencha na mão.`);
        return;
      }
      if (!r.ok) return;
      const dados = await r.json();

      if (dados.endereco && !endereco.trim()) setEndereco(dados.endereco);

      // Também conta como preenchido o que foi só DIGITADO. Olhando apenas
      // corretor_id, um nome digitado (que não tem id) parecia campo vazio e
      // a busca pela referência sobrescrevia o que a pessoa acabou de
      // escrever — exatamente o contrário da regra "o que ela escreveu manda".
      const semCaptador = levantamento.every((l) => !l.corretor_id && !l.texto.trim());
      if (dados.captadores?.length && semCaptador) {
        setLevantamento(
          dados.captadores.map((c: { corretor_id: number; nome: string; percentual: number | null }) => ({
            corretor_id: c.corretor_id,
            texto: c.nome,
            percentual: c.percentual != null ? String(c.percentual) : "",
          }))
        );
      }
      if (dados.captadores_fora > 0 && !dados.captadores?.length) {
        setAviso("O captador deste imóvel não está na lista de rateio — escolha na mão.");
      }
    } catch {
      // Busca é conveniência: falhou, a pessoa preenche na mão.
    }
  }

  function atualizarLinha(
    lista: LinhaRateio[], set: (l: LinhaRateio[]) => void, i: number, campos: Partial<LinhaRateio>
  ) {
    const copia = [...lista];
    copia[i] = { ...copia[i], ...campos };
    set(copia);
  }

  async function salvar() {
    setErro("");
    // Linha vale se aponta pra um corretor da lista ou — enquanto a carga
    // retroativa estiver acontecendo — se tem um nome digitado. Antes, nome
    // fora da lista era DESCARTADO em silêncio aqui: o negócio salvava sem
    // aquele destinatário e ninguém era avisado.
    const usavel = (l: LinhaRateio) =>
      Boolean(l.corretor_id) || (PERMITE_NOME_LIVRE_NO_RATEIO && l.texto.trim() !== "");
    const rateio = [
      ...levantamento.filter(usavel).map((l) => ({ ...l, papel: "levantamento" as const })),
      ...fechamento.filter(usavel).map((l) => ({ ...l, papel: "fechamento" as const })),
    ];
    if (rateio.length === 0) {
      setErro(
        PERMITE_NOME_LIVRE_NO_RATEIO
          ? "Informe pelo menos um corretor (Levantamento ou Fechamento) — da lista ou digitando o nome."
          : "Informe pelo menos um corretor (Levantamento ou Fechamento)."
      );
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
            corretor_id: l.corretor_id || null,
            // Só vai nome digitado quando não houve casamento com a lista —
            // corretor do Kurole é sempre preferível, porque liga a comissão
            // a um cadastro de verdade.
            nome_livre: l.corretor_id ? null : l.texto.trim(),
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

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <datalist id="corretores-rateio">
        {corretores.map((c) => <option key={c.id} value={c.nome} />)}
      </datalist>
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
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onBlur={buscarImovel}
            placeholder="ex: 58298"
            className={inputCls}
          />
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
        <BlocoRateio titulo="Levantamento" lista={levantamento} set={setLevantamento} corretores={corretores} atualizarLinha={atualizarLinha} />
        <BlocoRateio titulo="Fechamento" lista={fechamento} set={setFechamento} corretores={corretores} atualizarLinha={atualizarLinha} />
      </div>

      <div className="mt-3">
        <label className={labelCls}>Observação</label>
        <input value={observacao} onChange={(e) => setObservacao(e.target.value)} className={inputCls} />
      </div>

      {aviso && <p className="mt-3 text-xs text-amber-700">{aviso}</p>}
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
