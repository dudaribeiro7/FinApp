/* ═══════════════════════════════════════════
   db.js — IndexedDB layer
   Stores: lancamentos, categorias, cartoes, config
═══════════════════════════════════════════ */

const DB = (() => {
  const NAME = 'financas_app';
  const VERSION = 1;
  let _db = null;

  async function open() {
    if (_db) return _db;
    return new Promise((res, rej) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;

        // lancamentos
        if (!db.objectStoreNames.contains('lancamentos')) {
          const s = db.createObjectStore('lancamentos', { keyPath: 'id', autoIncrement: true });
          s.createIndex('mesAno', 'mesAno');
          s.createIndex('tipo', 'tipo');
          s.createIndex('criadoEm', 'criadoEm');
        }

        // categorias
        if (!db.objectStoreNames.contains('categorias')) {
          db.createObjectStore('categorias', { keyPath: 'id', autoIncrement: true });
        }

        // cartoes
        if (!db.objectStoreNames.contains('cartoes')) {
          db.createObjectStore('cartoes', { keyPath: 'id', autoIncrement: true });
        }

        // config (key-value)
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror = e => rej(e.target.error);
    });
  }

  function tx(store, mode = 'readonly') {
    return _db.transaction(store, mode).objectStore(store);
  }

  function all(store) {
    return new Promise((res, rej) => {
      const req = tx(store).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  function get(store, key) {
    return new Promise((res, rej) => {
      const req = tx(store).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  function put(store, obj) {
    return new Promise((res, rej) => {
      const req = tx(store, 'readwrite').put(obj);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  function del(store, key) {
    return new Promise((res, rej) => {
      const req = tx(store, 'readwrite').delete(key);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
  }

  function byIndex(store, indexName, value) {
    return new Promise((res, rej) => {
      const req = tx(store).index(indexName).getAll(value);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function getConfig(key, def = null) {
    const r = await get('config', key);
    return r ? r.value : def;
  }

  async function setConfig(key, value) {
    await put('config', { key, value });
  }

  // ── Lancamentos ──────────────────────────

  async function getLancamentos(mesAno) {
    await open();
    return byIndex('lancamentos', 'mesAno', mesAno);
  }

  async function getAllLancamentos() {
    await open();
    return all('lancamentos');
  }

  async function addLancamento(obj) {
    await open();
    obj.criadoEm = Date.now();
    return put('lancamentos', obj);
  }

  async function updateLancamento(obj) {
    await open();
    return put('lancamentos', obj);
  }

  async function deleteLancamento(id) {
    await open();
    return del('lancamentos', id);
  }

  // ── Categorias ────────────────────────────

  async function getCategorias() {
    await open();
    return all('categorias');
  }

  async function saveCategoria(obj) {
    await open();
    return put('categorias', obj);
  }

  async function deleteCategoria(id) {
    await open();
    return del('categorias', id);
  }

  // ── Cartoes ───────────────────────────────

  async function getCartoes() {
    await open();
    return all('cartoes');
  }

  async function saveCartao(obj) {
    await open();
    return put('cartoes', obj);
  }

  async function deleteCartao(id) {
    await open();
    return del('cartoes', id);
  }

  // ── Config ────────────────────────────────

  async function getConfigAll() {
    await open();
    return all('config');
  }

  // ── Seed: dados padrão ───────────────────

  async function seedDefaults() {
    await open();
    const cats = await all('categorias');
    if (cats.length > 0) return; // já tem dados

    const defaultCats = [
      // saídas
      { tipo: 'saida', nome: 'Transporte', emoji: '🚗', cor: '#fb923c', subcats: ['Carro', 'Uber', 'Ônibus'] },
      { tipo: 'saida', nome: 'Alimentação', emoji: '🍽️', cor: '#4ade80', subcats: ['Supermercado', 'Restaurante'] },
      { tipo: 'saida', nome: 'Casa', emoji: '🏠', cor: '#60a5fa', subcats: ['Moradia'] },
      { tipo: 'saida', nome: 'Saúde e Bem-estar', emoji: '❤️', cor: '#f87171', subcats: ['Saúde', 'Beleza'] },
      { tipo: 'saida', nome: 'Entretenimento', emoji: '🎬', cor: '#a78bfa', subcats: ['Streaming', 'Lazer'] },
      { tipo: 'saida', nome: 'Educação', emoji: '📚', cor: '#fbbf24', subcats: ['Estudos'] },
      { tipo: 'saida', nome: 'Finanças', emoji: '💰', cor: '#34d399', subcats: ['Impostos e taxas', 'Cartão de crédito'] },
      { tipo: 'saida', nome: 'Compras', emoji: '🛍️', cor: '#f472b6', subcats: ['Roupas', 'Tech', 'Presentes'] },
      { tipo: 'saida', nome: 'Viagens', emoji: '✈️', cor: '#818cf8', subcats: [] },
      // entradas
      { tipo: 'entrada', nome: 'Trabalho', emoji: '💼', cor: '#4ade80', subcats: [] },
      { tipo: 'entrada', nome: 'Presentes', emoji: '🎁', cor: '#fbbf24', subcats: [] },
      { tipo: 'entrada', nome: 'Vendas', emoji: '🛒', cor: '#60a5fa', subcats: [] },
      { tipo: 'entrada', nome: 'Outros', emoji: '📦', cor: '#9ca3af', subcats: [] },
    ];

    for (const c of defaultCats) {
      await put('categorias', c);
    }

    const defaultCartoes = [
      { nome: 'Nubank', cor: '#a78bfa', fechamento: 4, vencimento: 10, limite: 3000 },
      { nome: 'Itaú', cor: '#fb923c', fechamento: 8, vencimento: 15, limite: 5000 },
      { nome: 'C6', cor: '#60a5fa', fechamento: 15, vencimento: 22, limite: 2000 },
    ];

    for (const c of defaultCartoes) {
      await put('cartoes', c);
    }

    // config padrão
    await put('config', { key: 'notif_cartao', value: true });
    await put('config', { key: 'notif_cartao_dias', value: 3 });
    await put('config', { key: 'notif_orcamento', value: true });
    await put('config', { key: 'notif_orcamento_pct', value: 80 });
    await put('config', { key: 'notif_resumo', value: true });
    await put('config', { key: 'notif_semdata', value: true });
    await put('config', { key: 'notif_fixos', value: true });
  }

  // ── Export / Import ───────────────────────

  async function exportAll() {
    await open();
    const [lancamentos, categorias, cartoes, config] = await Promise.all([
      all('lancamentos'), all('categorias'), all('cartoes'), all('config')
    ]);
    return JSON.stringify({ lancamentos, categorias, cartoes, config, exportedAt: new Date().toISOString() }, null, 2);
  }

  async function importAll(json) {
    await open();
    const data = JSON.parse(json);
    const stores = ['lancamentos', 'categorias', 'cartoes', 'config'];

    for (const store of stores) {
      if (!data[store]) continue;
      // clear store
      await new Promise((res, rej) => {
        const req = tx(store, 'readwrite').clear();
        req.onsuccess = res; req.onerror = rej;
      });
      for (const item of data[store]) {
        await put(store, item);
      }
    }
  }

  async function clearAll() {
    await open();
    const stores = ['lancamentos', 'categorias', 'cartoes', 'config'];
    for (const store of stores) {
      await new Promise((res, rej) => {
        const req = tx(store, 'readwrite').clear();
        req.onsuccess = res; req.onerror = rej;
      });
    }
  }

  return {
    open, seedDefaults,
    getLancamentos, getAllLancamentos, addLancamento, updateLancamento, deleteLancamento,
    getCategorias, saveCategoria, deleteCategoria,
    getCartoes, saveCartao, deleteCartao,
    getConfig, setConfig, getConfigAll,
    exportAll, importAll, clearAll,
  };
})();
