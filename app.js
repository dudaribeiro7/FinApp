/* ═══════════════════════════════════════════
   app.js — Finanças PWA v3
═══════════════════════════════════════════ */
const App = (() => {

  const state = {
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear(),
    currentScreen: 'screen-home',
    prevScreen: null,
    tipoLanc: 'entrada',
    lancTab: 'todos',
    lancSubTab: null,
    lancCatFilter: [],
    relTab: 'mensal',
    relPeriodo: 6,
    cfgTab: 'categorias',
    editingId: null,
    cartaoFiltro: null,
    lancamentos: [],
    categorias: [],
    cartoes: [],
  };

  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  /* ── Utilitários ─────────────────────── */
  function mesAnoStr(m, y) { return `${String(m+1).padStart(2,'0')}-${y}`; }
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function fmtMoney(v) {
    if (v === undefined || v === null || isNaN(v)) return 'R$\u00a00,00';
    const neg = v < 0;
    return (neg?'-':'') + 'R$\u00a0' + Math.abs(v).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function parseMoneyInput(s) {
    if (!s) return 0;
    return parseFloat(s.replace(/\./g,'').replace(',','.')) || 0;
  }
  function maskMoney(el) {
    let v = el.value.replace(/\D/g,'');
    if (!v) { el.value = ''; return; }
    v = v.slice(0,10);
    const parts = (parseInt(v,10)/100).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,'.');
    el.value = parts[0]+','+parts[1];
  }
  // Data confirmada = data <= hoje
  function isDateConfirmed(dateStr) {
    if (!dateStr) return false;
    // Comparar apenas as datas (ignorar hora) para evitar problemas de timezone
    const hoje = todayStr(); // YYYY-MM-DD
    return dateStr <= hoje;
  }
  function getCatById(id) { return state.categorias.find(c=>c.id===id); }

  // Ícone do banco via Google Favicon API
  const BANCO_DOMINIOS = {
    'nubank':'nubank.com.br','itaú':'itau.com.br','itau':'itau.com.br',
    'bradesco':'bradesco.com.br','santander':'santander.com.br',
    'caixa':'caixa.gov.br','bb':'bb.com.br','banco do brasil':'bb.com.br',
    'c6':'c6bank.com.br','c6 bank':'c6bank.com.br','inter':'bancointer.com.br',
    'xp':'xpi.com.br','picpay':'picpay.com','mercado pago':'mercadopago.com.br',
    'next':'next.me','original':'original.com.br','pagbank':'pagbank.com.br',
    'sicoob':'sicoob.com.br','sicredi':'sicredi.com.br','neon':'neon.com.br',
    'will bank':'willbank.com.br','will':'willbank.com.br',
  };
  function getBancoIconUrl(nome) {
    const key = nome.toLowerCase().trim();
    for (const [k, domain] of Object.entries(BANCO_DOMINIOS)) {
      if (key.includes(k)) return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    }
    return null;
  }
  function getBancoIconHtml(nome, size=28) {
    const url = getBancoIconUrl(nome);
    if (!url) return '';
    return `<img src="${url}" width="${size}" height="${size}" style="border-radius:${size/4}px;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">`;
  }
  function getCartaoById(id) { return state.cartoes.find(c=>c.id===id); }
  function getCatEmoji(l) {
    const cat = getCatById(l.categoriaId);
    if (!cat) return l.tipo==='entrada'||l.fixo ? '💰' : '💸';
    if (l.subcat && cat.subcats) {
      const sub = cat.subcats.find(s=>(typeof s==='string'?s:s.nome)===l.subcat);
      if (sub && typeof sub==='object' && sub.emoji) return sub.emoji;
    }
    return cat.emoji || '💸';
  }
  function getCatCor(l) {
    // fixo (gasto) = cinza
    if (l.tipo==='fixo') return '#888899';
    // entrada fixa = verde
    if (l.fixo) return 'var(--green)';
    const cat = getCatById(l.categoriaId);
    if (!cat) return 'var(--red)';
    if (l.subcat && cat.subcats) {
      const sub = cat.subcats.find(s=>(typeof s==='string'?s:s.nome)===l.subcat);
      if (sub && typeof sub==='object' && sub.cor) return sub.cor;
    }
    return cat.cor || 'var(--red)';
  }

  /* ── Toast ───────────────────────────── */
  let toastTimer;
  function toast(msg, type='ok', dur=2200) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>el.classList.remove('show'), dur);
  }

  /* ── Navegação ───────────────────────── */
  function gotoScreen(id, save=true) {
    if (save && state.currentScreen !== id) state.prevScreen = state.currentScreen;
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    state.currentScreen = id;
    const navMap = {'screen-home':'nav-home','screen-lancamentos':'nav-lancamentos','screen-relatorios':'nav-relatorios','screen-perfil':'nav-perfil'};
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    if (navMap[id]) document.getElementById(navMap[id])?.classList.add('active');
    if (id==='screen-home') renderHome();
    if (id==='screen-lancamentos') renderLancamentos();
    if (id==='screen-relatorios') renderRelatorios();
    if (id==='screen-perfil') renderPerfil();
  }
  function goBack() { gotoScreen(state.prevScreen || 'screen-home'); }
  function novoLancamento() {
    state.editingId = null;
    state.cartaoFiltro = null;
    gotoScreen('screen-novo');
    setTipoLanc('entrada');
  }

  /* ── Dados ───────────────────────────── */
  async function loadData() {
    [state.categorias, state.cartoes] = await Promise.all([DB.getCategorias(), DB.getCartoes()]);
    await DB.ensureFixosMes(mesAnoStr(state.currentMonth, state.currentYear), mesAnoStr(new Date().getMonth(), new Date().getFullYear()));
    state.lancamentos = await DB.getLancamentos(mesAnoStr(state.currentMonth, state.currentYear));
  }

  async function changeMonth(dir) {
    state.currentMonth += dir;
    if (state.currentMonth<0) { state.currentMonth=11; state.currentYear--; }
    if (state.currentMonth>11) { state.currentMonth=0; state.currentYear++; }
    await DB.ensureFixosMes(mesAnoStr(state.currentMonth, state.currentYear), mesAnoStr(new Date().getMonth(), new Date().getFullYear()));
    state.lancamentos = await DB.getLancamentos(mesAnoStr(state.currentMonth, state.currentYear));
    const label = `${MONTHS[state.currentMonth]} ${state.currentYear}`;
    ['home-month-label','lanc-month-label'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=label;});
    if (state.currentScreen==='screen-home') renderHome();
    if (state.currentScreen==='screen-lancamentos') renderLancamentos();
    if (state.currentScreen==='screen-relatorios') renderRelatorios();
  }

  /* ── Cálculos de saldo ───────────────── */
  async function getSaldoFinalMes(m, y) {
    // Para uso nos relatórios de evolução
    return getSaldoFinalMesFechado(m, y, null);
  }

  async function getSaldoInicialMes(m, y) {
    // Verificar se há valor salvo manualmente
    const saved = localStorage.getItem('saldo_ini_'+mesAnoStr(m,y));
    if (saved !== null) return parseFloat(saved);
    // Saldo inicial = saldo final do mês anterior (usando lançamentos confirmados até o último dia daquele mês)
    const prevM = m===0?11:m-1;
    const prevY = m===0?y-1:y;
    const allLancs = await DB.getAllLancamentos();
    const hasPrev = allLancs.some(l=>l.mesAno===mesAnoStr(prevM,prevY));
    if (!hasPrev) return 0;
    return getSaldoFinalMesFechado(prevM, prevY, allLancs);
  }

  // Calcula saldo final de um mês considerando APENAS lançamentos efetivados
  // Para meses passados: entrada efetivada = data <= último dia do mês
  // Para mês atual: entrada efetivada = data <= hoje
  async function getSaldoFinalMesFechado(m, y, allLancs) {
    const key = mesAnoStr(m, y);
    const lancs = allLancs ? allLancs.filter(l=>l.mesAno===key) : await DB.getLancamentos(key);
    const saldoIni = await getSaldoInicialMes(m, y);

    // Limite de confirmação: para meses já encerrados = último dia do mês; para atual = hoje
    const hoje = todayStr();
    const ultimoDiaMes = `${y}-${String(m+1).padStart(2,'0')}-${String(new Date(y,m+1,0).getDate()).padStart(2,'0')}`;
    const limiteConfirmacao = ultimoDiaMes < hoje ? ultimoDiaMes : hoje;

    // Só entradas com data <= limiteConfirmacao (efetivamente recebidas)
    const entradas = lancs.filter(l=>l.tipo==='entrada' && l.data && l.data<=limiteConfirmacao)
                          .reduce((s,l)=>s+(l.valor||0),0);
    // Saídas débito (avulso + fixo débito pago) — sem data, considerar sempre
    const debitos = lancs.filter(l=>l.tipo==='debito').reduce((s,l)=>s+(l.valor||0),0);
    const fixosDeb = lancs.filter(l=>l.tipo==='fixo'&&l.pago&&l.pagamento==='debito').reduce((s,l)=>s+(l.valor||0),0);
    return saldoIni + entradas - debitos - fixosDeb;
  }

  /* ══════════════════════════════════════
     HOME
  ══════════════════════════════════════ */
  async function renderHome() {
    const lancs = state.lancamentos;
    const mesKey = mesAnoStr(state.currentMonth, state.currentYear);

    // entradas confirmadas (data <= hoje)
    const entradasConf = lancs.filter(l=>l.tipo==='entrada' && isDateConfirmed(l.data));
    const entradasPend = lancs.filter(l=>l.tipo==='entrada' && !isDateConfirmed(l.data));
    const totalEntradas = entradasConf.reduce((s,l)=>s+(l.valor||0),0);
    const totalPend = entradasPend.reduce((s,l)=>s+(l.valor||0),0);
    const totalSemData = entradasPend.filter(l=>!l.data).length;

    // saídas no débito apenas (item 4)
    const debitos = lancs.filter(l=>l.tipo==='debito').reduce((s,l)=>s+(l.valor||0),0);
    const fixosDebPagos = lancs.filter(l=>l.tipo==='fixo'&&l.pago&&l.pagamento==='debito').reduce((s,l)=>s+(l.valor||0),0);
    const totalSaidasDebito = debitos + fixosDebPagos;

    // crédito por cartão (para exibição nos chips, não soma no saldo)
    const creditoPorCartao = {};
    state.cartoes.forEach(c=>creditoPorCartao[c.id]=0);
    lancs.filter(l=>l.tipo==='credito').forEach(l=>{
      if (l.cartaoId) creditoPorCartao[l.cartaoId]=(creditoPorCartao[l.cartaoId]||0)+(l.valorParcela||0);
    });
    lancs.filter(l=>l.tipo==='fixo'&&l.pago&&l.cartaoId).forEach(l=>{
      creditoPorCartao[l.cartaoId]=(creditoPorCartao[l.cartaoId]||0)+(l.valor||0);
    });

    // saldo
    const saldoIni = await getSaldoInicialMes(state.currentMonth, state.currentYear);
    const saldoFinal = saldoIni + totalEntradas - totalSaidasDebito;

    document.getElementById('home-month-label').textContent = `${MONTHS[state.currentMonth]} ${state.currentYear}`;

    // Saldo hero
    const variacaoMes = saldoFinal - saldoIni;
    document.getElementById('h-saldo-final').textContent = saldoFinal.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    document.getElementById('h-saldo-ini').textContent = saldoIni.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const varEl = document.getElementById('h-variacao');
    if(varEl) { varEl.textContent = (variacaoMes>=0?'+':'')+variacaoMes.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); varEl.style.color=variacaoMes>=0?'var(--green)':'var(--red)'; }

    // Cards métricas
    document.getElementById('h-entradas').textContent = fmtMoney(totalEntradas);
    document.getElementById('h-entradas-sub').textContent = `${entradasConf.length} lançamento${entradasConf.length!==1?'s':''}`;
    const pendEl = document.getElementById('h-entradas-pending');
    if (totalPend>0) { pendEl.style.display=''; pendEl.textContent=`+${fmtMoney(totalPend)} pendente`; }
    else pendEl.style.display='none';

    // Saídas = só débito (item 4)
    document.getElementById('h-saidas').textContent = fmtMoney(totalSaidasDebito);
    const nSaidasDeb = lancs.filter(l=>l.tipo==='debito'||(l.tipo==='fixo'&&l.pagamento==='debito')).length;
    document.getElementById('h-saidas-sub').textContent = `${nSaidasDeb} lançamento${nSaidasDeb!==1?'s':''}`;

    // Progresso
    const pctEl = document.getElementById('h-prog-pct');
    const fillEl = document.getElementById('h-prog-fill');
    const hintEl = document.getElementById('h-prog-hint');
    if (totalEntradas>0) {
      const pct = Math.min((totalSaidasDebito/totalEntradas)*100,100);
      pctEl.textContent = pct.toFixed(0)+'%';
      pctEl.style.color = pct>90?'var(--red)':pct>70?'var(--amber)':'var(--green)';
      fillEl.style.width = pct+'%';
      hintEl.textContent = '';
    } else {
      pctEl.textContent='—'; fillEl.style.width='0%';
      hintEl.textContent = totalPend>0?'Aguardando entradas confirmadas':'Nenhuma entrada confirmada';
    }

    // Alert
    const alertEl = document.getElementById('home-alert');
    if (totalSemData>0) {
      alertEl.style.display='';
      alertEl.innerHTML=`<div class="alert-banner"><div class="alert-icon"><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><div class="alert-text"><strong>${totalSemData} entrada${totalSemData>1?'s':''} sem data</strong> — não serão contabilizadas até receber uma data</div></div>`;
    } else alertEl.style.display='none';

    // Cartões
    const cartaoEl = document.getElementById('h-cartoes');
    cartaoEl.innerHTML = state.cartoes.map(c=>{
      const usado = creditoPorCartao[c.id]||0;
      const pct = c.limite?Math.min((usado/c.limite)*100,100):0;
      return `<div class="cartao-chip" style="cursor:pointer" onclick="App.abrirCartao(${c.id})">
        <div class="cartao-band" style="background:${c.cor}"></div>
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
          ${getBancoIconHtml(c.nome,30)||`<div style="width:30px;height:30px;border-radius:8px;background:${c.cor}22;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">💳</div>`}
          <div class="cartao-chip-info" style="flex:1;min-width:0">
          <div class="cartao-chip-nome">${c.nome}</div>
          <div class="cartao-chip-venc">Vence dia ${c.vencimento}</div>
          <div class="cartao-mini-bar"><div class="cartao-mini-fill" style="width:${pct}%;background:${c.cor}"></div></div>
        </div></div>
        <div class="cartao-chip-vals">
          <div class="cartao-chip-usado" style="color:${c.cor}">${fmtMoney(usado)}</div>
          <div class="cartao-chip-limite" style="font-size:10px;color:var(--text3)">fatura</div>
        </div>
      </div>`;
    }).join('');

    // Feed
    const feedEl = document.getElementById('h-feed');
    const recentes = [...lancs].sort((a,b)=>(b.criadoEm||0)-(a.criadoEm||0)).slice(0,6);
    if (!recentes.length) {
      feedEl.innerHTML='<div class="empty-state" style="padding:24px 0"><div class="empty-icon">💸</div><div class="empty-title">Nenhum lançamento</div><div class="empty-sub">Toque no + para adicionar</div></div>';
    } else {
      feedEl.innerHTML = recentes.map(l=>renderFeedItem(l,false)).join('');
    }
  }

  function abrirCartao(cartaoId) {
    state.cartaoFiltro = cartaoId;
    state.lancTab = 'saidas';
    state.lancSubTab = 'credito_'+cartaoId;
    gotoScreen('screen-lancamentos');
  }

  /* ── Feed item ───────────────────────── */
  function renderFeedItem(l, showPagoToggle=false) {
    const cat = getCatById(l.categoriaId);
    const isEntrada = l.tipo==='entrada';
    const isFixo = l.tipo==='fixo';
    const isCredito = l.tipo==='credito';
    const cartao = (isCredito||isFixo) ? getCartaoById(l.cartaoId) : null;
    const emoji = getCatEmoji(l);
    const cor = isEntrada ? 'var(--green)' : isFixo ? '#888899' : getCatCor(l);
    const bgCor = isEntrada ? 'var(--green-dim)' : isFixo ? '#88889922' : cor+'28';
    const sinal = isEntrada ? '+' : '-';
    const valor = isCredito ? (l.valorParcela||0) : (l.valor||0);

    // data confirmada?
    const semData = isEntrada && !l.data;
    const pendente = isEntrada && l.data && !isDateConfirmed(l.data);
    const dataTxt = l.data ? new Date(l.data+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}) : '';

    // Detalhe: categoria ou "emoji_subcat Nome_cat › Nome_subcat"
    let detalhe = '';
    if (l.subcat && cat) {
      const subObj = cat.subcats ? cat.subcats.find(s=>(typeof s==='string'?s:s.nome)===l.subcat) : null;
      const subEmoji = (subObj && typeof subObj==='object') ? subObj.emoji : '';
      detalhe = `${subEmoji ? subEmoji+' ' : ''}${cat.nome} › ${l.subcat}`;
    } else if (cat) {
      detalhe = cat.nome;
    }
    // tipo de pagamento
    if (isFixo) {
      detalhe += ` · ${l.pagamento==='debito'?'Gasto fixo · Débito': `Gasto fixo · ${cartao?.nome||'Crédito'}`}`;
    } else if (isCredito && cartao) {
      detalhe += ` · ${cartao.nome}`;
      if (l.parcela && l.totalParcelas) detalhe += ` · ${l.parcela}/${l.totalParcelas}`;
    } else if (!isEntrada) {
      detalhe += ' · Débito';
    } else if (l.fixo) {
      detalhe += ' · Entrada fixa';
    }
    if (dataTxt) detalhe += ` · ${dataTxt}`;

    const badge = semData ? '<span class="badge badge-nodate">sem data</span>' :
                  pendente ? '<span class="badge badge-pending">pendente</span>' : '';

    const pagoToggle = (isFixo && showPagoToggle) ? `
      <div class="fixo-pago-toggle ${l.pago?'pago':''}" onclick="event.stopPropagation();App.toggleFixoPago(${l.id})" title="${l.pago?'Não pago':'Marcar como pago'}">
        ${l.pago?'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>':'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/></svg>'}
      </div>` : '';

    // Nome: descrição ou nome da categoria
    const nome = l.descricao || cat?.nome || l.tipo;

    // Ícone: sempre emoji da CATEGORIA (não subcategoria)
    const catEmoji = cat ? cat.emoji : (isEntrada ? '💰' : '💸');
    return `<div class="feed-item" onclick="App.editLancamento(${l.id})">
      ${pagoToggle}
      <div class="feed-icon" style="background:${bgCor}">
        <span style="font-size:17px;line-height:1">${catEmoji}</span>
      </div>
      <div class="feed-info">
        <div class="feed-nome">${nome}</div>
        <div class="feed-cat">${detalhe}</div>
      </div>
      <div class="feed-right">
        <div class="feed-val" style="color:${semData||pendente?'var(--text3)':cor}">${sinal}${fmtMoney(valor)}</div>
        ${badge}
      </div>
    </div>`;
  }

  async function toggleFixoPago(id) {
    const l = state.lancamentos.find(x=>x.id===id);
    if (!l) return;
    l.pago = !l.pago;
    await DB.updateLancamento(l);
    state.lancamentos = await DB.getLancamentos(mesAnoStr(state.currentMonth, state.currentYear));
    if (state.currentScreen==='screen-lancamentos') renderLancamentos();
    if (state.currentScreen==='screen-home') renderHome();
  }

  /* ══════════════════════════════════════
     LANÇAMENTOS
  ══════════════════════════════════════ */
  function setLancTab(tab) {
    state.lancTab = tab;
    state.lancSubTab = null;
    state.cartaoFiltro = null;
    ['todos','entradas','saidas','fixos'].forEach(t=>document.getElementById('lt-'+t)?.classList.toggle('active',t===tab));
    renderLancamentos();
  }
  function setLancSubTab(sub) { state.lancSubTab=sub; renderLancamentos(); }

  function renderLancamentos() {
    document.getElementById('lanc-month-label').textContent=`${MONTHS[state.currentMonth]} ${state.currentYear}`;
    let lancs = [...state.lancamentos].sort((a,b)=>{
      const da=a.data||'9999-12-31',db2=b.data||'9999-12-31';
      return db2.localeCompare(da)||(b.criadoEm||0)-(a.criadoEm||0);
    });

    if (state.lancTab==='entradas') lancs=lancs.filter(l=>l.tipo==='entrada');
    else if (state.lancTab==='saidas') lancs=lancs.filter(l=>['debito','credito','fixo'].includes(l.tipo));
    else if (state.lancTab==='fixos') lancs=lancs.filter(l=>l.tipo==='fixo');

    const feedEl = document.getElementById('lanc-feed');
    let subTabsHtml='', filterHtml='';

    if (state.lancTab==='saidas') {
      const subTabs=[{key:'todos_saidas',label:'Todos'},{key:'debito',label:'Débito'},
        ...state.cartoes.map(c=>({key:'credito_'+c.id,label:c.nome,cor:c.cor}))];
      const activeKey=state.lancSubTab||'todos_saidas';
      subTabsHtml=`<div class="sub-tabs">
        ${subTabs.map(t=>`<div class="sub-tab ${activeKey===t.key?'active':''}" onclick="App.setLancSubTab('${t.key}')" ${t.cor&&activeKey===t.key?`style="background:${t.cor}20;border-color:${t.cor};color:${t.cor}"`:''}>
          ${t.cor?`<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${t.cor};margin-right:4px;vertical-align:middle"></span>`:''}${t.label}</div>`).join('')}
      </div>`;
      if (activeKey==='debito') lancs=lancs.filter(l=>l.tipo==='debito'||(l.tipo==='fixo'&&l.pagamento==='debito'));
      else if (activeKey.startsWith('credito_')) {
        const cid=parseInt(activeKey.replace('credito_',''));
        lancs=lancs.filter(l=>(l.tipo==='credito'&&l.cartaoId===cid)||(l.tipo==='fixo'&&l.cartaoId===cid));
      }
    }

    // filtro de categoria
    if (state.lancCatFilter.length>0) {
      lancs=lancs.filter(l=>state.lancCatFilter.some(f=>{
        if(f.type==='cat') return f.id===l.categoriaId;
        if(f.type==='subcat') return f.catId===l.categoriaId&&f.nome===l.subcat;
        return false;
      }));
    }

    filterHtml=`<div style="padding:0 20px 10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="sub-tab ${state.lancCatFilter.length>0?'active':''}" onclick="App.abrirFiltroCategoria()">🔍 Categorias${state.lancCatFilter.length>0?` (${state.lancCatFilter.length})`:''}</button>
      ${state.lancCatFilter.length>0?`<button class="sub-tab" onclick="App.limparFiltroCategoria()" style="color:var(--red);border-color:var(--red)">✕ Limpar</button>`:''}
    </div>`;

    let html = subTabsHtml + filterHtml;
    if (!lancs.length) {
      html+=`<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">Nenhum lançamento</div><div class="empty-sub">Toque no + para adicionar</div></div>`;
    } else {
      html+=lancs.map(l=>renderFeedItem(l,l.tipo==='fixo')).join('');
    }
    feedEl.innerHTML=html;
  }

  function abrirFiltroCategoria() {
    const cats=state.categorias;
    const content=document.getElementById('modal-content');
    let html=`<div class="modal-title">Filtrar por categoria</div>`;
    for (const cat of cats) {
      const catSel=state.lancCatFilter.some(f=>f.type==='cat'&&f.id===cat.id);
      html+=`<div style="margin-bottom:4px">
        <div style="padding:10px 0;display:flex;align-items:center;gap:10px;cursor:pointer" onclick="App._toggleFiltroItem('cat',${cat.id},null,'${cat.nome}')">
          <div style="width:18px;height:18px;border-radius:4px;border:1.5px solid ${catSel?'var(--accent)':'var(--border2)'};background:${catSel?'var(--accent)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${catSel?'<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>':''}
          </div>
          <span style="font-size:16px">${cat.emoji}</span>
          <span style="flex:1;font-size:14px;font-weight:500">${cat.nome}</span>
        </div>
        ${(cat.subcats||[]).filter(s=>typeof s==='object').map(s=>{
          const subSel=state.lancCatFilter.some(f=>f.type==='subcat'&&f.catId===cat.id&&f.nome===s.nome);
          return `<div style="padding:6px 0 6px 28px;display:flex;align-items:center;gap:10px;cursor:pointer" onclick="App._toggleFiltroItem('subcat',${cat.id},'${s.nome}','${s.nome}')">
            <div style="width:16px;height:16px;border-radius:4px;border:1.5px solid ${subSel?'var(--accent)':'var(--border2)'};background:${subSel?'var(--accent)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
              ${subSel?'<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>':''}
            </div>
            <span style="font-size:14px">${s.emoji||'•'}</span>
            <span style="font-size:13px;color:var(--text2)">${s.nome}</span>
          </div>`;
        }).join('')}
      </div>`;
    }
    html+=`<div class="modal-btns"><button class="btn-save" onclick="App.closeModal();App.renderLancamentos()">Aplicar</button></div>`;
    content.innerHTML=html;
    document.getElementById('modal-overlay').classList.add('open');
  }

  function _toggleFiltroItem(type,catId,subcatNome,label) {
    if(type==='cat'){
      const idx=state.lancCatFilter.findIndex(f=>f.type==='cat'&&f.id===catId);
      if(idx>=0) state.lancCatFilter.splice(idx,1);
      else state.lancCatFilter.push({type:'cat',id:catId,label});
    } else {
      const idx=state.lancCatFilter.findIndex(f=>f.type==='subcat'&&f.catId===catId&&f.nome===subcatNome);
      if(idx>=0) state.lancCatFilter.splice(idx,1);
      else state.lancCatFilter.push({type:'subcat',catId,nome:subcatNome,label});
    }
    abrirFiltroCategoria();
  }
  function limparFiltroCategoria() { state.lancCatFilter=[]; renderLancamentos(); }

  /* ══════════════════════════════════════
     NOVO LANÇAMENTO
  ══════════════════════════════════════ */
  function setTipoLanc(tipo) {
    state.tipoLanc=tipo;
    document.querySelectorAll('.type-tab').forEach(t=>{
      t.className='type-tab'+(t.dataset.type===tipo?` active-${tipo}`:'');
    });
    const titles={entrada:'Nova entrada',entrada_fixa:'Nova entrada fixa',fixo:'Novo gasto fixo',debito:'Nova saída (débito)',credito:'Nova compra (crédito)'};
    document.getElementById('novo-title').textContent=state.editingId?'Editar lançamento':titles[tipo];
    renderForm();
  }

  function renderForm() {
    const tipo=state.tipoLanc;
    const isTipoEntrada = tipo==='entrada'||tipo==='entrada_fixa';
    const cats=state.categorias.filter(c=>isTipoEntrada?c.tipo==='entrada':c.tipo==='saida');
    const today=todayStr();
    const el=document.getElementById('form-body');
    const edit=state.editingId?state.lancamentos.find(l=>l.id===state.editingId):null;
    const catSel=edit?.categoriaId||cats[0]?.id;
    const catSelObj=getCatById(catSel);

    const campoValor=`<div class="field"><div class="field-label">Valor</div>
      <div class="valor-wrap"><span class="valor-prefix">R$</span>
        <input type="text" inputmode="numeric" placeholder="0,00" id="f-valor" oninput="App._maskMoney(this)"
          value="${edit?(edit.valor||edit.valorTotal||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):''}">
      </div></div>`;

    const subcatsHtml=(catSelObj?.subcats||[]).map(s=>{
      const nome=typeof s==='string'?s:s.nome;
      const em=typeof s==='object'?s.emoji:'';
      return `<div class="subcat-chip ${nome===edit?.subcat?'sel':''}" onclick="App._selSubcat(this,'${nome}')" data-subcat="${nome}">${em?em+' ':''}${nome}</div>`;
    }).join('');

    const campoCat=`<div class="field"><div class="field-label">Categoria</div>
      <div class="cat-grid" id="cat-grid">
        ${cats.map(c=>`<div class="cat-chip ${c.id===catSel?'sel':''}" onclick="App._selCat(${c.id})" data-catid="${c.id}">
          <div class="cat-emoji">${c.emoji}</div><div class="cat-name">${c.nome}</div></div>`).join('')}
      </div>
      <div class="subcat-row" id="subcat-row">${subcatsHtml}</div></div>`;

    const campoDesc=`<div class="field"><div class="field-label">Descrição <span class="opt-badge">opcional</span></div>
      <input type="text" id="f-desc" value="${edit?.descricao||''}"></div>`;

    const btnExcluir=state.editingId?`<button class="submit-btn" style="background:var(--red-dim);color:var(--red);margin-top:8px" onclick="App._deletar()">Excluir lançamento</button>`:'';

    if (tipo==='entrada') {
      el.innerHTML=`${campoValor}${campoCat}
        <div class="field"><div class="field-label">Data <span class="opt-badge">opcional</span></div>
          <input type="date" id="f-data" value="${edit?.data||today}"></div>
        ${campoDesc}
        <button class="submit-btn btn-entrada" onclick="App._salvar()">${state.editingId?'Salvar alterações':'Salvar entrada'}</button>
        ${btnExcluir}<div style="height:20px"></div>`;
    }
    else if (tipo==='entrada_fixa') {
      el.innerHTML=`${campoValor}${campoCat}
        <div class="field"><div class="field-label">Dia do mês</div>
          <input type="number" id="f-dia" min="1" max="28" placeholder="Ex: 10" value="${edit?.diaDoMes||''}">
          <div style="font-size:11px;color:var(--text3);margin-top:6px">Esta entrada será lançada automaticamente todo mês neste dia</div>
        </div>
        ${campoDesc}
        <button class="submit-btn btn-entrada" onclick="App._salvar()">${state.editingId?'Salvar alterações':'Salvar entrada fixa'}</button>
        ${btnExcluir}<div style="height:20px"></div>`;
    }
    else if (tipo==='fixo') {
      const tipoSel=edit?.pagamento||'debito';
      el.innerHTML=`${campoValor}
        <div class="field"><div class="field-label">Tipo de pagamento</div>
          <div class="cat-grid" id="payment-grid">
            <div class="cat-chip ${tipoSel==='debito'?'sel':''}" data-pay="debito" onclick="App._selPay(this,'debito')">
              <div class="cat-emoji">🏦</div><div class="cat-name">Débito</div></div>
            ${state.cartoes.map(c=>`<div class="cat-chip ${tipoSel===String(c.id)?'sel':''}" data-pay="${c.id}" onclick="App._selPay(this,${c.id})">
              <div class="cat-emoji"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.cor}"></span></div>
              <div class="cat-name">${c.nome}</div></div>`).join('')}
          </div></div>
        ${campoCat}
        <div class="field"><div class="field-label">Pago este mês?</div>
          <div class="toggle-field"><span class="toggle-label">Marcar como pago</span>
            <div class="toggle ${edit?.pago?'on':''}" id="toggle-pago" onclick="this.classList.toggle('on');this.querySelector('.toggle-thumb').style.left=this.classList.contains('on')?'20px':'2px'">
              <div class="toggle-thumb" style="left:${edit?.pago?'20px':'2px'}"></div></div></div></div>
        ${campoDesc}
        ${!state.editingId?`<div style="padding:10px 0 2px;font-size:12px;color:var(--text3)">ℹ️ Este gasto fixo será replicado automaticamente em todos os meses seguintes</div>`:''}
        <button class="submit-btn btn-fixo" onclick="App._salvar()">${state.editingId?'Salvar alterações':'Salvar gasto fixo'}</button>
        ${btnExcluir}<div style="height:20px"></div>`;
    }
    else if (tipo==='debito') {
      el.innerHTML=`${campoValor}${campoCat}
        <div class="field"><div class="field-label">Data</div>
          <input type="date" id="f-data" value="${edit?.data||today}"></div>
        ${campoDesc}
        <button class="submit-btn btn-debito" onclick="App._salvar()">${state.editingId?'Salvar alterações':'Salvar saída'}</button>
        ${btnExcluir}<div style="height:20px"></div>`;
    }
    else if (tipo==='credito') {
      const cartaoSel=edit?.cartaoId||state.cartoes[0]?.id;
      el.innerHTML=`
        <div class="field"><div class="field-label">Valor total</div>
          <div class="valor-wrap"><span class="valor-prefix">R$</span>
            <input type="text" inputmode="numeric" placeholder="0,00" id="f-valor"
              oninput="App._maskMoney(this);App._updateParcelas()"
              value="${edit?(edit.valorTotal||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):''}">
          </div></div>
        <div class="row2">
          <div class="field"><div class="field-label">Parcelas</div>
            <select id="f-parcelas" onchange="App._updateParcelas()">
              ${[1,2,3,4,5,6,7,8,9,10,11,12].map(n=>`<option value="${n}" ${(edit?.totalParcelas||1)===n?'selected':''}>${n===1?'1x (à vista)':n+'x'}</option>`).join('')}
            </select></div>
          <div class="field"><div class="field-label">Data da compra</div>
            <input type="date" id="f-data" value="${edit?.data||today}" oninput="App._updateParcelas()"></div>
        </div>
        <div id="parcelas-preview" style="display:none"></div>
        <div class="field"><div class="field-label">Cartão</div>
          <div class="cat-grid" id="cartao-grid">
            ${state.cartoes.map(c=>`<div class="cat-chip ${c.id===cartaoSel?'sel':''}" data-cartao="${c.id}" onclick="App._selCartao(this,${c.id})">
              <div class="cat-emoji"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${c.cor};margin-bottom:2px"></span></div>
              <div class="cat-name">${c.nome}</div></div>`).join('')}
          </div></div>
        ${campoCat}${campoDesc}
        <button class="submit-btn btn-credito" onclick="App._salvar()">${state.editingId?'Salvar alterações':'Salvar compra'}</button>
        ${btnExcluir}<div style="height:20px"></div>`;
      setTimeout(()=>_updateParcelas(),50);
    }

    if (edit) {
      setTimeout(()=>{
        if(edit.categoriaId) _selCat(edit.categoriaId,true);
        if(edit.subcat) document.querySelectorAll('#subcat-row .subcat-chip').forEach(el=>el.classList.toggle('sel',el.dataset.subcat===edit.subcat));
      },50);
    }
  }

  function _maskMoney(el){maskMoney(el);}
  function _selCat(id,silent=false) {
    document.querySelectorAll('#cat-grid .cat-chip').forEach(el=>el.classList.toggle('sel',parseInt(el.dataset.catid)===id));
    const cat=getCatById(id);
    const subRow=document.getElementById('subcat-row');
    if(!subRow) return;
    const subs=cat?.subcats||[];
    if(!subs.length){subRow.innerHTML='';return;}
    subRow.innerHTML=subs.map(s=>{
      const nome=typeof s==='string'?s:s.nome;
      const em=typeof s==='object'?s.emoji:'';
      return `<div class="subcat-chip" onclick="App._selSubcat(this,'${nome}')" data-subcat="${nome}">${em?em+' ':''}${nome}</div>`;
    }).join('');
  }
  function _selSubcat(el,name){
    document.querySelectorAll('#subcat-row .subcat-chip').forEach(c=>c.classList.remove('sel'));
    el.classList.add('sel');
  }
  function _selPay(el,val){
    document.querySelectorAll('#payment-grid .cat-chip').forEach(c=>c.classList.remove('sel'));
    el.classList.add('sel');
  }
  function _selCartao(el,id){
    document.querySelectorAll('#cartao-grid .cat-chip').forEach(c=>c.classList.remove('sel'));
    el.classList.add('sel');
    _updateParcelas();
  }
  function _updateParcelas(){
    const valEl=document.getElementById('f-valor');
    const numEl=document.getElementById('f-parcelas');
    const dataEl=document.getElementById('f-data');
    const prevEl=document.getElementById('parcelas-preview');
    if(!valEl||!numEl||!prevEl) return;
    const val=parseMoneyInput(valEl.value);
    const n=parseInt(numEl.value)||1;
    const data=dataEl?.value||todayStr();
    if(val<=0){prevEl.style.display='none';return;}
    prevEl.style.display='';
    const cartaoEl=document.querySelector('#cartao-grid .cat-chip.sel');
    const cartaoId=cartaoEl?parseInt(cartaoEl.dataset.cartao):state.cartoes[0]?.id;
    const cartao=getCartaoById(cartaoId);
    const fechamento=cartao?.fechamento||5;
    const vencimento=cartao?.vencimento||10;
    const dCompra=new Date(data+'T12:00:00');
    const diaCompra=dCompra.getDate();
    // Mês base da fatura (mesma lógica do save)
    // dia >= fechamento → fatura deste mês; dia < fechamento → fatura do mês anterior
    const dMesBasePrev = new Date(dCompra);
    if(diaCompra < fechamento) dMesBasePrev.setMonth(dMesBasePrev.getMonth()-1);
    const faturaLabel = diaCompra >= fechamento
      ? `fatura de ${MONTHS[dMesBasePrev.getMonth()]} (dia ${diaCompra} ≥ fechamento ${fechamento})`
      : `fatura de ${MONTHS[dMesBasePrev.getMonth()]} (dia ${diaCompra} < fechamento ${fechamento})`;
    const parcela=val/n;
    let rows='';
    for(let i=0;i<Math.min(n,6);i++){
      const d=new Date(dMesBasePrev);
      d.setMonth(d.getMonth()+i);
      rows+=`<div class="parcela-row"><span class="parcela-mes">${i+1}/${n} · ${MONTHS[d.getMonth()]}/${d.getFullYear()}</span><span class="parcela-val">${fmtMoney(parcela)}</span></div>`;
    }
    if(n>6) rows+=`<div class="parcela-row"><span class="parcela-mes" style="color:var(--text3)">+ ${n-6} parcelas...</span></div>`;
    rows+=`<div class="parcela-info">${faturaLabel} · vence dia ${vencimento}</div>`;
    prevEl.innerHTML=`<div class="parcelas-box"><div class="parcelas-box-title">Distribuição das parcelas</div>${rows}</div>`;
  }
  function _getSelectedCatId(){const s=document.querySelector('#cat-grid .cat-chip.sel');return s?parseInt(s.dataset.catid):null;}
  function _getSelectedSubcat(){const s=document.querySelector('#subcat-row .subcat-chip.sel');return s?s.dataset.subcat||s.textContent.trim():null;}

  async function _salvar(){
    const tipo=state.tipoLanc;
    const valor=parseMoneyInput(document.getElementById('f-valor')?.value||'0');
    if(!valor){toast('Informe o valor','err');return;}
    const catId=_getSelectedCatId();
    const subcat=_getSelectedSubcat();
    const desc=document.getElementById('f-desc')?.value?.trim()||'';
    const data=document.getElementById('f-data')?.value||'';
    const mesAno=mesAnoStr(state.currentMonth,state.currentYear);
    let obj={tipo:tipo==='entrada_fixa'?'entrada':tipo,categoriaId:catId,subcat,descricao:desc,mesAno};

    if(tipo==='entrada'){
      obj.valor=valor; obj.data=data;
    }
    else if(tipo==='entrada_fixa'){
      const dia=parseInt(document.getElementById('f-dia')?.value||'1');
      if(!dia||dia<1||dia>28){toast('Informe um dia válido (1-28)','err');return;}
      obj.valor=valor; obj.fixo=true;
      // data = dia fixo no mês atual
      obj.data=`${state.currentYear}-${String(state.currentMonth+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
      if(!state.editingId){
        // salvar template de entrada fixa — mesAnoMinimo = mês atual (não criar em meses passados)
        const mesAnoMinimo=mesAnoStr(state.currentMonth,state.currentYear);
        const tmpl={tipo:'entrada_fixa',categoriaId:catId,subcat,descricao:desc,valor,diaDoMes:dia,mesAnoMinimo};
        const tmplId=await DB.saveFixoTemplate(tmpl);
        obj.templateId=tmplId;
      }
    }
    else if(tipo==='fixo'){
      obj.valor=valor;
      const paySel=document.querySelector('#payment-grid .cat-chip.sel');
      obj.pagamento=paySel?paySel.dataset.pay:'debito';
      obj.cartaoId=obj.pagamento==='debito'?null:parseInt(obj.pagamento);
      obj.pago=document.getElementById('toggle-pago')?.classList.contains('on')||false;
      if(!state.editingId){
        // mesAnoMinimo = mês atual (não replicar em meses passados)
        const mesAnoMinimo=mesAnoStr(state.currentMonth,state.currentYear);
        const tmpl={tipo:'fixo',categoriaId:catId,subcat,descricao:desc,valor,pagamento:obj.pagamento,cartaoId:obj.cartaoId,mesAnoMinimo};
        const tmplId=await DB.saveFixoTemplate(tmpl);
        obj.templateId=tmplId;
      }
    }
    else if(tipo==='debito'){
      obj.valor=valor; obj.data=data;
    }
    else if(tipo==='credito'){
      const n=parseInt(document.getElementById('f-parcelas')?.value||'1');
      const cartaoEl=document.querySelector('#cartao-grid .cat-chip.sel');
      const cartaoId=cartaoEl?parseInt(cartaoEl.dataset.cartao):state.cartoes[0]?.id;
      const cartao=getCartaoById(cartaoId);
      const fechamento=cartao?.fechamento||5;
      const dataCompra=data||todayStr();
      const dCompra=new Date(dataCompra+'T12:00:00');
      const diaCompra=dCompra.getDate();
      const valorParcela=valor/n;
      // Lançamento SEMPRE fica no mês da compra (item 6)
      // Determinar o mês base da fatura:
      // dia_compra >= dia_fechamento → fatura do MÊS DA COMPRA (aparece neste mês)
      // dia_compra <  dia_fechamento → fatura do MÊS ANTERIOR (aparece no mês anterior)
      let dMesBase = new Date(dCompra);
      if (diaCompra < fechamento) {
        dMesBase.setMonth(dMesBase.getMonth() - 1);
      }
      const mesAnoCompra = mesAnoStr(dMesBase.getMonth(), dMesBase.getFullYear());
      if(!state.editingId){
        const grupoId=Date.now();
        // Parcela 1 → mesAnoCompra, parcela 2 → mesAnoCompra+1, etc.
        for(let i=0;i<n;i++){
          const dParcela = new Date(dMesBase);
          dParcela.setMonth(dParcela.getMonth()+i);
          const maParcela = mesAnoStr(dParcela.getMonth(), dParcela.getFullYear());
          await DB.addLancamento({
            tipo:'credito',categoriaId:catId,subcat,descricao:desc,
            mesAno:maParcela,          // mês da fatura onde esta parcela aparece
            dataCompra:dataCompra,     // data original da compra (para referência)
            valorTotal:valor,totalParcelas:n,valorParcela,
            parcela:i+1,cartaoId,data:dataCompra,grupoId,
          });
        }
        state.lancamentos=await DB.getLancamentos(mesAno);
        const nomesMes = diaCompra<fechamento
          ? `fatura de ${MONTHS[dMesBase.getMonth()]}`
          : `fatura de ${MONTHS[dMesBase.getMonth()]} (fecha dia ${fechamento})`;
        toast(`Compra salva — parcela 1 na ${nomesMes}`,'ok');
        goBack(); return;
      } else {
        obj.valorTotal=valor;obj.totalParcelas=n;obj.valorParcela=valorParcela;obj.cartaoId=cartaoId;obj.data=dataCompra;
      }
    }

    if(state.editingId){
      obj.id=state.editingId;
      const orig=state.lancamentos.find(l=>l.id===state.editingId);
      if(orig){obj.criadoEm=orig.criadoEm;obj.grupoId=orig.grupoId;obj.templateId=orig.templateId;}
      await DB.updateLancamento(obj);
      toast('Lançamento atualizado!','ok');
    } else {
      await DB.addLancamento(obj);
      toast('Lançamento salvo!','ok');
    }
    state.lancamentos=await DB.getLancamentos(mesAno);
    goBack();
  }

  async function _deletar(){
    if(!state.editingId) return;
    const lanc=state.lancamentos.find(l=>l.id===state.editingId);
    if(lanc?.tipo==='credito'&&lanc.grupoId&&lanc.totalParcelas>1){openModal('confirm-delete-parcelas',lanc);return;}
    if(lanc?.templateId){openModal('confirm-delete-fixo',lanc);return;}
    await DB.deleteLancamento(state.editingId);
    state.lancamentos=await DB.getLancamentos(mesAnoStr(state.currentMonth,state.currentYear));
    toast('Lançamento excluído','info'); goBack();
  }

  function editLancamento(id){
    state.editingId=id;
    const l=state.lancamentos.find(x=>x.id===id);
    if(!l) return;
    gotoScreen('screen-novo');
    // entrada fixa tem templateId e fixo=true
    setTipoLanc(l.fixo?'entrada_fixa':l.tipo);
  }

  /* ══════════════════════════════════════
     RELATÓRIOS
  ══════════════════════════════════════ */
  function setRelTab(tab){
    state.relTab=tab;
    ['mensal','evolucao'].forEach(t=>document.getElementById('rt-'+t)?.classList.toggle('active',t===tab));
    renderRelatorios();
  }

  async function renderRelatorios(){
    const el=document.getElementById('rel-content');
    el.innerHTML='<div class="spinner"></div>';
    if(state.relTab==='mensal') await renderRelMensal(el);
    else await renderRelEvolucao(el);
  }

  async function renderRelMensal(el){
    const lancs=state.lancamentos;
    const mesLabel=`${MONTHS[state.currentMonth]} ${state.currentYear}`;

    // totais por categoria (saídas pagas)
    const catTotals={},subCatTotals={};
    lancs.filter(l=>['debito','credito'].includes(l.tipo)).forEach(l=>{
      const v=l.tipo==='credito'?(l.valorParcela||0):(l.valor||0);
      if(!l.categoriaId) return;
      catTotals[l.categoriaId]=(catTotals[l.categoriaId]||0)+v;
      subCatTotals[`${l.categoriaId}__${l.subcat||''}`]=(subCatTotals[`${l.categoriaId}__${l.subcat||''}`]||0)+v;
    });
    lancs.filter(l=>l.tipo==='fixo'&&l.pago).forEach(l=>{
      const v=l.valor||0;
      if(!l.categoriaId) return;
      catTotals[l.categoriaId]=(catTotals[l.categoriaId]||0)+v;
      subCatTotals[`${l.categoriaId}__${l.subcat||''}`]=(subCatTotals[`${l.categoriaId}__${l.subcat||''}`]||0)+v;
    });
    const totalGastos=Object.values(catTotals).reduce((s,v)=>s+v,0);

    const entConf=lancs.filter(l=>l.tipo==='entrada'&&isDateConfirmed(l.data)).reduce((s,l)=>s+(l.valor||0),0);
    const entPend=lancs.filter(l=>l.tipo==='entrada'&&!isDateConfirmed(l.data)).reduce((s,l)=>s+(l.valor||0),0);
    const debito=lancs.filter(l=>l.tipo==='debito').reduce((s,l)=>s+(l.valor||0),0);
    const fixosDebPagos=lancs.filter(l=>l.tipo==='fixo'&&l.pago&&l.pagamento==='debito').reduce((s,l)=>s+(l.valor||0),0);
    const fixosNPagos=lancs.filter(l=>l.tipo==='fixo'&&!l.pago).reduce((s,l)=>s+(l.valor||0),0);

    const creditoPorCartao={};
    state.cartoes.forEach(c=>creditoPorCartao[c.id]=0);
    lancs.filter(l=>l.tipo==='credito').forEach(l=>{
      if(l.cartaoId) creditoPorCartao[l.cartaoId]=(creditoPorCartao[l.cartaoId]||0)+(l.valorParcela||0);
    });
    lancs.filter(l=>l.tipo==='fixo'&&l.pago&&l.cartaoId).forEach(l=>{
      creditoPorCartao[l.cartaoId]=(creditoPorCartao[l.cartaoId]||0)+(l.valor||0);
    });

    const saldoIni=await getSaldoInicialMes(state.currentMonth,state.currentYear);
    const saldoFinal=saldoIni+entConf-debito-fixosDebPagos;

    const catItems=Object.entries(catTotals)
      .map(([id,val])=>({cat:getCatById(parseInt(id)),val}))
      .filter(x=>x.cat&&x.val>0).sort((a,b)=>b.val-a.val);

    const subCatItems=Object.entries(subCatTotals).map(([key,val])=>{
      const [catId,subcatNome]=key.split('__');
      const cat=getCatById(parseInt(catId));
      if(!cat||!val) return null;
      const subObj=subcatNome&&cat.subcats?cat.subcats.find(s=>(typeof s==='object'?s.nome:s)===subcatNome):null;
      return {cat,subcatNome:subcatNome||null,val,
        emoji:subObj?.emoji||cat.emoji,cor:subObj?.cor||cat.cor,
        label:subcatNome?`${cat.nome} › ${subcatNome}`:cat.nome};
    }).filter(Boolean).sort((a,b)=>b.val-a.val);

    el.innerHTML=`
      <div style="padding:0 20px 4px;display:flex;justify-content:space-between;align-items:center">
        <div class="month-nav" style="padding:0;margin-bottom:0;flex:1">
          <button class="month-btn" onclick="App.changeMonth(-1)">&#8249;</button>
          <span style="font-size:15px;font-weight:600">${mesLabel}</span>
          <button class="month-btn" onclick="App.changeMonth(1)">&#8250;</button>
        </div>
      </div>
      <div class="card" style="padding:20px">
        <div class="section-label" style="padding:0;margin-bottom:14px">Saídas por categoria</div>
        ${catItems.length===0?'<div style="text-align:center;color:var(--text3);font-size:13px;padding:16px 0">Nenhuma saída registrada</div>':
          `<div style="position:relative;width:180px;height:180px;margin:0 auto 20px"><canvas id="pie-canvas-cat" width="180" height="180"></canvas></div>
           <div style="display:flex;flex-direction:column;gap:8px">
            ${catItems.map(i=>`<div style="display:flex;align-items:center;gap:8px">
              <div style="width:8px;height:8px;border-radius:50%;background:${i.cat.cor};flex-shrink:0"></div>
              <span style="flex:1;font-size:13px;color:var(--text2)">${i.cat.emoji} ${i.cat.nome}</span>
              <span style="font-size:12px;font-weight:500;font-family:'DM Mono',monospace;color:${i.cat.cor}">${totalGastos>0?((i.val/totalGastos)*100).toFixed(1)+'%':'0%'}</span>
              <span style="font-size:12px;color:var(--text3);font-family:'DM Mono',monospace">${fmtMoney(i.val)}</span>
            </div>`).join('')}</div>`}
      </div>
      <div class="card" style="padding:20px">
        <div class="section-label" style="padding:0;margin-bottom:14px">Saídas por subcategoria</div>
        ${subCatItems.length===0?'<div style="text-align:center;color:var(--text3);font-size:13px;padding:16px 0">Nenhuma saída registrada</div>':
          `<div style="position:relative;width:180px;height:180px;margin:0 auto 20px"><canvas id="pie-canvas-sub" width="180" height="180"></canvas></div>
           <div style="display:flex;flex-direction:column;gap:8px">
            ${subCatItems.map(i=>`<div style="display:flex;align-items:center;gap:8px">
              <div style="width:8px;height:8px;border-radius:50%;background:${i.cor};flex-shrink:0"></div>
              <span style="flex:1;font-size:13px;color:var(--text2)">${i.emoji} ${i.label}</span>
              <span style="font-size:12px;font-weight:500;font-family:'DM Mono',monospace;color:${i.cor}">${totalGastos>0?((i.val/totalGastos)*100).toFixed(1)+'%':'0%'}</span>
              <span style="font-size:12px;color:var(--text3);font-family:'DM Mono',monospace">${fmtMoney(i.val)}</span>
            </div>`).join('')}</div>`}
      </div>
      <div class="card" style="padding:20px">
        <div class="section-label" style="padding:0;margin-bottom:14px">Resumo do mês</div>
        <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:0.5px solid var(--border)"><span style="font-size:13px;color:var(--text2)">Entradas confirmadas</span><span style="font-size:14px;font-weight:500;font-family:'DM Mono',monospace;color:var(--green)">${fmtMoney(entConf)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:0.5px solid var(--border)"><span style="font-size:13px;color:var(--text2)">Entradas pendentes</span><span style="font-size:14px;font-weight:500;font-family:'DM Mono',monospace;color:var(--amber)">${fmtMoney(entPend)}</span></div>
        <div style="height:0.5px;background:var(--border);margin:4px 0"></div>
        <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:0.5px solid var(--border)"><span style="font-size:13px;color:var(--text2)">Saídas débito</span><span style="font-size:14px;font-weight:500;font-family:'DM Mono',monospace;color:var(--red)">-${fmtMoney(debito)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:0.5px solid var(--border)"><span style="font-size:13px;color:var(--text2)">Gastos fixos pagos (débito)</span><span style="font-size:14px;font-weight:500;font-family:'DM Mono',monospace;color:var(--red)">-${fmtMoney(fixosDebPagos)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:0.5px solid var(--border)"><span style="font-size:13px;color:var(--text3)">Gastos fixos previstos (não pagos)</span><span style="font-size:14px;font-weight:500;font-family:'DM Mono',monospace;color:var(--text3)">${fmtMoney(fixosNPagos)}</span></div>
        <div style="height:0.5px;background:var(--border);margin:4px 0"></div>
        ${state.cartoes.map(c=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:0.5px solid var(--border)">
          <span style="font-size:13px;color:var(--text2)">Crédito ${c.nome}</span>
          <span style="font-size:14px;font-weight:500;font-family:'DM Mono',monospace;color:${c.cor}">${fmtMoney(creditoPorCartao[c.id]||0)}</span>
        </div>`).join('')}
        <div style="height:0.5px;background:var(--border);margin:4px 0"></div>
        <div style="display:flex;justify-content:space-between;padding:7px 0">
          <span style="font-size:14px;font-weight:600;color:var(--text)">Saldo final</span>
          <span style="font-size:15px;font-weight:600;font-family:'DM Mono',monospace;color:var(--text)">${fmtMoney(saldoFinal)}</span>
        </div>
      </div>
      <div style="height:8px"></div>`;

    setTimeout(()=>{
      drawPie('pie-canvas-cat',catItems.map(i=>({val:i.val,cor:i.cat.cor})),totalGastos);
      drawPie('pie-canvas-sub',subCatItems.map(i=>({val:i.val,cor:i.cor})),totalGastos);
    },100);
  }

  function drawPie(canvasId,items,total){
    const canvas=document.getElementById(canvasId);
    if(!canvas||!items.length) return;
    const ctx=canvas.getContext('2d');
    const cx=90,cy=90,r=80,inner=52;
    let start=-Math.PI/2;
    items.forEach(item=>{
      const slice=(item.val/total)*2*Math.PI;
      ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,start,start+slice);ctx.closePath();
      ctx.fillStyle=item.cor;ctx.fill();start+=slice;
    });
    ctx.beginPath();ctx.arc(cx,cy,inner,0,2*Math.PI);ctx.fillStyle='#17171c';ctx.fill();
    ctx.fillStyle='#f0f0f0';ctx.font='500 11px DM Mono,monospace';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(fmtMoney(total),cx,cy);
  }

  async function renderRelEvolucao(el){
    const allLancs=await DB.getAllLancamentos();
    const n=state.relPeriodo||6;
    const meses=[];
    for(let i=n-1;i>=0;i--){
      let m=state.currentMonth-i,y=state.currentYear;
      while(m<0){m+=12;y--;}
      meses.push({m,y,key:mesAnoStr(m,y),label:MONTHS_SHORT[m]});
    }
    const dados=await Promise.all(meses.map(async mes=>{
      const lancs=allLancs.filter(l=>l.mesAno===mes.key);
      const entradas=lancs.filter(l=>l.tipo==='entrada'&&l.data&&isDateConfirmed(l.data)).reduce((s,l)=>s+(l.valor||0),0);
      const debitos=lancs.filter(l=>l.tipo==='debito').reduce((s,l)=>s+(l.valor||0),0);
      const fixosDeb=lancs.filter(l=>l.tipo==='fixo'&&l.pago&&l.pagamento==='debito').reduce((s,l)=>s+(l.valor||0),0);
      const credito=lancs.filter(l=>l.tipo==='credito').reduce((s,l)=>s+(l.valorParcela||0),0);
      const fixosCred=lancs.filter(l=>l.tipo==='fixo'&&l.pago&&l.cartaoId).reduce((s,l)=>s+(l.valor||0),0);
      const saidas=debitos+fixosDeb+credito+fixosCred;
      const saldoIni=await getSaldoInicialMes(mes.m,mes.y);
      const saldo=saldoIni+entradas-(debitos+fixosDeb);
      return {...mes,entradas,saidas,saldo};
    }));
    const mediaEnt=Math.round(dados.reduce((s,d)=>s+d.entradas,0)/dados.length);
    const mediaSai=Math.round(dados.reduce((s,d)=>s+d.saidas,0)/dados.length);
    const mediaSaldo=Math.round(dados.reduce((s,d)=>s+d.saldo,0)/dados.length);

    el.innerHTML=`
      <div class="card" style="padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div class="section-label" style="padding:0;margin:0">Entradas vs. Saídas</div>
          <div style="display:flex;gap:6px">
            ${[3,6,12].map(p=>`<div class="sub-tab ${state.relPeriodo===p?'active':''}" onclick="App._setRelPeriodo(${p})" style="font-size:11px;padding:4px 10px">${p}m</div>`).join('')}
          </div>
        </div>
        <canvas id="line-canvas" width="340" height="180"></canvas>
        <div style="display:flex;gap:16px;margin-top:10px">
          <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2)"><div style="width:20px;height:2px;background:var(--green)"></div>Entradas</div>
          <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2)"><div style="width:20px;height:2px;background:var(--red)"></div>Saídas</div>
        </div>
      </div>
      <div class="card" style="padding:20px">
        <div class="section-label" style="padding:0;margin-bottom:14px">Evolução do saldo</div>
        <canvas id="saldo-canvas" width="340" height="140"></canvas>
      </div>
      <div class="card" style="padding:20px">
        <div class="section-label" style="padding:0;margin-bottom:14px">Média dos últimos ${n} meses</div>
        ${[['Entradas',fmtMoney(mediaEnt),'var(--green)'],['Saídas',fmtMoney(mediaSai),'var(--red)'],['Saldo médio',fmtMoney(mediaSaldo),'var(--accent2)']].map(([label,val,cor])=>`
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--border)">
            <span style="font-size:13px;color:var(--text2)">${label}</span>
            <span style="font-size:14px;font-weight:500;font-family:'DM Mono',monospace;color:${cor}">${val}</span>
          </div>`).join('')}
      </div>
      <div style="height:8px"></div>`;

    setTimeout(()=>{ drawLineChart(dados); drawSaldoChart(dados); },100);

    // Card de limite acumulado (faturas com vencimento futuro)
    await renderLimiteCartoes(el);
  }

  async function renderLimiteCartoes(parentEl) {
    const allLancs = await DB.getAllLancamentos();
    const hoje = todayStr();

    const rows = await Promise.all(state.cartoes.map(async c => {
      let totalNaoPago = 0;
      // Créditos em meses cuja fatura ainda não venceu
      const creditos = allLancs.filter(l => l.tipo === 'credito' && l.cartaoId === c.id);
      for (const l of creditos) {
        const [mesStr, anoStr] = l.mesAno.split('-');
        const m = parseInt(mesStr) - 1;
        const y = parseInt(anoStr);
        // Fatura do mês M vence no mês M+1 dia c.vencimento
        const dVenc = new Date(y, m + 1, c.vencimento);
        const vencStr = `${dVenc.getFullYear()}-${String(dVenc.getMonth()+1).padStart(2,'0')}-${String(c.vencimento).padStart(2,'0')}`;
        if (vencStr >= hoje) totalNaoPago += (l.valorParcela || 0);
      }
      // Fixos no crédito não pagos
      allLancs.filter(l => l.tipo === 'fixo' && !l.pago && l.cartaoId === c.id)
               .forEach(l => totalNaoPago += (l.valor || 0));

      const pct = c.limite ? Math.min((totalNaoPago / c.limite) * 100, 100) : 0;
      const disp = Math.max((c.limite || 0) - totalNaoPago, 0);
      const iconHtml = getBancoIconHtml(c.nome, 28);
      return `<div style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          ${iconHtml || `<div style="width:28px;height:28px;border-radius:7px;background:${c.cor}22;display:flex;align-items:center;justify-content:center;font-size:13px">💳</div>`}
          <span style="font-size:15px;font-weight:600;color:${c.cor}">${c.nome}</span>
          <span style="margin-left:auto;font-size:13px;font-family:'DM Mono',monospace;color:var(--text2)">${fmtMoney(totalNaoPago)} <span style="color:var(--text3)">/ ${fmtMoney(c.limite||0)}</span></span>
        </div>
        <div style="height:10px;background:var(--bg4);border-radius:5px;overflow:hidden;margin-bottom:6px">
          <div style="height:100%;width:${pct}%;background:${c.cor};border-radius:5px"></div>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:11px;color:var(--text3)">${pct.toFixed(1)}% comprometido</span>
          <span style="font-size:11px;color:var(--text3)">${fmtMoney(disp)} disponível</span>
        </div>
      </div>`;
    }));

    const cardHtml = `<div class="card" style="padding:20px">
      <div class="section-label" style="padding:0;margin-bottom:4px">Limite comprometido</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:16px">Faturas com vencimento futuro ainda não pagas</div>
      ${rows.join('')}
    </div>
    <div style="height:8px"></div>`;

    parentEl.insertAdjacentHTML('beforeend', cardHtml);
  }

  function _setRelPeriodo(p){state.relPeriodo=p;renderRelatorios();}

  function drawLineChart(dados){
    const canvas=document.getElementById('line-canvas');
    if(!canvas) return;
    const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
    const pad={top:20,right:20,bottom:30,left:60},cw=W-pad.left-pad.right,ch=H-pad.top-pad.bottom;
    ctx.clearRect(0,0,W,H);
    const maxVal=Math.max(...dados.map(d=>Math.max(d.entradas,d.saidas)),1);
    const toX=i=>pad.left+i*(cw/(Math.max(dados.length-1,1)));
    const toY=v=>pad.top+ch-(v/maxVal)*ch;
    ctx.strokeStyle='#ffffff10';ctx.lineWidth=1;
    for(let i=0;i<=4;i++){
      const y=pad.top+(i/4)*ch;
      ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(pad.left+cw,y);ctx.stroke();
      ctx.fillStyle='#55556a';ctx.font='10px DM Mono,monospace';ctx.textAlign='right';
      const v=maxVal*(1-i/4);
      ctx.fillText(fmtMoney(v).replace('R$\u00a0',''),pad.left-4,y+4);
    }
    ctx.fillStyle='#55556a';ctx.font='10px DM Sans,sans-serif';ctx.textAlign='center';
    dados.forEach((d,i)=>ctx.fillText(d.label,toX(i),H-6));
    [[dados.map(d=>d.entradas),'#4ade80'],[dados.map(d=>d.saidas),'#f87171']].forEach(([vals,cor])=>{
      ctx.beginPath();ctx.strokeStyle=cor;ctx.lineWidth=2;ctx.lineJoin='round';
      vals.forEach((v,i)=>i===0?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v)));
      ctx.stroke();
      vals.forEach((v,i)=>{ctx.beginPath();ctx.arc(toX(i),toY(v),4,0,Math.PI*2);ctx.fillStyle=cor;ctx.fill();});
    });
  }

  function drawSaldoChart(dados){
    const canvas=document.getElementById('saldo-canvas');
    if(!canvas) return;
    const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
    const pad={top:16,right:20,bottom:26,left:60},cw=W-pad.left-pad.right,ch=H-pad.top-pad.bottom;
    ctx.clearRect(0,0,W,H);
    const vals=dados.map(d=>d.saldo);
    const maxVal=Math.max(...vals.map(Math.abs),1)*1.1;
    const toX=i=>pad.left+i*(cw/(Math.max(dados.length-1,1)));
    const toY=v=>pad.top+ch/2-(v/maxVal)*(ch/2);
    ctx.strokeStyle='#ffffff20';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(pad.left,pad.top+ch/2);ctx.lineTo(pad.left+cw,pad.top+ch/2);ctx.stroke();
    ctx.fillStyle='#55556a';ctx.font='10px DM Sans,sans-serif';ctx.textAlign='center';
    dados.forEach((d,i)=>ctx.fillText(d.label,toX(i),H-4));
    ctx.beginPath();ctx.strokeStyle='#9f94f8';ctx.lineWidth=2;ctx.lineJoin='round';
    vals.forEach((v,i)=>i===0?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v)));
    ctx.stroke();
    vals.forEach((v,i)=>{ctx.beginPath();ctx.arc(toX(i),toY(v),4,0,Math.PI*2);ctx.fillStyle=v>=0?'#9f94f8':'#f87171';ctx.fill();});
  }

  /* ══════════════════════════════════════
     PERFIL / CONFIG
  ══════════════════════════════════════ */
  function setCfgTab(tab){
    state.cfgTab=tab;
    ['categorias','cartoes','notif','dados'].forEach(t=>document.getElementById('ct-'+t)?.classList.toggle('active',t===tab));
    renderPerfil();
  }

  async function renderPerfil(){
    const el=document.getElementById('cfg-content');
    el.innerHTML='<div class="spinner"></div>';
    if(state.cfgTab==='categorias') await renderCfgCategorias(el);
    else if(state.cfgTab==='cartoes') await renderCfgCartoes(el);
    else if(state.cfgTab==='notif') await renderCfgNotif(el);
    else await renderCfgDados(el);
  }

  async function renderCfgCategorias(el){
    const cats=state.categorias;
    const renderGrupo=list=>list.map(c=>`
      <div class="cat-row" id="cat-row-${c.id}">
        <div class="cat-row-header" onclick="App._toggleCatRow(${c.id})">
          <div class="cat-color-dot" style="background:${c.cor}"></div>
          <span class="cat-row-name">${c.emoji} ${c.nome}</span>
          <span class="cat-row-count">${(c.subcats||[]).length} subcat${(c.subcats||[]).length!==1?'s':''}</span>
          <div class="cat-row-actions" onclick="event.stopPropagation()">
            <button class="cat-action-btn" onclick="App._openAddSubcat(${c.id})" title="Nova subcategoria"><svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
            <button class="cat-action-btn" onclick="App._openEditCat(${c.id})" title="Editar"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button class="cat-action-btn del" onclick="App._deleteCategoria(${c.id})" title="Excluir"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
          </div>
          <svg class="cat-chevron" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="cat-subcats">
          ${(c.subcats||[]).map((s,si)=>{
            const nome=typeof s==='string'?s:s.nome;
            const em=typeof s==='object'?s.emoji:'•';
            const cor=typeof s==='object'?s.cor:'var(--text3)';
            return `<div class="subcat-row-item">
              <div class="subcat-mini-dot" style="background:${cor}"></div>
              <span style="font-size:14px;margin-right:4px">${em}</span>
              <span class="subcat-row-name">${nome}</span>
              <div class="subcat-row-actions">
                <button class="cat-action-btn" onclick="App._openEditSubcat(${c.id},${si})"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="cat-action-btn del" onclick="App._deleteSubcat(${c.id},${si})"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`).join('');

    el.innerHTML=`
      <div style="padding:0 20px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span class="section-label" style="padding:0;margin:0">Saídas</span>
        <button onclick="App._openAddCat('saida')" style="font-size:12px;color:var(--accent2);border:0.5px solid var(--accent-dim);background:var(--accent-dim);padding:6px 12px;border-radius:20px;cursor:pointer;font-family:'DM Sans',sans-serif">+ Nova</button>
      </div>
      ${renderGrupo(cats.filter(c=>c.tipo==='saida'))}
      <div style="height:16px"></div>
      <div style="padding:0 20px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span class="section-label" style="padding:0;margin:0">Entradas</span>
        <button onclick="App._openAddCat('entrada')" style="font-size:12px;color:var(--accent2);border:0.5px solid var(--accent-dim);background:var(--accent-dim);padding:6px 12px;border-radius:20px;cursor:pointer;font-family:'DM Sans',sans-serif">+ Nova</button>
      </div>
      ${renderGrupo(cats.filter(c=>c.tipo==='entrada'))}
      <div style="height:20px"></div>`;
  }

  function _toggleCatRow(id){document.getElementById('cat-row-'+id)?.classList.toggle('open');}
  const COLORS=['#f87171','#fb923c','#fbbf24','#4ade80','#34d399','#60a5fa','#818cf8','#a78bfa','#f472b6','#94a3b8','#7c6af7','#0ea5e9','#10b981','#f59e0b','#ef4444'];

  function _emojiFieldHtml(val=''){
    return `<div class="field"><div class="field-label">Ícone (emoji)</div>
      <input type="text" id="m-emoji" value="${val}" maxlength="2" placeholder="Digite ou cole um emoji"
        style="font-size:24px;text-align:center" inputmode="text"></div>`;
  }
  function _colorFieldHtml(selCor=''){
    return `<div class="field"><div class="field-label">Cor</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px" id="color-presets">
        ${COLORS.map(c=>`<div class="color-opt ${selCor===c?'sel':''}" style="background:${c}" onclick="App._selColor(this,'m-cor-custom')"></div>`).join('')}
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <input type="color" id="m-cor-custom" value="${selCor||'#7c6af7'}" style="width:40px;height:36px;border-radius:8px;border:0.5px solid var(--border2);background:var(--bg3);cursor:pointer;padding:2px">
        <span style="font-size:12px;color:var(--text3)">ou escolha qualquer cor</span>
      </div></div>`;
  }
  function _selColor(el,inputId){
    document.querySelectorAll('#color-presets .color-opt').forEach(e=>e.classList.remove('sel'));
    el.classList.add('sel');
    const ci=document.getElementById(inputId);
    if(ci){const m=el.style.background.match(/\d+/g);if(m&&m.length>=3)ci.value='#'+m.slice(0,3).map(x=>parseInt(x).toString(16).padStart(2,'0')).join('');}
  }
  function _onCustomColor(){document.querySelectorAll('#color-presets .color-opt').forEach(e=>e.classList.remove('sel'));}
  function _openAddCat(tipo){openModal('add-cat',{tipo});}
  function _openEditCat(id){openModal('edit-cat',getCatById(id));}
  async function _deleteCategoria(id){
    if(!confirm('Excluir esta categoria?')) return;
    await DB.deleteCategoria(id);state.categorias=await DB.getCategorias();renderPerfil();toast('Categoria excluída','info');
  }
  function _openAddSubcat(catId){openModal('add-subcat',{catId});}
  function _openEditSubcat(catId,idx){
    const cat=getCatById(catId);if(!cat) return;
    const sub=cat.subcats[idx];
    openModal('edit-subcat',{catId,idx,sub:typeof sub==='string'?{nome:sub,emoji:'',cor:'#9ca3af'}:sub});
  }
  async function _deleteSubcat(catId,idx){
    const cat=getCatById(catId);if(!cat) return;
    cat.subcats.splice(idx,1);
    await DB.saveCategoria(cat);state.categorias=await DB.getCategorias();renderPerfil();
  }

  async function renderCfgCartoes(el){
    const mesLancs=state.lancamentos;
    const creditoPorCartao={};
    state.cartoes.forEach(c=>creditoPorCartao[c.id]=0);
    mesLancs.filter(l=>l.tipo==='credito').forEach(l=>{if(l.cartaoId)creditoPorCartao[l.cartaoId]=(creditoPorCartao[l.cartaoId]||0)+(l.valorParcela||0);});
    mesLancs.filter(l=>l.tipo==='fixo'&&l.pago&&l.cartaoId).forEach(l=>{creditoPorCartao[l.cartaoId]=(creditoPorCartao[l.cartaoId]||0)+(l.valor||0);});

    el.innerHTML=state.cartoes.map(c=>{
      const usado=creditoPorCartao[c.id]||0,pct=c.limite?Math.min((usado/c.limite)*100,100):0;
      return `<div class="cartao-cfg-card">
        <div class="cartao-cfg-header">
          ${getBancoIconHtml(c.nome,36)||`<div class="cartao-cfg-band" style="background:${c.cor}"></div>`}
          <div class="cartao-cfg-info"><div class="cartao-cfg-nome">${c.nome}</div><div class="cartao-cfg-datas">Fecha dia ${c.fechamento} · Vence dia ${c.vencimento}</div></div>
          <div class="cartao-cfg-limit"><div class="cartao-cfg-limit-label">Limite usado</div><div class="cartao-cfg-limit-val" style="color:${c.cor}">${fmtMoney(usado)} / ${fmtMoney(c.limite||0)}</div></div>
        </div>
        <div class="cartao-cfg-body">
          <div class="cartao-cfg-prog">
            <div class="cartao-cfg-prog-row"><span class="cartao-cfg-prog-label">${pct.toFixed(1)}% do limite</span><span class="cartao-cfg-prog-val">${fmtMoney((c.limite||0)-usado)} disponível</span></div>
            <div class="mini-prog-bar"><div class="mini-prog-fill" style="width:${pct}%;background:${c.cor}"></div></div>
          </div>
          <div class="cartao-cfg-fields">
            <div><div class="cartao-cfg-field-label">Fechamento</div><input type="number" min="1" max="28" value="${c.fechamento}" onchange="App._updateCartao(${c.id},'fechamento',this.value)"></div>
            <div><div class="cartao-cfg-field-label">Vencimento</div><input type="number" min="1" max="31" value="${c.vencimento}" onchange="App._updateCartao(${c.id},'vencimento',this.value)"></div>
            <div><div class="cartao-cfg-field-label">Limite total</div><input type="text" value="${(c.limite||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}" oninput="App._maskMoney(this)" onchange="App._updateCartao(${c.id},'limite',this.value)"></div>
            <div><div class="cartao-cfg-field-label">Alerta (%)</div><input type="number" min="1" max="100" value="${c.alertaPct||80}" onchange="App._updateCartao(${c.id},'alertaPct',this.value)"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="action-btn secondary" style="margin:0;flex:1;padding:10px;font-size:13px" onclick="App._editCartao(${c.id})"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Editar</button>
            <button class="action-btn danger" style="margin:0;flex:1;padding:10px;font-size:13px" onclick="App._deleteCartao(${c.id})"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Excluir</button>
          </div>
        </div>
      </div>`;
    }).join('')+`
      <button class="action-btn primary" onclick="App._openAddCartao()"><svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Adicionar cartão</button>
      <div style="height:8px"></div>`;
  }

  async function _updateCartao(id,field,val){
    const c=getCartaoById(id);if(!c) return;
    c[field]=field==='limite'?parseMoneyInput(val):(parseFloat(val)||val);
    await DB.saveCartao(c);state.cartoes=await DB.getCartoes();toast('Cartão atualizado','ok');
  }
  function _openAddCartao(){openModal('add-cartao',{});}
  function _editCartao(id){openModal('edit-cartao',getCartaoById(id));}
  async function _deleteCartao(id){
    if(!confirm('Excluir este cartão?')) return;
    await DB.deleteCartao(id);state.cartoes=await DB.getCartoes();renderPerfil();toast('Cartão excluído','info');
  }

  async function renderCfgNotif(el){
    const cfg={
      cartao:await DB.getConfig('notif_cartao',true),cartao_dias:await DB.getConfig('notif_cartao_dias',3),
      orcamento:await DB.getConfig('notif_orcamento',true),orcamento_pct:await DB.getConfig('notif_orcamento_pct',80),
      resumo:await DB.getConfig('notif_resumo',true),semdata:await DB.getConfig('notif_semdata',true),fixos:await DB.getConfig('notif_fixos',true),
    };
    const row=(key,title,sub)=>`<div class="list-item" onclick="App._togglePanel('notif-panel-${key}')">
      <div class="list-info"><div class="list-title">${title}</div><div class="list-sub">${sub}</div></div>
      <div class="list-right"><div class="toggle ${cfg[key]?'on':''}" id="notif-toggle-${key}" onclick="event.stopPropagation();App._toggleNotif('${key}',this)">
        <div class="toggle-thumb" style="left:${cfg[key]?'20px':'2px'}"></div></div></div></div>`;
    el.innerHTML=`<div class="card">
      ${row('cartao','Vencimento do cartão','Aviso antes da fatura vencer')}
      <div class="detail-panel" id="notif-panel-cartao"><div class="detail-row"><span class="detail-label">Dias antes</span>
        <input class="detail-input" type="number" value="${cfg.cartao_dias}" min="1" max="10" onchange="DB.setConfig('notif_cartao_dias',parseInt(this.value))"></div></div>
      ${row('orcamento','Alerta de orçamento','Aviso ao atingir % dos gastos')}
      <div class="detail-panel" id="notif-panel-orcamento"><div class="detail-row"><span class="detail-label">Alertar em</span>
        <select class="detail-select" onchange="DB.setConfig('notif_orcamento_pct',parseInt(this.value))">
          ${[70,80,90,100].map(p=>`<option value="${p}" ${cfg.orcamento_pct===p?'selected':''}>${p}%</option>`).join('')}
        </select></div></div>
      ${row('resumo','Resumo mensal','Balanço no início do mês')}
      <div class="detail-panel" id="notif-panel-resumo" style="padding:10px 16px"><span style="font-size:12px;color:var(--text3)">Enviado no dia 2 de cada mês</span></div>
      ${row('semdata','Entradas sem data','Lembrete no fim do mês')}
      <div class="detail-panel" id="notif-panel-semdata" style="padding:10px 16px"><span style="font-size:12px;color:var(--text3)">Enviado no dia 28 de cada mês</span></div>
      ${row('fixos','Gastos fixos não pagos','Lembrete no fim do mês')}
      <div class="detail-panel" id="notif-panel-fixos" style="padding:10px 16px"><span style="font-size:12px;color:var(--text3)">Enviado no dia 28 de cada mês</span></div>
    </div><div style="height:8px"></div>`;
  }

  function _togglePanel(id){document.getElementById(id)?.classList.toggle('open');}
  async function _toggleNotif(key,el){
    el.classList.toggle('on');el.querySelector('.toggle-thumb').style.left=el.classList.contains('on')?'20px':'2px';
    await DB.setConfig('notif_'+key,el.classList.contains('on'));
  }

  async function renderCfgDados(el){
    const allLancs=await DB.getAllLancamentos();
    const meses=[...new Set(allLancs.map(l=>l.mesAno))].sort();
    el.innerHTML=`
      <div class="card" style="padding:20px;margin-bottom:14px">
        <div class="section-label" style="padding:0;margin-bottom:12px">Banco de dados</div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid var(--border)"><span style="font-size:13px;color:var(--text2)">Total de lançamentos</span><span style="font-size:13px;font-family:'DM Mono',monospace">${allLancs.length}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid var(--border)"><span style="font-size:13px;color:var(--text2)">Meses com dados</span><span style="font-size:13px;font-family:'DM Mono',monospace">${meses.length}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span style="font-size:13px;color:var(--text2)">Período</span><span style="font-size:13px;font-family:'DM Mono',monospace">${meses.length>0?meses[0]+' – '+meses[meses.length-1]:'—'}</span></div>
      </div>
      <button class="action-btn success" onclick="App._exportar()"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Exportar backup (JSON)</button>
      <button class="action-btn secondary" onclick="document.getElementById('import-input').click()"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Importar backup (JSON)</button>
      <input type="file" id="import-input" accept=".json" style="display:none" onchange="App._importar(this)">
      <button class="action-btn secondary" onclick="App.gotoScreen('screen-sheets')"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Importar do Google Sheets</button>
      <div style="height:8px"></div><div class="divider-line" style="margin:0 20px 8px"></div>
      <button class="action-btn danger" onclick="App._limpar()"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>Apagar todos os dados</button>
      <div class="version-tag">Finanças App · v3.0.0<br>Dados armazenados localmente neste dispositivo</div>
      <div style="height:8px"></div>`;
  }

  async function _exportar(){
    const json=await DB.exportAll();const blob=new Blob([json],{type:'application/json'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');
    a.href=url;a.download=`financas_backup_${new Date().toISOString().slice(0,10)}.json`;a.click();
    URL.revokeObjectURL(url);toast('Backup exportado!','ok');
  }
  async function _importar(input){
    const file=input.files[0];if(!file) return;
    const reader=new FileReader();
    reader.onload=async e=>{
      try{
        await DB.importAll(e.target.result);
        state.categorias=await DB.getCategorias();state.cartoes=await DB.getCartoes();
        state.lancamentos=await DB.getLancamentos(mesAnoStr(state.currentMonth,state.currentYear));
        toast('Backup importado!','ok');renderPerfil();
      }catch(err){toast('Arquivo inválido','err');}
    };
    reader.readAsText(file);
  }
  async function _limpar(){
    if(!confirm('Tem certeza? Todos os dados serão apagados.')) return;
    await DB.clearAll();await DB.seedDefaults();
    state.categorias=await DB.getCategorias();state.cartoes=await DB.getCartoes();state.lancamentos=[];
    toast('Dados apagados','info');renderPerfil();
  }

  /* ══════════════════════════════════════
     MODAL
  ══════════════════════════════════════ */
  function openModal(type,data){
    const content=document.getElementById('modal-content');
    if(type==='add-cat'||type==='edit-cat'){
      const isEdit=type==='edit-cat';
      content.innerHTML=`<div class="modal-title">${isEdit?'Editar categoria':`Nova categoria de ${data.tipo==='saida'?'saída':'entrada'}`}</div>
        <div class="field"><div class="field-label">Nome</div><input type="text" id="m-cat-nome" value="${isEdit?data.nome:''}"></div>
        ${_emojiFieldHtml(isEdit?data.emoji:'')}${_colorFieldHtml(isEdit?data.cor:'')}
        <div class="modal-btns"><button class="btn-cancel" onclick="App.closeModal()">Cancelar</button>
          <button class="btn-save" onclick="App._saveCategoria(${isEdit?data.id:'null'},'${isEdit?data.tipo:data.tipo}')">Salvar</button></div>`;
    }
    else if(type==='add-subcat'){
      content.innerHTML=`<div class="modal-title">Nova subcategoria</div>
        <div class="field"><div class="field-label">Nome</div><input type="text" id="m-subcat-nome" autofocus></div>
        ${_emojiFieldHtml('')}${_colorFieldHtml('')}
        <div class="modal-btns"><button class="btn-cancel" onclick="App.closeModal()">Cancelar</button>
          <button class="btn-save" onclick="App._saveSubcat(${data.catId},null)">Salvar</button></div>`;
    }
    else if(type==='edit-subcat'){
      content.innerHTML=`<div class="modal-title">Editar subcategoria</div>
        <div class="field"><div class="field-label">Nome</div><input type="text" id="m-subcat-nome" value="${data.sub.nome}"></div>
        ${_emojiFieldHtml(data.sub.emoji||'')}${_colorFieldHtml(data.sub.cor||'')}
        <div class="modal-btns"><button class="btn-cancel" onclick="App.closeModal()">Cancelar</button>
          <button class="btn-save" onclick="App._saveSubcat(${data.catId},${data.idx})">Salvar</button></div>`;
    }
    else if(type==='add-cartao'||type==='edit-cartao'){
      const isEdit=type==='edit-cartao';
      content.innerHTML=`<div class="modal-title">${isEdit?'Editar cartão':'Novo cartão'}</div>
        <div class="field"><div class="field-label">Nome</div><input type="text" id="m-cartao-nome" value="${isEdit?data.nome:''}"></div>
        ${_colorFieldHtml(isEdit?data.cor:'#a78bfa')}
        <div class="row2">
          <div class="field"><div class="field-label">Fechamento</div><input type="number" id="m-cartao-fech" min="1" max="28" value="${isEdit?data.fechamento:5}"></div>
          <div class="field"><div class="field-label">Vencimento</div><input type="number" id="m-cartao-venc" min="1" max="31" value="${isEdit?data.vencimento:10}"></div>
        </div>
        <div class="field"><div class="field-label">Limite total</div>
          <div class="valor-wrap"><span class="valor-prefix">R$</span>
            <input type="text" inputmode="numeric" id="m-cartao-limite" oninput="App._maskMoney(this)"
              value="${isEdit?(data.limite||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):''}">
          </div></div>
        <div class="modal-btns"><button class="btn-cancel" onclick="App.closeModal()">Cancelar</button>
          <button class="btn-save" onclick="App._saveCartao(${isEdit?data.id:'null'})">Salvar</button></div>`;
    }
    else if(type==='confirm-delete-parcelas'){
      content.innerHTML=`<div class="modal-title">Excluir compra parcelada</div>
        <p style="font-size:14px;color:var(--text2);line-height:1.6;margin-bottom:20px">Esta compra tem ${data.totalParcelas} parcelas. Excluir todas ou só esta?</p>
        <div class="modal-btns" style="flex-direction:column">
          <button class="btn-save" style="background:var(--red);margin-bottom:8px" onclick="App._deletarTodasParcelas(${data.grupoId})">Excluir todas as ${data.totalParcelas} parcelas</button>
          <button class="btn-cancel" style="margin-bottom:8px" onclick="App._deletarUmaParcela(${data.id})">Só esta parcela</button>
          <button class="btn-cancel" onclick="App.closeModal()">Cancelar</button>
        </div>`;
    }
    else if(type==='confirm-delete-fixo'){
      const isEntradaFixa=data.fixo||false;
      content.innerHTML=`<div class="modal-title">Excluir ${isEntradaFixa?'entrada fixa':'gasto fixo'} recorrente</div>
        <p style="font-size:14px;color:var(--text2);line-height:1.6;margin-bottom:20px">Este lançamento se repete mensalmente. Excluir apenas este mês ou todos os meses seguintes?</p>
        <div class="modal-btns" style="flex-direction:column">
          <button class="btn-save" style="background:var(--red);margin-bottom:8px" onclick="App._deletarFixoTemplate(${data.templateId},${data.id})">Excluir de todos os meses seguintes</button>
          <button class="btn-cancel" style="margin-bottom:8px" onclick="App._deletarUmFixo(${data.id})">Só este mês</button>
          <button class="btn-cancel" onclick="App.closeModal()">Cancelar</button>
        </div>`;
    }
    document.getElementById('modal-overlay').classList.add('open');
  }

  function closeModal(e){
    if(!e||e.target===document.getElementById('modal-overlay'))
      document.getElementById('modal-overlay').classList.remove('open');
  }

  async function _saveCategoria(id,tipo){
    const nome=document.getElementById('m-cat-nome')?.value?.trim();
    if(!nome){toast('Informe o nome','err');return;}
    const emoji=document.getElementById('m-emoji')?.value?.trim()||'📦';
    const cor=document.getElementById('m-cor-custom')?.value||'#9ca3af';
    const existing=id!==null?getCatById(id):null;
    const obj=existing?{...existing,nome,emoji,cor}:{tipo,nome,emoji,cor,subcats:[]};
    if(id!==null) obj.id=id;
    await DB.saveCategoria(obj);state.categorias=await DB.getCategorias();
    closeModal();renderPerfil();toast(id!==null?'Categoria atualizada':'Categoria criada','ok');
  }
  async function _saveSubcat(catId,idx){
    const nome=document.getElementById('m-subcat-nome')?.value?.trim();
    if(!nome){toast('Informe o nome','err');return;}
    const emoji=document.getElementById('m-emoji')?.value?.trim()||'';
    const cor=document.getElementById('m-cor-custom')?.value||'#9ca3af';
    const cat=getCatById(catId);if(!cat) return;
    if(!cat.subcats) cat.subcats=[];
    if(idx===null||idx===undefined) cat.subcats.push({nome,emoji,cor});
    else cat.subcats[idx]={nome,emoji,cor};
    await DB.saveCategoria(cat);state.categorias=await DB.getCategorias();
    closeModal();renderPerfil();toast('Subcategoria salva','ok');
  }
  async function _saveCartao(id){
    const nome=document.getElementById('m-cartao-nome')?.value?.trim();
    if(!nome){toast('Informe o nome','err');return;}
    const cor=document.getElementById('m-cor-custom')?.value||'#a78bfa';
    const fechamento=parseInt(document.getElementById('m-cartao-fech')?.value||5);
    const vencimento=parseInt(document.getElementById('m-cartao-venc')?.value||10);
    const limite=parseMoneyInput(document.getElementById('m-cartao-limite')?.value||'0');
    const existing=id!==null?getCartaoById(id):null;
    const obj=existing?{...existing,nome,cor,fechamento,vencimento,limite}:{nome,cor,fechamento,vencimento,limite};
    if(id!==null) obj.id=id;
    await DB.saveCartao(obj);state.cartoes=await DB.getCartoes();
    closeModal();renderPerfil();toast(id!==null?'Cartão atualizado':'Cartão adicionado','ok');
  }
  // Cria/atualiza o template de "fatura" automático do cartão
  async function _sincronizarFaturaTemplate(cartaoId) {
    const templates = await DB.getFixosTemplates();
    // Remover template de fatura antigo deste cartão
    const antigo = templates.find(t => t.faturaCartaoId === cartaoId);
    if (antigo) await DB.deleteFixoTemplate(antigo.id);
    // Criar novo template (será atualizado mensalmente)
    const tmplId = await DB.saveFixoTemplate({
      tipo: 'fatura_cartao',
      faturaCartaoId: cartaoId,
      categoriaId: null,
      descricao: null,
      valor: 0, // será calculado dinamicamente
      pagamento: String(cartaoId),
      cartaoId: cartaoId,
      mesAnoMinimo: mesAnoStr(new Date().getMonth(), new Date().getFullYear()),
      autoFatura: true,
    });
    return tmplId;
  }

  async function _deletarTodasParcelas(grupoId){
    const allLancs=await DB.getAllLancamentos();
    for(const l of allLancs.filter(l=>l.grupoId===grupoId)) await DB.deleteLancamento(l.id);
    state.lancamentos=await DB.getLancamentos(mesAnoStr(state.currentMonth,state.currentYear));
    closeModal();toast('Todas as parcelas excluídas','info');goBack();
  }
  async function _deletarUmaParcela(id){
    await DB.deleteLancamento(id);
    state.lancamentos=await DB.getLancamentos(mesAnoStr(state.currentMonth,state.currentYear));
    closeModal();toast('Parcela excluída','info');goBack();
  }
  async function _deletarFixoTemplate(templateId,id){
    await DB.deleteFixoTemplate(templateId);
    const allLancs=await DB.getAllLancamentos();
    const mesAtual=mesAnoStr(state.currentMonth,state.currentYear);
    for(const l of allLancs.filter(l=>l.templateId===templateId&&l.mesAno>=mesAtual))
      await DB.deleteLancamento(l.id);
    state.lancamentos=await DB.getLancamentos(mesAtual);
    closeModal();toast('Removido de todos os meses','info');goBack();
  }
  async function _deletarUmFixo(id){
    await DB.deleteLancamento(id);
    state.lancamentos=await DB.getLancamentos(mesAnoStr(state.currentMonth,state.currentYear));
    closeModal();toast('Excluído deste mês','info');goBack();
  }

  /* ══════════════════════════════════════
     INIT
  ══════════════════════════════════════ */
  async function init(){
    await DB.open();
    await DB.seedDefaults();
    await loadData();
    gotoScreen('screen-home',false);
  }

  return {
    gotoScreen,goBack,novoLancamento,changeMonth,
    renderHome,renderLancamentos,renderRelatorios,renderPerfil,
    setLancTab,setLancSubTab,editLancamento,toggleFixoPago,
    abrirCartao,abrirFiltroCategoria,_toggleFiltroItem,limparFiltroCategoria,
    setTipoLanc,_maskMoney,_selCat,_selSubcat,_selPay,_selCartao,_updateParcelas,
    _salvar,_deletar,_deletarTodasParcelas,_deletarUmaParcela,_deletarFixoTemplate,_deletarUmFixo,
    setRelTab,_setRelPeriodo,
    setCfgTab,_toggleCatRow,
    _openAddCat,_openEditCat,_deleteCategoria,_openAddSubcat,_openEditSubcat,_deleteSubcat,
    _openAddCartao,_editCartao,_deleteCartao,_updateCartao,
    _toggleNotif,_togglePanel,_exportar,_importar,_limpar,
    openModal,closeModal,_selColor,_onCustomColor,
    _saveCategoria,_saveSubcat,_saveCartao,
    init,
  };
})();
App.init();
