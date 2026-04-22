/* ═══════════════════════════════════════════
   sheets.js — Google Sheets OAuth + Import
   Configurado para a planilha da Luzia
   Client ID: 346072433497-5vi6svae58kqpgi3i2t6hp04djim5pcr.apps.googleusercontent.com
═══════════════════════════════════════════ */

const Sheets = (() => {

  const CLIENT_ID = '346072433497-5vi6svae58kqpgi3i2t6hp04djim5pcr.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/spreadsheets.readonly';
  const REDIRECT_URI = window.location.origin;

  let _accessToken = null;
  let _importLog = [];

  // ── OAuth ─────────────────────────────────

  function getStoredToken() {
    const t = sessionStorage.getItem('gsheets_token');
    const exp = sessionStorage.getItem('gsheets_token_exp');
    if (t && exp && Date.now() < parseInt(exp)) return t;
    return null;
  }

  function storeToken(token, expiresIn) {
    sessionStorage.setItem('gsheets_token', token);
    sessionStorage.setItem('gsheets_token_exp', Date.now() + expiresIn * 1000);
    _accessToken = token;
  }

  function isAuthenticated() {
    _accessToken = getStoredToken();
    return !!_accessToken;
  }

  function startOAuth() {
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem('oauth_state', state);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'token',
      scope: SCOPES,
      state,
    });
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
  }

  function handleOAuthCallback() {
    const hash = window.location.hash.slice(1);
    if (!hash) return false;
    const params = new URLSearchParams(hash);
    const token = params.get('access_token');
    const expiresIn = params.get('expires_in');
    const state = params.get('state');
    if (!token) return false;
    if (state !== sessionStorage.getItem('oauth_state')) return false;
    storeToken(token, parseInt(expiresIn || 3600));
    history.replaceState(null, '', window.location.pathname);
    return true;
  }

  function logout() {
    sessionStorage.removeItem('gsheets_token');
    sessionStorage.removeItem('gsheets_token_exp');
    _accessToken = null;
  }

  // ── Sheets API ────────────────────────────

  async function apiGet(url) {
    const token = getStoredToken();
    if (!token) throw new Error('Não autenticado');
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function getSpreadsheetInfo(spreadsheetId) {
    return apiGet(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties.title`);
  }

  async function getSheetValues(spreadsheetId, range) {
    const enc = encodeURIComponent(range);
    const data = await apiGet(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${enc}`
    );
    return data.values || [];
  }

  function extractSpreadsheetId(url) {
    const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : null;
  }

  // ── Helpers ───────────────────────────────

  const MESES_PT = {
    'janeiro':0,'fevereiro':1,'março':2,'marco':2,'abril':3,'maio':4,'junho':5,
    'julho':6,'agosto':7,'setembro':8,'outubro':9,'novembro':10,'dezembro':11
  };

  function parseMesAba(nomeAba) {
    const parts = nomeAba.toLowerCase().trim().split(/\s+/);
    if (parts.length < 2) return null;
    const mes = MESES_PT[parts[0]];
    const ano = parseInt(parts[1]);
    if (mes === undefined || isNaN(ano)) return null;
    return { mes, ano };
  }

  function colIndex(letter) {
    let n = 0;
    for (const c of letter.toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64;
    return n - 1;
  }

  function cel(row, col) {
    const v = row ? row[colIndex(col)] : undefined;
    return v !== undefined && v !== null ? String(v).trim() : '';
  }

  function parseMoney(s) {
    if (!s) return 0;
    const cleaned = String(s).replace(/[R$\s]/g,'').replace(/\./g,'').replace(/,\s*/,'.').replace(',','.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : Math.abs(n);
  }

  function parseDate(s, mes, ano) {
    if (!s) return null;
    s = String(s).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) return `${ano}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    return null;
  }

  function mesAnoStr(m, y) {
    return `${String(m+1).padStart(2,'0')}-${y}`;
  }

  function log(msg) {
    _importLog.push(msg);
    console.log('[Sheets]', msg);
  }

  function findCatId(cats, nomecat) {
    if (!nomecat) return { catId: null, subcat: null };
    const limpar = s => s.replace(/[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|\uFE0F|\u200D/gu,'').toLowerCase().trim();
    const n = limpar(nomecat);
    let c = cats.find(c => limpar(c.nome) === n);
    if (c) return { catId: c.id, subcat: null };
    c = cats.find(c => n.includes(limpar(c.nome)) || limpar(c.nome).includes(n));
    if (c) return { catId: c.id, subcat: null };
    for (const cat of cats) {
      const sub = (cat.subcats||[]).find(s => {
        const sn = limpar(typeof s==='string'?s:s.nome);
        return sn===n||n.includes(sn)||sn.includes(n);
      });
      if (sub) return { catId: cat.id, subcat: typeof sub==='string'?sub:sub.nome };
    }
    return { catId: null, subcat: null };
  }

  // ── Parser das abas ───────────────────────
  //
  // PLANILHA DA LUZIA — 2 formatos:
  //
  // FORMATO L1 (Out/2025 a Fev/2026) — dados linha 26 (idx 25):
  //   GASTOS FIXOS:          B=nome, C=tipo, F=pago, G=categoria, H=valor
  //   ENTRADAS:              J=nome, L=categoria, M=data, N=valor
  //   DÉBITO:                P=nome, R=categoria, S=data, T=valor
  //   CRÉDITO CAIXA MASTER:  V=nome, W=data_venc, X=categoria, Y=data, Z=valor
  //   CRÉDITO CAIXA VISA:    AB=nome, AC=data_venc, AD=categoria, AE=data, AF=valor
  //   CRÉDITO MERCADO PAGO:  AH=nome, AI=data_venc, AJ=categoria, AK=data, AL=valor
  //
  // FORMATO L2 (Mar/2026+) — dados linha 25 (idx 24):
  //   ENTRADAS:              B=nome, D=categoria, E=data, G=valor
  //   GASTOS FIXOS:          I=nome, K=tipo, L=pago, M=categoria, O=valor
  //   DÉBITO:                Q=nome, R=categoria, S=data, U=valor
  //   CRÉDITO CAIXA MASTER:  W=nome, X=data_venc, Y=categoria, Z=data, AB=valor
  //   CRÉDITO CAIXA VISA:    AD=nome, AE=data_venc, AF=categoria, AG=data, AI=valor
  //   CRÉDITO MERCADO PAGO:  AK=nome, AL=data_venc, AM=categoria, AN=data, AP=valor

  async function parseAba(spreadsheetId, nomeAba, cats, cartoes) {
    const parsed = parseMesAba(nomeAba);
    if (!parsed) return null;
    const { mes, ano } = parsed;
    const ma = mesAnoStr(mes, ano);
    const lancamentos = [];

    // L2 = Março 2026 em diante; L1 = tudo antes
    const fmt = (ano > 2026 || (ano === 2026 && mes >= 2)) ? 'L2' : 'L1';

    let rows;
    try {
      const vals = await getSheetValues(spreadsheetId, `'${nomeAba}'!A1:AP200`);
      rows = vals;
    } catch(e) {
      log(`⚠️ Erro ao ler aba "${nomeAba}": ${e.message}`);
      return null;
    }

    // Encontrar cartões da Luzia
    const caixaMaster = cartoes.find(c => {
      const n = c.nome.toLowerCase();
      return (n.includes('caixa') && n.includes('master')) || (n.includes('master') && !n.includes('visa'));
    });
    const caixaVisa = cartoes.find(c => {
      const n = c.nome.toLowerCase();
      return (n.includes('caixa') && n.includes('visa')) || (n.includes('visa') && !n.includes('master'));
    });
    const mercadoPago = cartoes.find(c => {
      const n = c.nome.toLowerCase();
      return n.includes('mercado') || n.includes('mp');
    });

    const dataStart = fmt === 'L1' ? 25 : 24;

    for (let i = dataStart; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => !c)) continue;

      if (fmt === 'L1') {

        // GASTOS FIXOS
        const nomeF = cel(row,'B'), valorF = parseMoney(cel(row,'H'));
        if (nomeF && valorF > 0) {
          const {catId,subcat} = findCatId(cats, cel(row,'G'));
          const pago = ['true','sim'].includes(cel(row,'F').toLowerCase());
          const t = cel(row,'C').toLowerCase();
          const cId = t.includes('master') ? caixaMaster?.id : t.includes('visa') ? caixaVisa?.id : (t.includes('mercado')||t.includes('mp')) ? mercadoPago?.id : null;
          lancamentos.push({tipo:'fixo',descricao:nomeF,valor:valorF,categoriaId:catId,subcat,pago,pagamento:cId?String(cId):'debito',cartaoId:cId||null,mesAno:ma});
        }

        // ENTRADAS
        const nomeE = cel(row,'J'), valorE = parseMoney(cel(row,'N'));
        if (nomeE && valorE > 0) {
          const {catId,subcat} = findCatId(cats, cel(row,'L'));
          lancamentos.push({tipo:'entrada',descricao:nomeE,valor:valorE,categoriaId:catId,subcat,data:parseDate(cel(row,'M'),mes,ano),mesAno:ma});
        }

        // DÉBITO
        const nomeD = cel(row,'P'), valorD = parseMoney(cel(row,'T'));
        if (nomeD && valorD > 0) {
          const {catId,subcat} = findCatId(cats, cel(row,'R'));
          lancamentos.push({tipo:'debito',descricao:nomeD,valor:valorD,categoriaId:catId,subcat,data:parseDate(cel(row,'S'),mes,ano),mesAno:ma});
        }

        // CRÉDITO CAIXA MASTER
        const nomeCM = cel(row,'V'), valorCM = parseMoney(cel(row,'Z'));
        if (nomeCM && valorCM > 0 && caixaMaster) {
          const {catId,subcat} = findCatId(cats, cel(row,'X'));
          lancamentos.push({tipo:'credito',descricao:nomeCM,valorParcela:valorCM,valorTotal:valorCM,totalParcelas:1,parcela:1,categoriaId:catId,subcat,data:parseDate(cel(row,'Y'),mes,ano),cartaoId:caixaMaster.id,mesAno:ma});
        }

        // CRÉDITO CAIXA VISA
        const nomeCV = cel(row,'AB'), valorCV = parseMoney(cel(row,'AF'));
        if (nomeCV && valorCV > 0 && caixaVisa) {
          const {catId,subcat} = findCatId(cats, cel(row,'AD'));
          lancamentos.push({tipo:'credito',descricao:nomeCV,valorParcela:valorCV,valorTotal:valorCV,totalParcelas:1,parcela:1,categoriaId:catId,subcat,data:parseDate(cel(row,'AE'),mes,ano),cartaoId:caixaVisa.id,mesAno:ma});
        }

        // CRÉDITO MERCADO PAGO
        const nomeMPG = cel(row,'AH'), valorMPG = parseMoney(cel(row,'AL'));
        if (nomeMPG && valorMPG > 0 && mercadoPago) {
          const {catId,subcat} = findCatId(cats, cel(row,'AJ'));
          lancamentos.push({tipo:'credito',descricao:nomeMPG,valorParcela:valorMPG,valorTotal:valorMPG,totalParcelas:1,parcela:1,categoriaId:catId,subcat,data:parseDate(cel(row,'AK'),mes,ano),cartaoId:mercadoPago.id,mesAno:ma});
        }

      } else { // FORMATO L2

        // ENTRADAS
        const nomeE = cel(row,'B'), valorE = parseMoney(cel(row,'G'));
        if (nomeE && valorE > 0) {
          const {catId,subcat} = findCatId(cats, cel(row,'D'));
          lancamentos.push({tipo:'entrada',descricao:nomeE,valor:valorE,categoriaId:catId,subcat,data:parseDate(cel(row,'E'),mes,ano),mesAno:ma});
        }

        // GASTOS FIXOS
        const nomeF = cel(row,'I'), valorF = parseMoney(cel(row,'O'));
        if (nomeF && valorF > 0) {
          const {catId,subcat} = findCatId(cats, cel(row,'M'));
          const pago = ['true','sim'].includes(cel(row,'L').toLowerCase());
          const t = cel(row,'K').toLowerCase();
          const cId = t.includes('master') ? caixaMaster?.id : t.includes('visa') ? caixaVisa?.id : (t.includes('mercado')||t.includes('mp')) ? mercadoPago?.id : null;
          lancamentos.push({tipo:'fixo',descricao:nomeF,valor:valorF,categoriaId:catId,subcat,pago,pagamento:cId?String(cId):'debito',cartaoId:cId||null,mesAno:ma});
        }

        // DÉBITO
        const nomeD = cel(row,'Q'), valorD = parseMoney(cel(row,'U'));
        if (nomeD && valorD > 0) {
          const {catId,subcat} = findCatId(cats, cel(row,'R'));
          lancamentos.push({tipo:'debito',descricao:nomeD,valor:valorD,categoriaId:catId,subcat,data:parseDate(cel(row,'S'),mes,ano),mesAno:ma});
        }

        // CRÉDITO CAIXA MASTER
        const nomeCM = cel(row,'W'), valorCM = parseMoney(cel(row,'AB'));
        if (nomeCM && valorCM > 0 && caixaMaster) {
          const {catId,subcat} = findCatId(cats, cel(row,'Y'));
          lancamentos.push({tipo:'credito',descricao:nomeCM,valorParcela:valorCM,valorTotal:valorCM,totalParcelas:1,parcela:1,categoriaId:catId,subcat,data:parseDate(cel(row,'Z'),mes,ano),cartaoId:caixaMaster.id,mesAno:ma});
        }

        // CRÉDITO CAIXA VISA
        const nomeCV = cel(row,'AD'), valorCV = parseMoney(cel(row,'AI'));
        if (nomeCV && valorCV > 0 && caixaVisa) {
          const {catId,subcat} = findCatId(cats, cel(row,'AF'));
          lancamentos.push({tipo:'credito',descricao:nomeCV,valorParcela:valorCV,valorTotal:valorCV,totalParcelas:1,parcela:1,categoriaId:catId,subcat,data:parseDate(cel(row,'AG'),mes,ano),cartaoId:caixaVisa.id,mesAno:ma});
        }

        // CRÉDITO MERCADO PAGO
        const nomeMPG = cel(row,'AK'), valorMPG = parseMoney(cel(row,'AP'));
        if (nomeMPG && valorMPG > 0 && mercadoPago) {
          const {catId,subcat} = findCatId(cats, cel(row,'AM'));
          lancamentos.push({tipo:'credito',descricao:nomeMPG,valorParcela:valorMPG,valorTotal:valorMPG,totalParcelas:1,parcela:1,categoriaId:catId,subcat,data:parseDate(cel(row,'AN'),mes,ano),cartaoId:mercadoPago.id,mesAno:ma});
        }
      }
    }

    log(`  ✓ ${nomeAba} [Fmt ${fmt}]: ${lancamentos.length} lançamentos`);
    return { lancamentos, mesAno: ma };
  }

  // ── Importação principal ─────────────────

  async function importar(spreadsheetId, onProgress) {
    _importLog = [];
    const cats = await DB.getCategorias();
    const cartoes = await DB.getCartoes();

    log('Buscando informações da planilha...');
    onProgress({ step: 'info', msg: 'Conectando à planilha...' });

    const info = await getSpreadsheetInfo(spreadsheetId);
    const todasAbas = info.sheets.map(s => s.properties.title);
    log(`Planilha: "${info.properties.title}" — ${todasAbas.length} abas`);

    const abasMes = todasAbas.filter(a => parseMesAba(a) !== null);
    log(`Abas de meses encontradas: ${abasMes.length}`);
    onProgress({ step: 'info', msg: `${abasMes.length} meses encontrados`, abas: abasMes });

    let totalLancs = 0;

    for (let i = 0; i < abasMes.length; i++) {
      const aba = abasMes[i];
      onProgress({ step: 'parse', msg: `Importando ${aba}...`, progress: (i+1)/abasMes.length });

      const result = await parseAba(spreadsheetId, aba, cats, cartoes);
      if (!result) continue;

      for (const l of result.lancamentos) {
        l.criadoEm = Date.now();
        await DB.addLancamento(l);
        totalLancs++;
      }
    }

    log(`\n✅ Importação concluída: ${totalLancs} lançamentos em ${abasMes.length} meses`);
    onProgress({ step: 'done', msg: `${totalLancs} lançamentos importados!`, total: totalLancs, meses: abasMes.length });

    return { total: totalLancs, meses: abasMes.length, log: _importLog };
  }

  return {
    isAuthenticated, startOAuth, handleOAuthCallback, logout,
    extractSpreadsheetId, importar,
    get log() { return _importLog; }
  };
})();
