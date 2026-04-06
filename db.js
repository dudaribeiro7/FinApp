/* ═══════════════════════════════════════════
   db.js — IndexedDB layer v3
═══════════════════════════════════════════ */
const DB = (() => {
  const NAME = 'financas_app', VERSION = 3;
  let _db = null;

  async function open() {
    if (_db) return _db;
    return new Promise((res, rej) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('lancamentos')) {
          const s = db.createObjectStore('lancamentos', { keyPath: 'id', autoIncrement: true });
          s.createIndex('mesAno', 'mesAno');
          s.createIndex('tipo', 'tipo');
          s.createIndex('criadoEm', 'criadoEm');
          s.createIndex('templateId', 'templateId');
        } else {
          const s = e.target.transaction.objectStore('lancamentos');
          if (!s.indexNames.contains('templateId')) s.createIndex('templateId', 'templateId');
        }
        if (!db.objectStoreNames.contains('categorias')) db.createObjectStore('categorias', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('cartoes')) db.createObjectStore('cartoes', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('config')) db.createObjectStore('config', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('fixos_template')) db.createObjectStore('fixos_template', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror = e => rej(e.target.error);
    });
  }

  function tx(store, mode='readonly') { return _db.transaction(store, mode).objectStore(store); }
  function all(store) { return new Promise((res,rej) => { const r = tx(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  function get(store, key) { return new Promise((res,rej) => { const r = tx(store).get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  function put(store, obj) { return new Promise((res,rej) => { const r = tx(store,'readwrite').put(obj); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  function del(store, key) { return new Promise((res,rej) => { const r = tx(store,'readwrite').delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
  function byIndex(store, idx, val) { return new Promise((res,rej) => { const r = tx(store).index(idx).getAll(val); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }

  async function getConfig(key, def=null) { const r = await get('config', key); return r ? r.value : def; }
  async function setConfig(key, value) { await put('config', {key, value}); }

  async function getLancamentos(mesAno) { await open(); return byIndex('lancamentos','mesAno',mesAno); }
  async function getAllLancamentos() { await open(); return all('lancamentos'); }
  async function addLancamento(obj) { await open(); obj.criadoEm = Date.now(); return put('lancamentos', obj); }
  async function updateLancamento(obj) { await open(); return put('lancamentos', obj); }
  async function deleteLancamento(id) { await open(); return del('lancamentos', id); }
  async function getLancamentosByTemplateId(tid) { await open(); return byIndex('lancamentos','templateId',tid); }

  async function getFixosTemplates() { await open(); return all('fixos_template'); }
  async function saveFixoTemplate(obj) { await open(); return put('fixos_template', obj); }
  async function deleteFixoTemplate(id) { await open(); return del('fixos_template', id); }

  // Garante instâncias de gastos fixos E entradas fixas no mês
  // mesAnoMinimo: mês a partir do qual o template foi criado (não criar em meses anteriores)
  async function ensureFixosMes(mesAno, mesAnoAtual) {
    await open();
    const templates = await all('fixos_template');
    if (!templates.length) return;

    // Não criar lançamentos em meses anteriores ao mês atual real
    const hoje = mesAnoAtual || mesAno;
    if (mesAno < hoje) return; // mês passado — não replicar automaticamente

    const existentes = await byIndex('lancamentos','mesAno',mesAno);
    const existTemplIds = new Set(existentes.filter(l=>l.templateId).map(l=>l.templateId));
    const [mesStr, anoStr] = mesAno.split('-');
    const mes = parseInt(mesStr) - 1;
    const ano = parseInt(anoStr);

    for (const tmpl of templates) {
      if (existTemplIds.has(tmpl.id)) continue;
      // Só criar se o template foi criado antes ou no mesmo mês
      // (tmpl.criadoEm é timestamp; comparar com mesAno)
      if (tmpl.mesAnoMinimo && mesAno < tmpl.mesAnoMinimo) continue;

      if (tmpl.tipo === 'entrada_fixa') {
        const dia = tmpl.diaDoMes || 1;
        const dataStr = `${ano}-${String(mes+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
        await put('lancamentos', {
          tipo: 'entrada',
          templateId: tmpl.id,
          categoriaId: tmpl.categoriaId,
          subcat: tmpl.subcat,
          descricao: tmpl.descricao,
          valor: tmpl.valor,
          data: dataStr,
          fixo: true,
          mesAno,
          criadoEm: Date.now(),
        });
      } else {
        await put('lancamentos', {
          tipo: 'fixo',
          templateId: tmpl.id,
          categoriaId: tmpl.categoriaId,
          subcat: tmpl.subcat,
          descricao: tmpl.descricao,
          valor: tmpl.valor,
          pagamento: tmpl.pagamento,
          cartaoId: tmpl.cartaoId,
          pago: false,
          mesAno,
          criadoEm: Date.now(),
        });
      }
    }
  }

  async function getCategorias() { await open(); return all('categorias'); }
  async function saveCategoria(obj) { await open(); return put('categorias', obj); }
  async function deleteCategoria(id) { await open(); return del('categorias', id); }

  async function getCartoes() { await open(); return all('cartoes'); }
  async function saveCartao(obj) { await open(); return put('cartoes', obj); }
  async function deleteCartao(id) { await open(); return del('cartoes', id); }

  async function seedDefaults() {
    await open();
    const cats = await all('categorias');
    if (cats.length > 0) return;
    const dc = [
      {tipo:'saida',nome:'Transporte',emoji:'🛣',cor:'#76bb40',subcats:[
        {nome:'Carro',emoji:'🚗',cor:'#669d34'},{nome:'Uber',emoji:'🚕',cor:'#000000'},
        {nome:'99',emoji:'🚕',cor:'#f5ec00'},{nome:'Ônibus',emoji:'🚌',cor:'#b51a00'},
        {nome:'Metrô',emoji:'🚈',cor:'#a78bfa'},{nome:'Avião',emoji:'🛫',cor:'#52d6fc'}]},
      {tipo:'saida',nome:'Alimentação',emoji:'🍽️',cor:'#d87400',subcats:[
        {nome:'Supermercado',emoji:'🛒',cor:'#aaffaa'},{nome:'Restaurante',emoji:'🍝',cor:'#834b00'},
        {nome:'iFood',emoji:'🍟',cor:'#e22400'},{nome:'Padaria',emoji:'🥖',cor:'#eaf28f'}]},
      {tipo:'saida',nome:'Moradia',emoji:'🏡',cor:'#ff4747',subcats:[
        {nome:'Aluguel',emoji:'🏠',cor:'#f87171'},{nome:'Condomínio',emoji:'🏢',cor:'#ffb0b0'},
        {nome:'Luz',emoji:'💡',cor:'#ffff0c'},{nome:'Água',emoji:'🚿',cor:'#0ea5e9'},
        {nome:'Internet',emoji:'🛜',cor:'#0d4bff'},{nome:'Reparos',emoji:'🛠',cor:'#d19d01'}]},
      {tipo:'saida',nome:'Saúde',emoji:'🧬',cor:'#01c7fc',subcats:[
        {nome:'Medicamentos',emoji:'💊',cor:'#ef4444'},{nome:'Academia',emoji:'🏋',cor:'#c1005e'},
        {nome:'Plano de Saúde',emoji:'🩺',cor:'#0042a9'}]},
      {tipo:'saida',nome:'Entretenimento',emoji:'🪩',cor:'#a78bfa',subcats:[
        {nome:'Streaming',emoji:'🎬',cor:'#8b5cf6'},{nome:'Lazer',emoji:'🎉',cor:'#f472b6'}]},
      {tipo:'saida',nome:'Finanças',emoji:'💵',cor:'#a97000',subcats:[
        {nome:'Impostos e taxas',emoji:'💰',cor:'#6b5200'},{nome:'Cartão de crédito',emoji:'💳',cor:'#c2c2c2'}]},
      {tipo:'saida',nome:'Compras',emoji:'🛍️',cor:'#f472b6',subcats:[
        {nome:'Roupas',emoji:'👗',cor:'#ec4899'},{nome:'Tech',emoji:'💻',cor:'#0ea5e9'},
        {nome:'Presentes',emoji:'🎁',cor:'#7c6af7'},{nome:'Beleza',emoji:'💄',cor:'#ff93f7'}]},
      {tipo:'saida',nome:'Viagens',emoji:'✈️',cor:'#38571a',subcats:[
        {nome:'Ônibus',emoji:'🚍',cor:'#99244f'},{nome:'Airbnb',emoji:'🏘',cor:'#e63b7a'},
        {nome:'Hotel',emoji:'🏨',cor:'#74a7ff'},{nome:'Ingressos',emoji:'🎟',cor:'#fbbf24'},
        {nome:'Souvenir',emoji:'⚜️',cor:'#fb923c'}]},
      {tipo:'entrada',nome:'Trabalho',emoji:'💼',cor:'#cde8b5',subcats:[]},
      {tipo:'entrada',nome:'Presentes',emoji:'🎁',cor:'#efcaff',subcats:[]},
      {tipo:'entrada',nome:'Vendas',emoji:'🛒',cor:'#fffbb9',subcats:[]},
      {tipo:'entrada',nome:'Outros',emoji:'📦',cor:'#9ca3af',subcats:[]},
    ];
    for (const c of dc) await put('categorias', c);
    const dca = [
      {nome:'Nubank',cor:'#a78bfa',fechamento:4,vencimento:10,limite:3000},
      {nome:'Itaú',cor:'#fb923c',fechamento:8,vencimento:15,limite:5000},
      {nome:'C6',cor:'#60a5fa',fechamento:15,vencimento:22,limite:2000},
    ];
    for (const c of dca) await put('cartoes', c);
    const cfgs = [
      ['notif_cartao',true],['notif_cartao_dias',3],['notif_orcamento',true],
      ['notif_orcamento_pct',80],['notif_resumo',true],['notif_semdata',true],['notif_fixos',true]
    ];
    for (const [k,v] of cfgs) await put('config', {key:k, value:v});
  }

  async function exportAll() {
    await open();
    const [lancamentos,categorias,cartoes,config,fixos_template] = await Promise.all([
      all('lancamentos'),all('categorias'),all('cartoes'),all('config'),all('fixos_template')
    ]);
    return JSON.stringify({lancamentos,categorias,cartoes,config,fixos_template,exportedAt:new Date().toISOString()},null,2);
  }

  async function importAll(json) {
    await open();
    const data = JSON.parse(json);
    for (const store of ['lancamentos','categorias','cartoes','config','fixos_template']) {
      if (!data[store]) continue;
      await new Promise((res,rej) => { const r=tx(store,'readwrite').clear(); r.onsuccess=res; r.onerror=rej; });
      for (const item of data[store]) await put(store, item);
    }
  }

  async function clearAll() {
    await open();
    for (const store of ['lancamentos','categorias','cartoes','config','fixos_template']) {
      await new Promise((res,rej) => { const r=tx(store,'readwrite').clear(); r.onsuccess=res; r.onerror=rej; });
    }
  }

  return {
    open, seedDefaults,
    getLancamentos, getAllLancamentos, addLancamento, updateLancamento, deleteLancamento,
    getLancamentosByTemplateId,
    getFixosTemplates, saveFixoTemplate, deleteFixoTemplate, ensureFixosMes,
    getCategorias, saveCategoria, deleteCategoria,
    getCartoes, saveCartao, deleteCartao,
    getConfig, setConfig,
    exportAll, importAll, clearAll,
  };
})();
