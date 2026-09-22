"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { fmtMoney } from "@/lib/format";
import { PERMITE_NOME_LIVRE_NO_RATEIO } from "@/lib/flags";
import { REGRAS, resumoRateio, pctTexto, temBlocoLancamento, type Tipo } from "@/lib/comissao";

type Corretor = { id: number; nome: string };
// `texto` é o que está escrito no campo; `corretor_id` só é preenchido quando
// o texto casa com um corretor da lista. São separados porque enquanto a
// pessoa digita ("Dani...") ainda não existe corretor escolhido — com um
// campo só, o que ela digitou sumiria a cada tecla.
type LinhaRateio = { corretor_id: number | ""; percentual: string; texto: string };

const inputCls = "border-input bg-card w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

/** "30" (o que está no campo) -> 0.30. Campo vazio não conta no rateio. */
const pctNum = (s: string): number | null => (s.trim() === "" ? null : Number(s) / 100);

const temDestinatario = (l: LinhaRateio) => Boolean(l.corretor_id) || l.texto.trim() !== "";

/**
 * Divide o percentual do bloco entre as linhas que já têm destinatário.
 *
 * O percentual é da FUNÇÃO: a Maciel paga 30% pelo fechamento, então dois
 * fechadores ficam com 15% cada. Precisa rodar também ao ADICIONAR ou REMOVER
 * uma linha — sem isso o primeiro corretor continuava com os 30% cheios e o
 * negócio distribuía 60%.
 *
 * `totalDoBloco` nulo é o bloco de percentual MANUAL (Lançamento): aí nada é
 * redistribuído, porque o número que a adm digitou é o que vale.
 */
