-- BI Imobiliária Maciel - Schema
-- Tabelas otimizadas para o dashboard, extraídas do KSI

-- Corretores/Usuários
CREATE TABLE IF NOT EXISTS corretores (
  id INTEGER PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  nome_comercial VARCHAR(200),
  email VARCHAR(60),
  celular VARCHAR(15),
  departamento_id INTEGER,
  funcao INTEGER,
  ativo SMALLINT DEFAULT 1,
  empresa SMALLINT DEFAULT 0,
  data_admissao DATE,
  data_demissao DATE
);

-- Clientes
CREATE TABLE IF NOT EXISTS clientes (
  id BIGINT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(60),
  celular VARCHAR(20),
  telefone VARCHAR(20),
  cidade VARCHAR(255),
  estado VARCHAR(255),
  bairro VARCHAR(255),
  sexo SMALLINT DEFAULT 0,
  data_cadastro TIMESTAMP
);

-- Imóveis
CREATE TABLE IF NOT EXISTS imoveis (
  id INTEGER PRIMARY KEY,
  codigo VARCHAR(240),
  titulo VARCHAR(255),
  tipo_mae VARCHAR(40),
  tipo_imovel VARCHAR(200),
  locacao_venda VARCHAR(3),
  endereco VARCHAR(250),
  bairro VARCHAR(240),
  cidade VARCHAR(255),
  estado VARCHAR(255),
  dormitorios INTEGER DEFAULT 0,
  suites INTEGER DEFAULT 0,
  banheiros SMALLINT DEFAULT 0,
  area_util DECIMAL(20,2) DEFAULT 0,
  area_total DECIMAL(20,2) DEFAULT 0,
  valor DECIMAL(18,2) DEFAULT 0,
  valor_locacao DECIMAL(18,2) DEFAULT 0,
  edificio_id INTEGER,
  data_cadastro TIMESTAMP
);

-- Leads / Ordens de Atendimento
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  corretor_id INTEGER REFERENCES corretores(id),
  cliente_id INTEGER,
  empresa_id SMALLINT,
  locacao_venda VARCHAR(1),
  origem VARCHAR(200),
  origem_fonte VARCHAR(150),
  temperatura_id INTEGER,
  tipo_imovel TEXT,
  bairros TEXT,
  cidades TEXT,
  dormitorios INTEGER DEFAULT 0,
  valor_aluguel INTEGER DEFAULT 0,
  valor_venda INTEGER DEFAULT 0,
  data_inicio TIMESTAMP NOT NULL,
  data_fim TIMESTAMP,
  status VARCHAR(20) DEFAULT 'aberto',
  observacoes TEXT
);

-- Atividades dos Leads (follow-up)
CREATE TABLE IF NOT EXISTS lead_atividades (
  id BIGINT PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id),
  corretor_id INTEGER REFERENCES corretores(id),
  descricao TEXT,
  temperatura_id INTEGER,
  data TIMESTAMP NOT NULL,
  tempo_retorno INTEGER DEFAULT 0
);

-- Propostas
CREATE TABLE IF NOT EXISTS propostas (
  id INTEGER PRIMARY KEY,
  imovel_id INTEGER REFERENCES imoveis(id),
  cliente_id INTEGER,
  corretor_id INTEGER REFERENCES corretores(id),
  lead_id INTEGER,
  locacao_venda VARCHAR(2),
  valor_pedido DECIMAL(18,2) DEFAULT 0,
  valor_proposto DECIMAL(18,2) DEFAULT 0,
  data TIMESTAMP NOT NULL
);

-- Conversões (Vendas/Locações fechadas)
CREATE TABLE IF NOT EXISTS conversoes (
  id INTEGER PRIMARY KEY,
  imovel_id INTEGER DEFAULT 0,
  midia_id INTEGER,
  locacao_venda VARCHAR(1),
  valor DECIMAL(15,2) DEFAULT 0,
  taxa DECIMAL(10,2) DEFAULT 0,
  data_inicio DATE,
  data_assinatura DATE,
  data_efetivacao DATE,
  finalidade VARCHAR(20)
);

-- Corretores por conversão
CREATE TABLE IF NOT EXISTS conversao_corretores (
  id INTEGER PRIMARY KEY,
  conversao_id INTEGER REFERENCES conversoes(id),
  corretor_id INTEGER REFERENCES corretores(id),
  percentual DECIMAL(10,4) DEFAULT 0
);

-- Visitas de imóveis no site
CREATE TABLE IF NOT EXISTS imovel_visitas (
  id INTEGER PRIMARY KEY,
  imovel_id INTEGER,
  data TIMESTAMP NOT NULL
);

-- Canais de mídia
CREATE TABLE IF NOT EXISTS midias (
  id INTEGER PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  ativo BOOLEAN DEFAULT true
);

-- Temperaturas
CREATE TABLE IF NOT EXISTS temperaturas (
  id INTEGER PRIMARY KEY,
  nome VARCHAR(200),
  cor VARCHAR(20),
  ordem INTEGER
);

