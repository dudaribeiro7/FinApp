/* ═══════════════════════════════════════════
   sheets.js — Google Sheets OAuth + Import
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
    // Limpar hash da URL
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

  // ── Extrai ID da URL do Google Sheets ─────

  function extractSpreadsheetId(url) {
    const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : null;
  }

  // ── Helpers de parsing ────────────────────

  const MESES_PT = {
    'janeiro':0,'fevereiro':1,'março':2,'marco':2,'abril':3,'maio':4,'junho':5,
    'julho':6,'agosto':7,'setembro':8,'outubro':9,'novembro':10,'dezembro':11
  };

  function parseMesAba(nomeAba) {
    // "Abril 2026" → {mes:3, ano:2026}
    const parts = nomeAba.toLowerCase().trim().split(/\s+/);
    if (parts.length < 2) return null;
    const mes = MESES_PT[parts[0]];
    const ano = parseInt(parts[1]);
    if (mes === undefined || isNaN(ano)) return null;
    return { mes, ano };
  }

  function colIndex(letter) {
    // 'A'→0, 'B'→1, ... 'Z'→25, 'AA'→26 ...
    let n = 0;
    for (const c of letter.toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64;
    return n - 1;
  }

  function cel(row, col) {
    // row é array, col é letra como 'A', 'B', 'AA' etc
    const v = row ? row[colIndex(col)] : undefined;
    return v !== undefined && v !== null ? String(v).trim() : '';
  }

  function parseMoney(s) {
    if (!s) return 0;
    // Remove R$, espaços, pontos de milhar, troca vírgula por ponto
    const n = parseFloat(
      String(s).replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.')
    );
    return isNaN(n) ? 0 : Math.abs(n);
  }

  function parseDate(s, mes, ano) {
    if (!s) return null;
    s = String(s).trim();
    // Tenta "DD/MM/YYYY"
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    // Tenta "DD/MM" → usa ano/mes do contexto
    m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) return `${ano}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    // Número serial do Excel (dias desde 30/12/1899)
    const num = parseFloat(s);
    if (!isNaN(num) && num > 1000) {
      const d = new Date(Math.round((num - 25569) * 86400 * 1000));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    }
    return null;
  }

  function mesAnoStr(m, y) {
    return `${String(m+1).padStart(2,'0')}-${y}`;
  }

  function log(msg) {
    _importLog.push(msg);
    console.log('[Sheets]', msg);
  }

  // ── Encontra categoria pelo nome ──────────

  function findCatId(cats, nomecat) {
    if (!nomecat) return null;
    const n = nomecat.toLowerCase().trim();
    // Busca exata
    let c = cats.find(c => c.nome.toLowerCase() === n);
    if (c) return { catId: c.id, subcat: null };
    // Busca parcial
    c = cats.find(c => n.includes(c.nome.toLowerCase()) || c.nome.toLowerCase().includes(n));
    if (c) return { catId: c.id, subcat: null };
    // Busca em subcategorias
    for (const cat of cats) {
      const sub = (cat.subcats || []).find(s => {
        const sn = (typeof s === 'string' ? s : s.nome).toLowerCase();
        return sn === n || n.includes(sn) || sn.includes(n);
      });
      if (sub) return { catId: cat.id, subcat: typeof sub === 'string' ? sub : sub.nome };
    }
    return { catId: null, subcat: null };
  }

  // ── Parser das abas ───────────────────────

  async function parseAba(spreadsheetId, nomeAba, cats, cartoes) {
    const { mes, ano } = parseMesAba(nomeAba);
    const ma = mesAnoStr(mes, ano);
    const lancamentos = [];

    // Determinar formato da aba
    // Formato A: Março 2025
    // Formato B: Abril 2025 – Março 2026
    // Formato C: Abril 2026+
    let fmt;
    if (ano < 2025 || (ano === 2025 && mes === 2)) fmt = 'A';
    else if (ano < 2026 || (ano === 2026 && mes <= 2)) fmt = 'B';
    else fmt = 'C';

    // Buscar todas as células da aba (máximo razoável de linhas)
    let rows;
    try {
      const range = `'${nomeAba}'!A1:AK80`;
      const vals = await getSheetValues(spreadsheetId, range);
      rows = vals;
    } catch(e) {
      log(`⚠️ Erro ao ler aba "${nomeAba}": ${e.message}`);
      return [];
    }

    // Determinar linha do cabeçalho/dados
    let dataStart;
    if (fmt === 'A') dataStart = 17; // linha 18 (0-indexed: 17)
    else if (fmt === 'B') {
      // linha 17 (Abril-Agosto 2025) ou linha 22 (Outubro 2025-Março 2026)
      dataStart = (ano === 2025 && mes <= 7) ? 17 : 22;
    } else {
      dataStart = 22; // linha 23
    }

    // Saldo inicial: célula F2
    const saldoCell = rows[1] ? cel(rows[1], 'F') : '';
    const saldoIni = parseMoney(saldoCell);
    if (saldoIni > 0) {
      log(`  💰 Saldo inicial de ${nomeAba}: R$${saldoIni}`);
    }

    const nuCartao = cartoes.find(c => c.nome.toLowerCase().includes('nubank') || c.nome.toLowerCase().includes('nu'));
    const itauCartao = cartoes.find(c => c.nome.toLowerCase().includes('ita'));
    const c6Cartao = cartoes.find(c => c.nome.toLowerCase().includes('c6'));

    // Processar linhas de dados
    for (let i = dataStart; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => !c)) continue;

      if (fmt === 'A') {
        // Gastos fixos: B=nome, C=pago, D=cat, E=valor
        const nomeF = cel(row, 'B');
        const valorF = parseMoney(cel(row, 'E'));
        if (nomeF && valorF > 0) {
          const { catId, subcat } = findCatId(cats, cel(row, 'D'));
          const pago = String(cel(row, 'C')).toLowerCase().includes('sim') || cel(row, 'C') === 'TRUE';
          lancamentos.push({ tipo:'fixo', descricao:nomeF, valor:valorF, categoriaId:catId, subcat, pago, pagamento:'debito', mesAno:ma });
        }
        // Entradas: G=nome, I=cat, J=data, K=valor
        const nomeE = cel(row, 'G');
        const valorE = parseMoney(cel(row, 'K'));
        if (nomeE && valorE > 0) {
          const { catId, subcat } = findCatId(cats, cel(row, 'I'));
          lancamentos.push({ tipo:'entrada', descricao:nomeE, valor:valorE, categoriaId:catId, subcat, data:parseDate(cel(row,'J'),mes,ano), mesAno:ma });
        }
        // Débito: M=nome, O=cat, P=data, Q=valor
        const nomeD = cel(row, 'M');
        const valorD = parseMoney(cel(row, 'Q'));
        if (nomeD && valorD > 0) {
          const { catId, subcat } = findCatId(cats, cel(row, 'O'));
          lancamentos.push({ tipo:'debito', descricao:nomeD, valor:valorD, categoriaId:catId, subcat, data:parseDate(cel(row,'P'),mes,ano), mesAno:ma });
        }
        // Crédito Nu: S=nome, T=parcela, U=cat, V=data, W=valor
        const nomeCN = cel(row, 'S');
        const valorCN = parseMoney(cel(row, 'W'));
        if (nomeCN && valorCN > 0 && nuCartao) {
          const { catId, subcat } = findCatId(cats, cel(row, 'U'));
          const parcelaStr = cel(row, 'T');
          const [p, total] = parcelaStr.includes('/') ? parcelaStr.split('/').map(Number) : [1, 1];
          lancamentos.push({ tipo:'credito', descricao:nomeCN, valorParcela:valorCN, valorTotal:valorCN*(total||1), totalParcelas:total||1, parcela:p||1, categoriaId:catId, subcat, data:parseDate(cel(row,'V'),mes,ano), cartaoId:nuCartao.id, mesAno:ma });
        }
      }

      else if (fmt === 'B') {
        // Gastos fixos: B=nome, C=tipo, D=pago, E=cat, F=valor
        const nomeF = cel(row, 'B');
        const valorF = parseMoney(cel(row, 'F'));
        if (nomeF && valorF > 0) {
          const { catId, subcat } = findCatId(cats, cel(row, 'E'));
          const pago = String(cel(row, 'D')).toLowerCase().includes('sim') || cel(row, 'D') === 'TRUE';
          const tipoFixo = cel(row, 'C').toLowerCase();
          const cartaoFixo = tipoFixo.includes('nubank') || tipoFixo.includes('nu') ? nuCartao?.id
                           : tipoFixo.includes('ita') ? itauCartao?.id
                           : tipoFixo.includes('c6') ? c6Cartao?.id : null;
          lancamentos.push({ tipo:'fixo', descricao:nomeF, valor:valorF, categoriaId:catId, subcat, pago, pagamento:cartaoFixo?String(cartaoFixo):'debito', cartaoId:cartaoFixo||null, mesAno:ma });
        }
        // Entradas: H=nome, J=cat, K=data, L=valor
        const nomeE = cel(row, 'H');
        const valorE = parseMoney(cel(row, 'L'));
        if (nomeE && valorE > 0) {
          const { catId, subcat } = findCatId(cats, cel(row, 'J'));
          lancamentos.push({ tipo:'entrada', descricao:nomeE, valor:valorE, categoriaId:catId, subcat, data:parseDate(cel(row,'K'),mes,ano), mesAno:ma });
        }
        // Débito: N=nome, P=cat, Q=data, R=valor
        const nomeD = cel(row, 'N');
        const valorD = parseMoney(cel(row, 'R'));
        if (nomeD && valorD > 0) {
          const { catId, subcat } = findCatId(cats, cel(row, 'P'));
          lancamentos.push({ tipo:'debito', descricao:nomeD, valor:valorD, categoriaId:catId, subcat, data:parseDate(cel(row,'Q'),mes,ano), mesAno:ma });
        }
        // Crédito Nu: T=nome, U=parcela, V=cat, W=data, X=valor
        const nomeCN = cel(row, 'T');
        const valorCN = parseMoney(cel(row, 'X'));
        if (nomeCN && valorCN > 0 && nuCartao) {
          const { catId, subcat } = findCatId(cats, cel(row, 'V'));
          const ps = cel(row, 'U'); const [p,t] = ps.includes('/')?ps.split('/').map(Number):[1,1];
          lancamentos.push({ tipo:'credito', descricao:nomeCN, valorParcela:valorCN, valorTotal:valorCN*(t||1), totalParcelas:t||1, parcela:p||1, categoriaId:catId, subcat, data:parseDate(cel(row,'W'),mes,ano), cartaoId:nuCartao.id, mesAno:ma });
        }
        // Crédito Itaú: Z=nome, AA=parcela, AB=cat, AC=data, AD=valor
        const nomeCI = cel(row, 'Z');
        const valorCI = parseMoney(cel(row, 'AD'));
        if (nomeCI && valorCI > 0 && itauCartao) {
          const { catId, subcat } = findCatId(cats, cel(row, 'AB'));
          const ps = cel(row, 'AA'); const [p,t] = ps.includes('/')?ps.split('/').map(Number):[1,1];
          lancamentos.push({ tipo:'credito', descricao:nomeCI, valorParcela:valorCI, valorTotal:valorCI*(t||1), totalParcelas:t||1, parcela:p||1, categoriaId:catId, subcat, data:parseDate(cel(row,'AC'),mes,ano), cartaoId:itauCartao.id, mesAno:ma });
        }
        // Crédito C6: AF=nome, AG=parcela, AH=cat, AI=data, AJ=valor
        const nomeCC = cel(row, 'AF');
        const valorCC = parseMoney(cel(row, 'AJ'));
        if (nomeCC && valorCC > 0 && c6Cartao) {
          const { catId, subcat } = findCatId(cats, cel(row, 'AH'));
          const ps = cel(row, 'AG'); const [p,t] = ps.includes('/')?ps.split('/').map(Number):[1,1];
          lancamentos.push({ tipo:'credito', descricao:nomeCC, valorParcela:valorCC, valorTotal:valorCC*(t||1), totalParcelas:t||1, parcela:p||1, categoriaId:catId, subcat, data:parseDate(cel(row,'AI'),mes,ano), cartaoId:c6Cartao.id, mesAno:ma });
        }
      }

      else { // Formato C
        // Entradas: B=nome, D=cat, E=data, F=valor
        const nomeE = cel(row, 'B');
        const valorE = parseMoney(cel(row, 'F'));
        if (nomeE && valorE > 0) {
          const { catId, subcat } = findCatId(cats, cel(row, 'D'));
          lancamentos.push({ tipo:'entrada', descricao:nomeE, valor:valorE, categoriaId:catId, subcat, data:parseDate(cel(row,'E'),mes,ano), mesAno:ma });
        }
        // Gastos fixos: H=nome, J=tipo, K=pago, L=cat, N=valor
        const nomeF = cel(row, 'H');
        const valorF = parseMoney(cel(row, 'N'));
        if (nomeF && valorF > 0) {
          const { catId, subcat } = findCatId(cats, cel(row, 'L'));
          const pago = String(cel(row, 'K')).toLowerCase().includes('sim') || cel(row, 'K') === 'TRUE';
          const tipoFixo = cel(row, 'J').toLowerCase();
          const cartaoFixo = tipoFixo.includes('nubank') || tipoFixo.includes('nu') ? nuCartao?.id
                           : tipoFixo.includes('ita') ? itauCartao?.id
                           : tipoFixo.includes('c6') ? c6Cartao?.id : null;
          lancamentos.push({ tipo:'fixo', descricao:nomeF, valor:valorF, categoriaId:catId, subcat, pago, pagamento:cartaoFixo?String(cartaoFixo):'debito', cartaoId:cartaoFixo||null, mesAno:ma });
        }
        // Débito: P=nome, Q=cat, R=data, S=valor
        const nomeD = cel(row, 'P');
        const valorD = parseMoney(cel(row, 'S'));
        if (nomeD && valorD > 0) {
          const { catId, subcat } = findCatId(cats, cel(row, 'Q'));
          lancamentos.push({ tipo:'debito', descricao:nomeD, valor:valorD, categoriaId:catId, subcat, data:parseDate(cel(row,'R'),mes,ano), mesAno:ma });
        }
        // Crédito Nu: U=nome, V=parcela, W=cat, X=data, Y=valor
        const nomeCN = cel(row, 'U');
        const valorCN = parseMoney(cel(row, 'Y'));
        if (nomeCN && valorCN > 0 && nuCartao) {
          const { catId, subcat } = findCatId(cats, cel(row, 'W'));
          const ps = cel(row, 'V'); const [p,t] = ps.includes('/')?ps.split('/').map(Number):[1,1];
          lancamentos.push({ tipo:'credito', descricao:nomeCN, valorParcela:valorCN, valorTotal:valorCN*(t||1), totalParcelas:t||1, parcela:p||1, categoriaId:catId, subcat, data:parseDate(cel(row,'X'),mes,ano), cartaoId:nuCartao.id, mesAno:ma });
        }
        // Crédito Itaú: AA=nome, AB=parcela, AC=cat, AD=data, AE=valor
        const nomeCI = cel(row, 'AA');
        const valorCI = parseMoney(cel(row, 'AE'));
        if (nomeCI && valorCI > 0 && itauCartao) {
          const { catId, subcat } = findCatId(cats, cel(row, 'AC'));
          const ps = cel(row, 'AB'); const [p,t] = ps.includes('/')?ps.split('/').map(Number):[1,1];
          lancamentos.push({ tipo:'credito', descricao:nomeCI, valorParcela:valorCI, valorTotal:valorCI*(t||1), totalParcelas:t||1, parcela:p||1, categoriaId:catId, subcat, data:parseDate(cel(row,'AD'),mes,ano), cartaoId:itauCartao.id, mesAno:ma });
        }
        // Crédito C6: AG=nome, AH=parcela, AI=cat, AJ=data, AK=valor
        const nomeCC = cel(row, 'AG');
        const valorCC = parseMoney(cel(row, 'AK'));
        if (nomeCC && valorCC > 0 && c6Cartao) {
          const { catId, subcat } = findCatId(cats, cel(row, 'AI'));
          const ps = cel(row, 'AH'); const [p,t] = ps.includes('/')?ps.split('/').map(Number):[1,1];
          lancamentos.push({ tipo:'credito', descricao:nomeCC, valorParcela:valorCC, valorTotal:valorCC*(t||1), totalParcelas:t||1, parcela:p||1, categoriaId:catId, subcat, data:parseDate(cel(row,'AJ'),mes,ano), cartaoId:c6Cartao.id, mesAno:ma });
        }
      }
    }

    log(`  ✓ ${nomeAba} [Fmt ${fmt}]: ${lancamentos.length} lançamentos`);
    return { lancamentos, saldoIni, mesAno: ma };
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

    // Filtrar apenas abas de meses válidos
    const abasMes = todasAbas.filter(a => parseMesAba(a) !== null);
    log(`Abas de meses encontradas: ${abasMes.length}`);
    onProgress({ step: 'info', msg: `${abasMes.length} meses encontrados`, abas: abasMes });

    let totalLancs = 0;
    const saldos = {};

    for (let i = 0; i < abasMes.length; i++) {
      const aba = abasMes[i];
      onProgress({ step: 'parse', msg: `Importando ${aba}...`, progress: (i+1)/abasMes.length });

      const result = await parseAba(spreadsheetId, aba, cats, cartoes);
      if (!result) continue;

      const { lancamentos, saldoIni, mesAno } = result;

      // Salvar saldo inicial se disponível
      if (saldoIni > 0) saldos[mesAno] = saldoIni;

      // Salvar lançamentos no IndexedDB
      for (const l of lancamentos) {
        l.criadoEm = Date.now();
        await DB.addLancamento(l);
        totalLancs++;
      }
    }

    // Salvar saldos iniciais
    for (const [ma, val] of Object.entries(saldos)) {
      localStorage.setItem('saldo_ini_' + ma, val);
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