function redistribuir(lista: LinhaRateio[], totalDoBloco: number | null): LinhaRateio[] {
  if (totalDoBloco == null) return lista;
  const quantos = lista.filter(temDestinatario).length;
  if (quantos === 0) return lista;
  const cada = String(Number(((totalDoBloco / quantos) * 100).toFixed(4)));
  return lista.map((l) => (temDestinatario(l) ? { ...l, percentual: cada } : l));
}

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
  titulo, ajuda, lista, set, corretores, atualizarLinha, totalDoBloco,
}: {
  titulo: string;
  ajuda?: string;
  lista: LinhaRateio[];
  set: (l: LinhaRateio[]) => void;
  corretores: Corretor[];
  atualizarLinha: (
    lista: LinhaRateio[], set: (l: LinhaRateio[]) => void, i: number, campos: Partial<LinhaRateio>
  ) => void;
  /**
   * Percentual da comissão que este bloco paga no total, a dividir entre as
   * linhas — ou `null` quando o percentual é digitado caso a caso.
   */
  totalDoBloco: number | null;
}) {
  return (
    <div>
      <label className={labelCls}>
        {titulo}
        {ajuda && <span className="ml-1.5 font-normal text-muted-foreground/70">{ajuda}</span>}
      </label>
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
                const copia = [...lista];
                copia[i] = { ...copia[i], texto, corretor_id: achado ? achado.id : "" };
                // Divide o percentual do bloco entre quem já tem nome. Entrar
                // ou sair alguém muda a fatia de todos, não só a da linha nova.
                set(redistribuir(copia, totalDoBloco));
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
              type="number" placeholder="%" min={0} max={100} step="0.01"
              value={linha.percentual}
              onChange={(e) => atualizarLinha(lista, set, i, { percentual: e.target.value })}
              className={inputCls + " w-20"}
            />
            {lista.length > 1 && (
              <button
                type="button"
                onClick={() => set(redistribuir(lista.filter((_, x) => x !== i), totalDoBloco))}
                className="text-muted-foreground hover:text-destructive px-1"
              >
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
        <Plus size={12} /> adicionar
      </button>
    </div>
  );
}

/**
 * Formulário de "novo negócio" do fechamento — mesmos campos da planilha de
 * hoje, só que com seletores em vez de digitação livre. Todos os blocos
 * aceitam mais de uma pessoa (é assim na vida real: já teve negócio com 2
 * pessoas levantando e 2 fechando).
 *
 * Levantamento, Fechamento e Gerência dividem um percentual de tabela entre
 * as linhas. Lançamento não: o diretor de lançamento muda conforme o perfil
 * do produto e o percentual muda com ele, então ali se digita.
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
  gerente,
  onSalvo,
  onCancelar,
}: {
  periodoId: number;
  tipo: Tipo;
  corretores: Corretor[];
  /** Gerente da unidade/vertical — entra sozinho no bloco Gerência. */
  gerente?: Corretor | null;
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
  const [gerencia, setGerencia] = useState<LinhaRateio[]>([{ corretor_id: "", percentual: "", texto: "" }]);
  // Lançamento: começa VAZIO porque a maioria das vendas não tem lançamento
  // envolvido, e quando tem o diretor muda de produto pra produto — não há um
  // nome nem um percentual que sirvam de padrão.
  const [lancamento, setLancamento] = useState<LinhaRateio[]>([{ corretor_id: "", percentual: "", texto: "" }]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const valorCalculado = tipo === "venda" && comissao ? Number(comissao) / TAXA_COMISSAO_VENDA : null;
  const regra = REGRAS[tipo];

  /** Comissão da venda, ou a prestação de serviço da locação — é sobre isso
   *  que todos os percentuais incidem. */
  const pool = tipo === "venda" ? Number(comissao || 0) : Number(valorLocacao || 0);

  // O gerente da unidade entra sozinho com os 10%. Só enquanto a adm não
  // mexeu: se ela trocou o nome ou o percentual, o que ela fez manda.
  useEffect(() => {
    if (!gerente) return;
    setGerencia((atual) =>
      atual.length === 1 && !atual[0].corretor_id && !atual[0].texto
        ? [{ corretor_id: gerente.id, texto: gerente.nome, percentual: String(regra.gerencia * 100) }]
        : atual
    );
  }, [gerente, regra.gerencia]);

  const mostraLancamento = temBlocoLancamento(tipo);

  const linhasParaResumo = [
    ...levantamento.map((l) => ({ papel: "levantamento", percentual: pctNum(l.percentual) })),
    ...fechamento.map((l) => ({ papel: "fechamento", percentual: pctNum(l.percentual) })),
    ...gerencia.map((l) => ({ papel: "gerencia", percentual: pctNum(l.percentual) })),
    ...lancamento.map((l) => ({ papel: "lancamento", percentual: pctNum(l.percentual) })),
    ...regra.rubricas.map((r) => ({ papel: r.papel, percentual: r.percentual })),
  ];
  const resumo = resumoRateio(pool, linhasParaResumo);

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
        // A Maciel paga 10% da comissão pela captação INTEIRA. O percentual
        // que vem do Kurole é a divisão entre os captadores (0,5 e 0,5 quando
        // são dois), não a fatia da comissão — então ele multiplica os 10%,
        // dando 5% pra cada. Antes o número do Kurole entrava cru e virava
        // "50% da comissão" pra cada captador.
        const n = dados.captadores.length;
        setLevantamento(
          dados.captadores.map((c: { corretor_id: number; nome: string; percentual: number | null }) => {
            // O Kurole grava o rateio do captador em 0–100 ("50" para meio a
            // meio, "100" para captador único), não em fração. Tratando como
            // fração, um captador sozinho virava 1000% da comissão.
            const fatia = c.percentual != null && c.percentual > 0 ? c.percentual / 100 : 1 / n;
            return {
              corretor_id: c.corretor_id,
              texto: c.nome,
              percentual: String(Number((regra.levantamento * fatia * 100).toFixed(4))),
            };
          })
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
    const doLancamento = mostraLancamento ? lancamento.filter(usavel) : [];
    const rateio = [
      ...levantamento.filter(usavel).map((l) => ({ ...l, papel: "levantamento" as const })),
      ...fechamento.filter(usavel).map((l) => ({ ...l, papel: "fechamento" as const })),
      ...gerencia.filter(usavel).map((l) => ({ ...l, papel: "gerencia" as const })),
      ...doLancamento.map((l) => ({ ...l, papel: "lancamento" as const })),
    ];
    // Em Lançamento o percentual é digitado, e digitado é esquecido: sem esta
    // trava o nome seria gravado com percentual nulo, apareceria como "—" nas
    // comissões e a pessoa simplesmente não receberia — sem erro nenhum.
    if (doLancamento.some((l) => l.percentual.trim() === "")) {
      setErro("Informe o percentual de cada pessoa em Lançamento — ele não tem valor padrão.");
      return;
    }
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
          rateio: [
            ...rateio.map((l) => ({
              corretor_id: l.corretor_id || null,
              // Só vai nome digitado quando não houve casamento com a lista —
              // corretor do Kurole é sempre preferível, porque liga a comissão
              // a um cadastro de verdade.
              nome_livre: l.corretor_id ? null : l.texto.trim(),
              papel: l.papel,
              percentual: l.percentual ? Number(l.percentual) / 100 : null,
            })),
            // Rubricas não têm pessoa: o destinatário é o próprio rótulo, e
            // entram em todo negócio.
            ...regra.rubricas.map((r) => ({
              corretor_id: null,
              nome_livre: r.rotulo,
              papel: r.papel,
              percentual: r.percentual,
            })),
          ],
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

      <div className={
        "mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 " +
        (mostraLancamento ? "xl:grid-cols-4" : "xl:grid-cols-3")
      }>
        <BlocoRateio
          titulo="Levantamento" ajuda={`${pctTexto(regra.levantamento)} no total`}
          lista={levantamento} set={setLevantamento} corretores={corretores}
          atualizarLinha={atualizarLinha}
          totalDoBloco={regra.levantamento}
        />
        <BlocoRateio
          titulo="Fechamento" ajuda={pctTexto(regra.fechamento)}
          lista={fechamento} set={setFechamento} corretores={corretores}
          atualizarLinha={atualizarLinha}
          totalDoBloco={regra.fechamento}
        />
        <BlocoRateio
          titulo="Gerência" ajuda={pctTexto(regra.gerencia)}
          lista={gerencia} set={setGerencia} corretores={corretores}
          atualizarLinha={atualizarLinha}
          totalDoBloco={regra.gerencia}
        />
        {/* Lançamento é o único bloco de percentual MANUAL: o diretor de
            lançamento muda conforme o perfil do produto, e o percentual muda
            com ele. Por isso não há sugestão nem divisão automática. */}
        {mostraLancamento && (
          <BlocoRateio
            titulo="Lançamento" ajuda="% manual"
            lista={lancamento} set={setLancamento} corretores={corretores}
            atualizarLinha={atualizarLinha}
            totalDoBloco={null}
          />
        )}
      </div>

      {/* Rubricas: destinação sem pessoa, presente em todo negócio — aqui só
          como informação, porque não há nada a escolher. */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={labelCls + " mb-0"}>Destinações fixas</span>
          {regra.rubricas.map((r) => (
            <span key={r.papel} className="text-xs text-gray-600">
              {r.rotulo} <strong className="tabular-nums">{pctTexto(r.percentual)}</strong>
            </span>
          ))}
        </div>
      </div>

      {/* O resultado enquanto se digita: passar de 100% é erro, e é melhor
          ver antes de salvar do que descobrir na tela de comissões. */}
      {pool > 0 && (
        <div className={
          "mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs " +
          (resumo.estourou ? "border-red-300 bg-red-50 text-red-800" : "border-gray-200 bg-white text-gray-600")
        }>
          <span>
            Distribuído <strong className="tabular-nums">{pctTexto(resumo.percentualDistribuido)}</strong>
            {" — "}{fmtMoney(resumo.valorDistribuido)}
          </span>
          <span>
            Fica com a imobiliária{" "}
            <strong className="tabular-nums">{pctTexto(resumo.percentualImobiliaria)}</strong>
            {" — "}{fmtMoney(resumo.valorImobiliaria)}
          </span>
          {resumo.estourou && <span className="font-medium">O rateio passou de 100% da comissão.</span>}
        </div>
      )}

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