-- UTM dos leads
CREATE TABLE IF NOT EXISTS lead_utms (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id),
  utm_source VARCHAR(220),
  utm_medium VARCHAR(220),
  utm_campaign VARCHAR(220),
  utm_term VARCHAR(250),
  utm_content VARCHAR(250),
  data TIMESTAMP
);

-- Pré-atendimentos
CREATE TABLE IF NOT EXISTS pre_atendimentos (
  id INTEGER PRIMARY KEY,
  origem_id INTEGER,
  finalidade_id INTEGER,
  corretor_destino_id INTEGER,
  cliente_id INTEGER,
  lead_id INTEGER,
  descricao TEXT,
  data TIMESTAMP,
  pendente BOOLEAN DEFAULT false
);

-- Edifícios / Empreendimentos
CREATE TABLE IF NOT EXISTS empreendimentos (
  id INTEGER PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  endereco VARCHAR(255),
  bairro VARCHAR(255),
  cidade VARCHAR(255),
  estado VARCHAR(2),
  tipo INTEGER,
  lancamento BOOLEAN DEFAULT false,
  status_id INTEGER,
  valor_condominio INTEGER DEFAULT 0
);

-- === META ADS ===

CREATE TABLE IF NOT EXISTS meta_campanhas (
  id VARCHAR(50) PRIMARY KEY,
  nome VARCHAR(500) NOT NULL,
  status VARCHAR(20),
  objetivo VARCHAR(100),
  budget_diario DECIMAL(12,2) DEFAULT 0,
  budget_total DECIMAL(12,2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meta_conjuntos (
  id VARCHAR(50) PRIMARY KEY,
  campanha_id VARCHAR(50) REFERENCES meta_campanhas(id),
  nome VARCHAR(500) NOT NULL,
  status VARCHAR(20),
  budget_diario DECIMAL(12,2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meta_insights_diarios (
  id SERIAL PRIMARY KEY,
  campanha_id VARCHAR(50),
  conjunto_id VARCHAR(50),
  data DATE NOT NULL,
  impressoes INTEGER DEFAULT 0,
  cliques INTEGER DEFAULT 0,
  gasto DECIMAL(12,2) DEFAULT 0,
  cpc DECIMAL(10,4) DEFAULT 0,
  cpm DECIMAL(10,4) DEFAULT 0,
  ctr DECIMAL(10,4) DEFAULT 0,
  alcance INTEGER DEFAULT 0,
  leads INTEGER DEFAULT 0,
  conversas_iniciadas INTEGER DEFAULT 0,
  link_clicks INTEGER DEFAULT 0,
  video_views INTEGER DEFAULT 0,
  UNIQUE(campanha_id, conjunto_id, data)
);

-- === METAS ===

CREATE TABLE IF NOT EXISTS metas (
  id SERIAL PRIMARY KEY,
  mes DATE NOT NULL,
  leads_meta INTEGER DEFAULT 0,
  visitas_meta INTEGER DEFAULT 0,
  propostas_meta INTEGER DEFAULT 0,
  vendas_meta INTEGER DEFAULT 0,
  locacoes_meta INTEGER DEFAULT 0,
  receita_meta DECIMAL(15,2) DEFAULT 0,
  budget_meta DECIMAL(12,2) DEFAULT 0,
  cpl_meta DECIMAL(10,2) DEFAULT 0,
  UNIQUE(mes)
);

-- === CONTROLE DE IMPORTAÇÃO ===

CREATE TABLE IF NOT EXISTS importacoes (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(20) NOT NULL,
  arquivo VARCHAR(500),
  registros INTEGER DEFAULT 0,
  data TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'ok'
);

-- === ÍNDICES ===

CREATE INDEX IF NOT EXISTS idx_leads_data ON leads(data_inicio);
CREATE INDEX IF NOT EXISTS idx_leads_corretor ON leads(corretor_id);
CREATE INDEX IF NOT EXISTS idx_leads_origem ON leads(origem_fonte);
CREATE INDEX IF NOT EXISTS idx_atividades_data ON lead_atividades(data);
CREATE INDEX IF NOT EXISTS idx_atividades_lead ON lead_atividades(lead_id);
CREATE INDEX IF NOT EXISTS idx_propostas_data ON propostas(data);
CREATE INDEX IF NOT EXISTS idx_conversoes_data ON conversoes(data_assinatura);
CREATE INDEX IF NOT EXISTS idx_visitas_data ON imovel_visitas(data);
CREATE INDEX IF NOT EXISTS idx_visitas_imovel ON imovel_visitas(imovel_id);
CREATE INDEX IF NOT EXISTS idx_meta_insights_data ON meta_insights_diarios(data);
CREATE INDEX IF NOT EXISTS idx_meta_insights_campanha ON meta_insights_diarios(campanha_id);
CREATE INDEX IF NOT EXISTS idx_pre_atend_data ON pre_atendimentos(data);
