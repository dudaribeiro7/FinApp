/* ═══════════════════════════════════════════
   app.js — lógica principal do Finanças PWA
═══════════════════════════════════════════ */

const App = (() => {

  /* ── Estado global ─────────────────────── */
  const state = {
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear(),
    currentScreen: 'screen-home',
    prevScreen: null,
    tipoLanc: 'entrada',
    lancTab: 'todos',
    relTab: 'mensal',
    cfgTab: 'categorias',
    editingId: null,
    // dados em cache
    lancamentos: [],
    categorias: [],
    cartoes: [],
  };

  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  /* ── Utilitários ───────────────────────── */

  function mesAnoStr(m, y) {
    return `${String(m + 1).padStart(2, '0')}-${y}`;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function fmtMoney(v, sign = false) {
    if (v === undefined || v === null || isNaN(v)) return 'R$0,00';
    const s = sign && v > 0 ? '+' : '';
    return s + 'R$' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtMoneyShort(v) {
    if (v >= 1000) return 'R$' + (v / 1000).toFixed(1).replace('.', ',') + 'k';
    return 'R$' + v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function parseMoneyInput(s) {
    if (!s) return 0;
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  }

  function maskMoney(el) {
    let v = el.value.replace(/\D/g, '');
    if (!v) { el.value = ''; return; }
    v = v.slice(0, 10);
    const parts = (parseInt(v, 10) / 100).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    el.value = parts[0] + ',' + parts[1];
  }

  function calcPrimeiraFatura(dataCompra, fechamento) {
    const d = new Date(dataCompra + 'T12:00:00');
    if (d.getDate() >= fechamento) d.setMonth(d.getMonth() + 1);
    return d;
  }

  function isDateConfirmed(dateStr) {
    if (!dateStr) return false;
    return new Date(dateStr + 'T23:59:59') <= new Date();
  }

  function getCatById(id) {
    return state.categorias.find(c => c.id === id);
  }

  function getCartaoById(id) {
    return state.cartoes.find(c => c.id === id);
  }

  function getCatByNome(nome) {
    return state.categorias.find(c => c.nome === nome);
  }

  /* ── Toast ─────────────────────────────── */
  let toastTimer;
  function toast(msg, type = 'ok', dur = 2200) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), dur);
  }

  /* ── Relógio ────────────────────────────── */
  function updateClock() {
    const now = new Date();
    const t = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    ['clock','clock2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = t;
    });
  }

  /* ── Navegação ─────────────────────────── */
  function gotoScreen(id, save = true) {
    if (save && state.currentScreen !== id) state.prevScreen = state.currentScreen;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    state.currentScreen = id;

    // nav bar
    const navMap = {
      'screen-home': 'nav-home',
      'screen-lancamentos': 'nav-lancamentos',
      'screen-relatorios': 'nav-relatorios',
      'screen-perfil': 'nav-perfil',
    };
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (navMap[id]) document.getElementById(navMap[id])?.classList.add('active');

    // fab visibility
    const noFab = ['screen-novo'];
    document.getElementById('fab').style.display = noFab.includes(id) ? 'none' : '';

    // render content
    if (id === 'screen-home') renderHome();
    if (id === 'screen-lancamentos') renderLancamentos();
    if (id === 'screen-relatorios') renderRelatorios();
    if (id === 'screen-perfil') renderPerfil();
  }

  function goBack() {
    gotoScreen(state.prevScreen || 'screen-home');
  }

  /* ── Carregar dados ─────────────────────── */
  async function loadData() {
    [state.categorias, state.cartoes] = await Promise.all([
      DB.getCategorias(), DB.getCartoes()
    ]);
    state.lancamentos = await DB.getLancamentos(mesAnoStr(state.currentMonth, state.currentYear));
  }

  /* ── Mês ────────────────────────────────── */
  async function changeMonth(dir) {
    state.currentMonth += dir;
    if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
    if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
    state.lancamentos = await DB.getLancamentos(mesAnoStr(state.currentMonth, state.currentYear));
    const label = `${MONTHS[state.currentMonth]} ${state.currentYear}`;
    const el1 = document.getElementById('home-month-label');
    const el2 = document.getElementById('lanc-month-label');
    if (el1) el1.textContent = label;
    if (el2) el2.textContent = label;
    if (state.currentScreen === 'screen-home') renderHome();
    if (state.currentScreen === 'screen-lancamentos') renderLancamentos();
  }

  /* ══════════════════════════════════════════
     RENDER: HOME
  ══════════════════════════════════════════ */
  function renderHome() {
    const lancs = state.lancamentos;
    const today = new Date();

    // entradas confirmadas
    const entradas = lancs.filter(l => l.tipo === 'entrada' && isDateConfirmed(l.data));
    const entradasPend = lancs.filter(l => l.tipo === 'entrada' && !isDateConfirmed(l.data));
    const totalEntradas = entradas.reduce((s, l) => s + (l.valor || 0), 0);
    const totalPend = entradasPend.reduce((s, l) => s + (l.valor || 0), 0);
    const totalEntradasSemData = entradasPend.filter(l => !l.data).length;

    // saídas
    const debitos = lancs.filter(l => l.tipo === 'debito').reduce((s, l) => s + (l.valor || 0), 0);
    const fixosPagos = lancs.filter(l => l.tipo === 'fixo' && l.pago).reduce((s, l) => s + (l.valor || 0), 0);

    // crédito por cartão
    const creditoPorCartao = {};
    state.cartoes.forEach(c => creditoPorCartao[c.id] = 0);
    lancs.filter(l => l.tipo === 'credito').forEach(l => {
      if (l.cartaoId && creditoPorCartao[l.cartaoId] !== undefined) {
        creditoPorCartao[l.cartaoId] += l.valorParcela || 0;
      }
    });
    const totalCredito = Object.values(creditoPorCartao).reduce((s, v) => s + v, 0);
    const totalSaidas = debitos + fixosPagos + totalCredito;

    // saldo
    const saldoIni = parseFloat(localStorage.getItem(`saldo_ini_${mesAnoStr(state.currentMonth, state.currentYear)}`) || 0);
    const dinheiro = parseFloat(localStorage.getItem(`dinheiro_${mesAnoStr(state.currentMonth, state.currentYear)}`) || 0);
    const reserva = lancs.filter(l => l.tipo === 'reserva').reduce((s, l) => s + (l.valor || 0), 0);
    const conta = saldoIni + totalEntradas - totalSaidas - reserva;
    const saldoFinal = conta + dinheiro;

    // labels
    document.getElementById('home-month-label').textContent = `${MONTHS[state.currentMonth]} ${state.currentYear}`;
    document.getElementById('h-saldo-final').textContent = Math.abs(saldoFinal).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2});
    document.getElementById('h-saldo-ini').textContent = saldoIni.toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2});
    document.getElementById('h-dinheiro').textContent = dinheiro.toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2});
    document.getElementById('h-conta').textContent = conta.toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2});

    // metrics
    const mEntEl = document.getElementById('h-entradas');
    mEntEl.textContent = fmtMoneyShort(totalEntradas);
    document.getElementById('h-entradas-sub').textContent = `${entradas.length} lançamento${entradas.length!==1?'s':''}`;
    const pendEl = document.getElementById('h-entradas-pending');
    if (totalPend > 0) {
      pendEl.style.display = '';
      pendEl.textContent = `+${fmtMoneyShort(totalPend)} pendente`;
    } else pendEl.style.display = 'none';

    document.getElementById('h-saidas').textContent = fmtMoneyShort(totalSaidas);
    const nSaidas = lancs.filter(l => ['debito','fixo','credito'].includes(l.tipo)).length;
    document.getElementById('h-saidas-sub').textContent = `${nSaidas} lançamento${nSaidas!==1?'s':''}`;
    document.getElementById('h-conta-val').textContent = fmtMoneyShort(conta);
    document.getElementById('h-reserva').textContent = fmtMoneyShort(reserva);

    // progresso
    const pctEl = document.getElementById('h-prog-pct');
    const fillEl = document.getElementById('h-prog-fill');
    const hintEl = document.getElementById('h-prog-hint');
    if (totalEntradas > 0) {
      const pct = Math.min((totalSaidas / totalEntradas) * 100, 100);
      pctEl.textContent = pct.toFixed(0) + '%';
      pctEl.style.color = pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--amber)' : 'var(--green)';
      fillEl.style.width = pct + '%';
      hintEl.textContent = '';
    } else {
      pctEl.textContent = '—';
      fillEl.style.width = '0%';
      hintEl.textContent = totalPend > 0
        ? 'Aguardando entradas confirmadas'
        : 'Nenhuma entrada confirmada';
    }

    // alert de entradas sem data
    const alertEl = document.getElementById('home-alert');
    if (totalEntradasSemData > 0) {
      alertEl.style.display = '';
      alertEl.innerHTML = `
        <div class="alert-banner">
          <div class="alert-icon"><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
          <div class="alert-text"><strong>${totalEntradasSemData} entrada${totalEntradasSemData>1?'s':''} sem data</strong> — não serão contabilizadas até receber uma data</div>
        </div>`;
    } else {
      alertEl.style.display = 'none';
    }

    // cartões
    const cartaoEl = document.getElementById('h-cartoes');
    if (state.cartoes.length === 0) {
      cartaoEl.innerHTML = '<div style="padding:0 0 8px;font-size:13px;color:var(--text3)">Nenhum cartão cadastrado</div>';
    } else {
      cartaoEl.innerHTML = state.cartoes.map(c => {
        const usado = creditoPorCartao[c.id] || 0;
        const pct = c.limite ? Math.min((usado / c.limite) * 100, 100) : 0;
        return `
          <div class="cartao-chip">
            <div class="cartao-band" style="background:${c.cor}"></div>
            <div class="cartao-chip-info">
              <div class="cartao-chip-nome">${c.nome}</div>
              <div class="cartao-chip-venc">Vence dia ${c.vencimento}</div>
              <div class="cartao-mini-bar"><div class="cartao-mini-fill" style="width:${pct}%;background:${c.cor}"></div></div>
            </div>
            <div class="cartao-chip-vals">
              <div class="cartao-chip-usado" style="color:${c.cor}">${fmtMoneyShort(usado)}</div>
              <div class="cartao-chip-limite">/ ${c.limite ? fmtMoneyShort(c.limite) : '—'}</div>
            </div>
          </div>`;
      }).join('');
    }

    // feed
    const feedEl = document.getElementById('h-feed');
    const recentes = [...lancs].sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0)).slice(0, 6);
    if (recentes.length === 0) {
      feedEl.innerHTML = '<div class="empty-state" style="padding:24px 0"><div class="empty-icon">💸</div><div class="empty-title">Nenhum lançamento</div><div class="empty-sub">Toque no + para adicionar</div></div>';
    } else {
      feedEl.innerHTML = recentes.map(l => renderFeedItem(l)).join('');
    }
  }

  function renderFeedItem(l) {
    const cat = getCatById(l.categoriaId);
    const isEntrada = l.tipo === 'entrada';
    const isFixo = l.tipo === 'fixo';
    const isCredito = l.tipo === 'credito';
    const cartao = isCredito ? getCartaoById(l.cartaoId) : null;

    const cor = isEntrada ? 'var(--green)' : isFixo ? 'var(--amber)' : 'var(--red)';
    const bgCor = isEntrada ? 'var(--green-dim)' : isFixo ? 'var(--amber-dim)' : 'var(--red-dim)';
    const sinal = isEntrada ? '+' : '-';
    const valor = isCredito ? l.valorParcela : l.valor;

    const semData = isEntrada && !l.data;
    const pendente = isEntrada && l.data && !isDateConfirmed(l.data);
    const dataTxt = l.data ? new Date(l.data + 'T12:00:00').toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit'}) : '';

    let subText = cat ? `${cat.emoji} ${cat.nome}` : l.tipo;
    if (l.subcat) subText += ` · ${l.subcat}`;
    if (isCredito && cartao) subText += ` · ${cartao.nome}`;
    if (isCredito && l.parcela && l.totalParcelas) subText += ` · ${l.parcela}/${l.totalParcelas}`;
    if (dataTxt) subText += ` · ${dataTxt}`;
    if (isFixo) subText += l.pago ? ' · pago' : ' · não pago';

    const badge = semData ? '<span class="badge badge-nodate">sem data</span>' :
                  pendente ? '<span class="badge badge-pending">pendente</span>' : '';

    return `
      <div class="feed-item" onclick="App.editLancamento(${l.id})">
        <div class="feed-icon" style="background:${bgCor}">
          ${isEntrada ? `<svg viewBox="0 0 24 24" style="stroke:${cor}"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`
                      : `<svg viewBox="0 0 24 24" style="stroke:${cor}"><path d="M7 17L17 7M7 7h10v10"/></svg>`}
        </div>
        <div class="feed-info">
          <div class="feed-nome">${l.descricao || cat?.nome || l.tipo}</div>
          <div class="feed-cat">${subText}</div>
        </div>
        <div class="feed-right">
          <div class="feed-val" style="color:${semData||pendente?'var(--text3)':cor}">${sinal}${fmtMoneyShort(valor||0)}</div>
          ${badge}
        </div>
      </div>`;
  }

  /* ══════════════════════════════════════════
     RENDER: LANÇAMENTOS
  ══════════════════════════════════════════ */
  function setLancTab(tab) {
    state.lancTab = tab;
    ['todos','entradas','saidas','fixos'].forEach(t => {
      document.getElementById('lt-'+t)?.classList.toggle('active', t === tab);
    });
    renderLancamentos();
  }

  function renderLancamentos() {
    document.getElementById('lanc-month-label').textContent = `${MONTHS[state.currentMonth]} ${state.currentYear}`;
    let lancs = [...state.lancamentos].sort((a, b) => {
      const da = a.data || '9999-12-31';
      const db2 = b.data || '9999-12-31';
      return db2.localeCompare(da);
    });
    if (state.lancTab === 'entradas') lancs = lancs.filter(l => l.tipo === 'entrada');
    if (state.lancTab === 'saidas') lancs = lancs.filter(l => ['debito','credito'].includes(l.tipo));
    if (state.lancTab === 'fixos') lancs = lancs.filter(l => l.tipo === 'fixo');

    const el = document.getElementById('lanc-feed');
    if (lancs.length === 0) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">Nenhum lançamento</div><div class="empty-sub">Toque no + para adicionar seu primeiro lançamento do mês</div></div>`;
      return;
    }
    el.innerHTML = lancs.map(l => renderFeedItem(l)).join('');
  }

  /* ══════════════════════════════════════════
     RENDER: NOVO / EDITAR LANÇAMENTO
  ══════════════════════════════════════════ */
  function setTipoLanc(tipo) {
    state.tipoLanc = tipo;
    document.querySelectorAll('.type-tab').forEach(t => {
      t.className = 'type-tab' + (t.dataset.type === tipo ? ` active-${tipo}` : '');
    });
    const titles = { entrada: 'Nova entrada', fixo: 'Novo gasto fixo', debito: 'Nova saída (débito)', credito: 'Nova compra (crédito)' };
    document.getElementById('novo-title').textContent = state.editingId ? titles[tipo].replace('Novo','Editar').replace('Nova','Editar') : titles[tipo];
    renderForm();
  }

  function renderForm() {
    const tipo = state.tipoLanc;
    const cats = state.categorias.filter(c => tipo === 'entrada' ? c.tipo === 'entrada' : c.tipo === 'saida');
    const today = todayStr();
    const el = document.getElementById('form-body');

    // buscar dados se editando
    let edit = null;
    if (state.editingId) {
      edit = state.lancamentos.find(l => l.id === state.editingId);
    }

    const catSel = edit?.categoriaId || (cats[0]?.id);
    const catSelObj = getCatById(catSel);

    const campoValor = `
      <div class="field">
        <div class="field-label">Valor</div>
        <div class="valor-wrap">
          <span class="valor-prefix">R$</span>
          <input type="text" inputmode="numeric" placeholder="0,00" id="f-valor"
            oninput="App._maskMoney(this)"
            value="${edit ? (edit.valor||edit.valorTotal||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}">
        </div>
      </div>`;

    const campoCat = `
      <div class="field">
        <div class="field-label">Categoria</div>
        <div class="cat-grid" id="cat-grid">
          ${cats.map(c => `
            <div class="cat-chip ${c.id === catSel ? 'sel' : ''}" onclick="App._selCat(${c.id})" data-catid="${c.id}">
              <div class="cat-emoji">${c.emoji}</div>
              <div class="cat-name">${c.nome}</div>
            </div>`).join('')}
        </div>
        <div class="subcat-row" id="subcat-row">
          ${catSelObj?.subcats?.map(s => `<div class="subcat-chip ${s === edit?.subcat ? 'sel' : ''}" onclick="App._selSubcat(this,'${s}')">${s}</div>`).join('') || ''}
        </div>
      </div>`;

    const campoDescricao = `
      <div class="field">
        <div class="field-label">Descrição <span class="opt-badge">opcional</span></div>
        <input type="text" id="f-desc" value="${edit?.descricao || ''}">
      </div>`;

    if (tipo === 'entrada') {
      el.innerHTML = `
        ${campoValor}
        ${campoCat}
        <div class="field">
          <div class="field-label">Data <span class="opt-badge">opcional</span></div>
          <input type="date" id="f-data" value="${edit?.data || today}">
        </div>
        ${campoDescricao}
        <button class="submit-btn btn-entrada" onclick="App._salvar()">
          ${state.editingId ? 'Salvar alterações' : 'Salvar entrada'}
        </button>
        ${state.editingId ? `<button class="submit-btn" style="background:var(--red-dim);color:var(--red);margin-top:8px" onclick="App._deletar()">Excluir lançamento</button>` : ''}
        <div style="height:20px"></div>`;
    }

    else if (tipo === 'fixo') {
      const cartoes = state.cartoes;
      const tipoSel = edit?.pagamento || 'debito';
      el.innerHTML = `
        ${campoValor}
        <div class="field">
          <div class="field-label">Tipo de pagamento</div>
          <div class="payment-grid" id="payment-grid">
            <div class="payment-chip ${tipoSel==='debito'?'sel':''}" data-pay="debito" onclick="App._selPay(this,'debito')">
              <div class="payment-dot" style="background:var(--blue)"></div>
              <div><div class="payment-name">Débito</div><div class="payment-sub">Conta corrente</div></div>
            </div>
            ${cartoes.map(c => `
              <div class="payment-chip ${tipoSel===String(c.id)?'sel':''}" data-pay="${c.id}" onclick="App._selPay(this,${c.id})">
                <div class="payment-dot" style="background:${c.cor}"></div>
                <div><div class="payment-name">${c.nome}</div><div class="payment-sub">Crédito</div></div>
              </div>`).join('')}
          </div>
        </div>
        ${campoCat}
        <div class="field">
          <div class="field-label">Pago este mês?</div>
          <div class="toggle-field">
            <span class="toggle-label">Marcar como pago</span>
            <div class="toggle ${edit?.pago?'on':''}" id="toggle-pago" onclick="this.classList.toggle('on');this.querySelector('.toggle-thumb').style.left=this.classList.contains('on')?'20px':'2px'">
              <div class="toggle-thumb" style="left:${edit?.pago?'20px':'2px'}"></div>
            </div>
          </div>
        </div>
        ${campoDescricao}
        <button class="submit-btn btn-fixo" onclick="App._salvar()">
          ${state.editingId ? 'Salvar alterações' : 'Salvar gasto fixo'}
        </button>
        ${state.editingId ? `<button class="submit-btn" style="background:var(--red-dim);color:var(--red);margin-top:8px" onclick="App._deletar()">Excluir lançamento</button>` : ''}
        <div style="height:20px"></div>`;
    }

    else if (tipo === 'debito') {
      el.innerHTML = `
        ${campoValor}
        ${campoCat}
        <div class="field">
          <div class="field-label">Data</div>
          <input type="date" id="f-data" value="${edit?.data || today}">
        </div>
        ${campoDescricao}
        <button class="submit-btn btn-debito" onclick="App._salvar()">
          ${state.editingId ? 'Salvar alterações' : 'Salvar saída'}
        </button>
        ${state.editingId ? `<button class="submit-btn" style="background:var(--red-dim);color:var(--red);margin-top:8px" onclick="App._deletar()">Excluir lançamento</button>` : ''}
        <div style="height:20px"></div>`;
    }

    else if (tipo === 'credito') {
      const cartoes = state.cartoes;
      const cartaoSel = edit?.cartaoId || cartoes[0]?.id;
      el.innerHTML = `
        <div class="field">
          <div class="field-label">Valor total</div>
          <div class="valor-wrap">
            <span class="valor-prefix">R$</span>
            <input type="text" inputmode="numeric" placeholder="0,00" id="f-valor"
              oninput="App._maskMoney(this);App._updateParcelas()"
              value="${edit ? (edit.valorTotal||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}">
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <div class="field-label">Parcelas</div>
            <select id="f-parcelas" onchange="App._updateParcelas()">
              ${[1,2,3,4,5,6,7,8,9,10,11,12].map(n => `<option value="${n}" ${(edit?.totalParcelas||1)===n?'selected':''}>${n===1?'1x (à vista)':n+'x'}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <div class="field-label">Data da compra</div>
            <input type="date" id="f-data" value="${edit?.data || today}" oninput="App._updateParcelas()">
          </div>
        </div>
        <div id="parcelas-preview" style="display:none"></div>
        <div class="field">
          <div class="field-label">Cartão</div>
          <div class="payment-grid" id="cartao-grid">
            ${cartoes.map(c => `
              <div class="payment-chip ${c.id===cartaoSel?'sel':''}" data-cartao="${c.id}" onclick="App._selCartao(this,${c.id})">
                <div class="payment-dot" style="background:${c.cor}"></div>
                <div><div class="payment-name">${c.nome}</div><div class="payment-sub">Fecha dia ${c.fechamento}</div></div>
              </div>`).join('')}
          </div>
        </div>
        ${campoCat}
        ${campoDescricao}
        <button class="submit-btn btn-credito" onclick="App._salvar()">
          ${state.editingId ? 'Salvar alterações' : 'Salvar compra'}
        </button>
        ${state.editingId ? `<button class="submit-btn" style="background:var(--red-dim);color:var(--red);margin-top:8px" onclick="App._deletar()">Excluir lançamento</button>` : ''}
        <div style="height:20px"></div>`;

      // atualizar preview
      setTimeout(() => _updateParcelas(), 50);
    }

    // restaurar seleção de categoria e subcat
    if (edit) {
      setTimeout(() => {
        if (edit.categoriaId) _selCat(edit.categoriaId, true);
        if (edit.subcat) {
          document.querySelectorAll('#subcat-row .subcat-chip').forEach(el => {
            el.classList.toggle('sel', el.textContent.trim() === edit.subcat);
          });
        }
      }, 50);
    }
  }

  // helpers para o formulário
  function _maskMoney(el) { maskMoney(el); }

  function _selCat(id, silent = false) {
    document.querySelectorAll('#cat-grid .cat-chip').forEach(el => {
      el.classList.toggle('sel', parseInt(el.dataset.catid) === id);
    });
    const cat = getCatById(id);
    const subRow = document.getElementById('subcat-row');
    if (!subRow) return;
    if (cat?.subcats?.length) {
      subRow.innerHTML = cat.subcats.map(s => `<div class="subcat-chip" onclick="App._selSubcat(this,'${s}')">${s}</div>`).join('');
    } else {
      subRow.innerHTML = '';
    }
  }

  function _selSubcat(el, name) {
    document.querySelectorAll('#subcat-row .subcat-chip').forEach(c => c.classList.remove('sel'));
    el.classList.add('sel');
  }

  function _selPay(el, val) {
    document.querySelectorAll('#payment-grid .payment-chip').forEach(c => c.classList.remove('sel'));
    el.classList.add('sel');
  }

  function _selCartao(el, id) {
    document.querySelectorAll('#cartao-grid .payment-chip').forEach(c => c.classList.remove('sel'));
    el.classList.add('sel');
    _updateParcelas();
  }

  function _updateParcelas() {
    const valEl = document.getElementById('f-valor');
    const numEl = document.getElementById('f-parcelas');
    const dataEl = document.getElementById('f-data');
    const prevEl = document.getElementById('parcelas-preview');
    if (!valEl || !numEl || !prevEl) return;

    const val = parseMoneyInput(valEl.value);
    const n = parseInt(numEl.value) || 1;
    const data = dataEl?.value || todayStr();

    if (val <= 0) { prevEl.style.display = 'none'; return; }
    prevEl.style.display = '';

    // cartão selecionado
    const cartaoEl = document.querySelector('#cartao-grid .payment-chip.sel');
    const cartaoId = cartaoEl ? parseInt(cartaoEl.dataset.cartao) : state.cartoes[0]?.id;
    const cartao = getCartaoById(cartaoId);
    const fechamento = cartao?.fechamento || 5;
    const vencimento = cartao?.vencimento || 10;

    const primeira = calcPrimeiraFatura(data, fechamento);
    const parcela = val / n;
    const diaCompra = new Date(data + 'T12:00:00').getDate();
    const entrou = diaCompra < fechamento ? 'fatura atual' : 'fatura do próximo mês';

    let rows = '';
    for (let i = 0; i < Math.min(n, 6); i++) {
      const d = new Date(primeira);
      d.setMonth(d.getMonth() + i);
      rows += `<div class="parcela-row"><span class="parcela-mes">${i+1}/${n} · ${MONTHS[d.getMonth()]}/${d.getFullYear()}</span><span class="parcela-val">${fmtMoney(parcela)}</span></div>`;
    }
    if (n > 6) rows += `<div class="parcela-row"><span class="parcela-mes" style="color:var(--text3)">+ ${n-6} parcelas seguintes...</span></div>`;
    rows += `<div class="parcela-info">Compra dia ${diaCompra} · fecha dia ${fechamento} · entra na ${entrou} · vence dia ${vencimento}</div>`;

    prevEl.innerHTML = `<div class="parcelas-box"><div class="parcelas-box-title">Distribuição das parcelas</div>${rows}</div>`;
  }

  function _getSelectedCatId() {
    const sel = document.querySelector('#cat-grid .cat-chip.sel');
    return sel ? parseInt(sel.dataset.catid) : null;
  }

  function _getSelectedSubcat() {
    const sel = document.querySelector('#subcat-row .subcat-chip.sel');
    return sel ? sel.textContent.trim() : null;
  }

  async function _salvar() {
    const tipo = state.tipoLanc;
    const valor = parseMoneyInput(document.getElementById('f-valor')?.value || '0');
    if (!valor) { toast('Informe o valor', 'err'); return; }

    const catId = _getSelectedCatId();
    const subcat = _getSelectedSubcat();
    const desc = document.getElementById('f-desc')?.value?.trim() || '';
    const data = document.getElementById('f-data')?.value || '';

    const mesAno = mesAnoStr(state.currentMonth, state.currentYear);
    let obj = { tipo, categoriaId: catId, subcat, descricao: desc, mesAno };

    if (tipo === 'entrada') {
      obj.valor = valor;
      obj.data = data;
    }

    else if (tipo === 'fixo') {
      obj.valor = valor;
      const paySel = document.querySelector('#payment-grid .payment-chip.sel');
      obj.pagamento = paySel ? paySel.dataset.pay : 'debito';
      obj.cartaoId = obj.pagamento === 'debito' ? null : parseInt(obj.pagamento);
      obj.pago = document.getElementById('toggle-pago')?.classList.contains('on') || false;
    }

    else if (tipo === 'debito') {
      obj.valor = valor;
      obj.data = data;
    }

    else if (tipo === 'credito') {
      const n = parseInt(document.getElementById('f-parcelas')?.value || '1');
      const cartaoEl = document.querySelector('#cartao-grid .payment-chip.sel');
      const cartaoId = cartaoEl ? parseInt(cartaoEl.dataset.cartao) : state.cartoes[0]?.id;
      const cartao = getCartaoById(cartaoId);
      const fechamento = cartao?.fechamento || 5;
      const primeira = calcPrimeiraFatura(data, fechamento);
      const valorParcela = valor / n;

      if (state.editingId) {
        // edição: atualiza só o registro atual
        obj.valorTotal = valor;
        obj.totalParcelas = n;
        obj.valorParcela = valorParcela;
        obj.cartaoId = cartaoId;
        obj.data = data;
      } else {
        // novo: cria uma entrada por parcela
        const allLancs = await DB.getAllLancamentos();
        const grupoId = Date.now();
        for (let i = 0; i < n; i++) {
          const d = new Date(primeira);
          d.setMonth(d.getMonth() + i);
          const ma = mesAnoStr(d.getMonth(), d.getFullYear());
          await DB.addLancamento({
            tipo: 'credito', categoriaId: catId, subcat, descricao: desc,
            mesAno: ma, valorTotal: valor, totalParcelas: n, valorParcela: valorParcela,
            parcela: i + 1, cartaoId, data, grupoId,
          });
        }
        state.lancamentos = await DB.getLancamentos(mesAno);
        toast(`Compra salva — ${n} parcela${n>1?'s':''} distribuídas`, 'ok');
        goBack();
        return;
      }
    }

    if (state.editingId) {
      obj.id = state.editingId;
      const orig = state.lancamentos.find(l => l.id === state.editingId);
      if (orig) { obj.criadoEm = orig.criadoEm; obj.grupoId = orig.grupoId; }
      await DB.updateLancamento(obj);
      toast('Lançamento atualizado!', 'ok');
    } else {
      await DB.addLancamento(obj);
      toast('Lançamento salvo!', 'ok');
    }

    state.lancamentos = await DB.getLancamentos(mesAno);
    goBack();
  }

  async function _deletar() {
    if (!state.editingId) return;
    const lanc = state.lancamentos.find(l => l.id === state.editingId);

    // se for crédito parcelado, perguntar se deleta todas as parcelas
    if (lanc?.tipo === 'credito' && lanc.grupoId && lanc.totalParcelas > 1) {
      openModal('confirm-delete-parcelas', lanc);
      return;
    }

    await DB.deleteLancamento(state.editingId);
    state.lancamentos = await DB.getLancamentos(mesAnoStr(state.currentMonth, state.currentYear));
    toast('Lançamento excluído', 'info');
    goBack();
  }

  function editLancamento(id) {
    state.editingId = id;
    const l = state.lancamentos.find(x => x.id === id);
    if (!l) return;
    gotoScreen('screen-novo');
    setTipoLanc(l.tipo);
  }

  /* ══════════════════════════════════════════
     RENDER: RELATÓRIOS
  ══════════════════════════════════════════ */
  function setRelTab(tab) {
    state.relTab = tab;
    ['mensal','evolucao'].forEach(t => {
      document.getElementById('rt-'+t)?.classList.toggle('active', t === tab);
    });
    renderRelatorios();
  }

  async function renderRelatorios() {
    const el = document.getElementById('rel-content');
    el.innerHTML = '<div class="spinner"></div>';

    if (state.relTab === 'mensal') {
      await renderRelMensal(el);
    } else {
      await renderRelEvolucao(el);
    }
  }

  async function renderRelMensal(el) {
    const lancs = state.lancamentos;
    const mesLabel = `${MONTHS[state.currentMonth]} ${state.currentYear}`;

    // calcular totais por categoria
    const catTotals = {};
    lancs.filter(l => ['debito','credito','fixo'].includes(l.tipo)).forEach(l => {
      const v = l.tipo === 'credito' ? (l.valorParcela || 0) : (l.valor || 0);
      if (!l.categoriaId) return;
      catTotals[l.categoriaId] = (catTotals[l.categoriaId] || 0) + v;
    });
    const totalGastos = Object.values(catTotals).reduce((s, v) => s + v, 0);

    const entConf = lancs.filter(l => l.tipo === 'entrada' && isDateConfirmed(l.data)).reduce((s, l) => s + l.valor, 0);
    const entPend = lancs.filter(l => l.tipo === 'entrada' && !isDateConfirmed(l.data)).reduce((s, l) => s + l.valor, 0);
    const debito = lancs.filter(l => l.tipo === 'debito').reduce((s, l) => s + l.valor, 0);
    const fixosPagos = lancs.filter(l => l.tipo === 'fixo' && l.pago).reduce((s, l) => s + l.valor, 0);
    const fixosNPagos = lancs.filter(l => l.tipo === 'fixo' && !l.pago).reduce((s, l) => s + l.valor, 0);

    const creditoPorCartao = {};
    state.cartoes.forEach(c => creditoPorCartao[c.id] = 0);
    lancs.filter(l => l.tipo === 'credito').forEach(l => {
      if (l.cartaoId) creditoPorCartao[l.cartaoId] = (creditoPorCartao[l.cartaoId] || 0) + (l.valorParcela || 0);
    });
    const saldoIni = parseFloat(localStorage.getItem(`saldo_ini_${mesAnoStr(state.currentMonth, state.currentYear)}`) || 0);
    const totalSaidas = debito + fixosPagos + Object.values(creditoPorCartao).reduce((s, v) => s + v, 0);
    const conta = saldoIni + entConf - totalSaidas;

    // categorias para pizza
    const catItems = Object.entries(catTotals)
      .map(([id, val]) => ({ cat: getCatById(parseInt(id)), val }))
      .filter(x => x.cat && x.val > 0)
      .sort((a, b) => b.val - a.val);

    const CORES = ['#7c6af7','#60a5fa','#f87171','#4ade80','#fbbf24','#a78bfa','#fb923c','#f472b6','#34d399','#818cf8'];

    el.innerHTML = `
      <div style="padding:0 20px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">
        <div class="month-nav" style="padding:0;margin-bottom:0;flex:1">
          <button class="month-btn" onclick="App.changeMonth(-1)">&#8249;</button>
          <span style="font-size:15px;font-weight:600">${mesLabel}</span>
          <button class="month-btn" onclick="App.changeMonth(1)">&#8250;</button>
        </div>
      </div>

      <div class="card" style="padding:20px">
        <div class="section-label" style="padding:0;margin-bottom:14px">Saídas por categoria</div>
        ${catItems.length === 0
          ? '<div style="text-align:center;color:var(--text3);font-size:13px;padding:16px 0">Nenhuma saída registrada</div>'
          : `<div style="position:relative;width:180px;height:180px;margin:0 auto 20px">
              <canvas id="pie-canvas" width="180" height="180"></canvas>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${catItems.map((item, i) => `
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="width:8px;height:8px;border-radius:50%;background:${CORES[i%CORES.length]};flex-shrink:0"></div>
                  <span style="flex:1;font-size:13px;color:var(--text2)">${item.cat.emoji} ${item.cat.nome}</span>
                  <span style="font-size:12px;font-weight:500;font-family:'DM Mono',monospace;color:${CORES[i%CORES.length]}">${totalGastos > 0 ? ((item.val/totalGastos)*100).toFixed(1)+'%' : '0%'}</span>
                  <span style="font-size:12px;color:var(--text3);font-family:'DM Mono',monospace">${fmtMoney(item.val)}</span>
                </div>`).join('')}
            </div>`
        }
      </div>

      <div class="card" style="padding:20px">
        <div class="section-label" style="padding:0;margin-bottom:14px">Resumo do mês</div>
        ${[
          ['Entradas confirmadas', fmtMoney(entConf), 'var(--green)'],
          ['Entradas pendentes', fmtMoney(entPend), 'var(--amber)'],
          null,
          ['Saídas débito', fmtMoney(debito), 'var(--red)'],
          ...state.cartoes.map(c => [`Crédito ${c.nome}`, fmtMoney(creditoPorCartao[c.id]||0), c.cor]),
          ['Gastos fixos pagos', fmtMoney(fixosPagos), 'var(--text2)'],
          ['Gastos fixos previstos', fmtMoney(fixosNPagos), 'var(--text3)'],
          null,
          ['Saldo final', fmtMoney(conta), 'var(--text)'],
        ].map(row => row === null
          ? '<div style="height:0.5px;background:var(--border);margin:8px 0"></div>'
          : `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:0.5px solid var(--border)">
              <span style="font-size:13px;color:${row[2] === 'var(--text)'?'var(--text)':row[2]==='var(--text3)'?'var(--text3)':'var(--text2)'}">${row[0]}</span>
              <span style="font-size:14px;font-weight:500;font-family:'DM Mono',monospace;color:${row[2]}">${row[1]}</span>
            </div>`
        ).join('')}
      </div>
      <div style="height:8px"></div>`;

    // desenhar pizza simples
    if (catItems.length > 0) {
      setTimeout(() => {
        const canvas = document.getElementById('pie-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const cx = 90, cy = 90, r = 80, inner = 52;
        let start = -Math.PI / 2;
        catItems.forEach((item, i) => {
          const slice = (item.val / totalGastos) * 2 * Math.PI;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, r, start, start + slice);
          ctx.closePath();
          ctx.fillStyle = CORES[i % CORES.length];
          ctx.fill();
          start += slice;
        });
        // furo
        ctx.beginPath();
        ctx.arc(cx, cy, inner, 0, 2 * Math.PI);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim() || '#17171c';
        ctx.fill();
        // texto central
        ctx.fillStyle = '#f0f0f0';
        ctx.font = '500 13px DM Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fmtMoneyShort(totalGastos), cx, cy);
      }, 100);
    }
  }

  async function renderRelEvolucao(el) {
    const allLancs = await DB.getAllLancamentos();
    const mesAtual = state.currentMonth;
    const anoAtual = state.currentYear;

    // últimos 6 meses
    const meses = [];
    for (let i = 5; i >= 0; i--) {
      let m = mesAtual - i;
      let y = anoAtual;
      while (m < 0) { m += 12; y--; }
      meses.push({ m, y, key: mesAnoStr(m, y), label: MONTHS_SHORT[m] });
    }

    const dados = meses.map(mes => {
      const lancs = allLancs.filter(l => l.mesAno === mes.key);
      const entradas = lancs.filter(l => l.tipo === 'entrada' && isDateConfirmed(l.data)).reduce((s, l) => s + (l.valor || 0), 0);
      const saidas = lancs.filter(l => ['debito','fixo','credito'].includes(l.tipo)).reduce((s, l) => {
        if (l.tipo === 'credito') return s + (l.valorParcela || 0);
        if (l.tipo === 'fixo') return l.pago ? s + (l.valor || 0) : s;
        return s + (l.valor || 0);
      }, 0);
      const saldoIni = parseFloat(localStorage.getItem(`saldo_ini_${mes.key}`) || 0);
      const saldo = saldoIni + entradas - saidas;
      return { ...mes, entradas, saidas, saldo };
    });

    const maxVal = Math.max(...dados.map(d => Math.max(d.entradas, d.saidas, Math.abs(d.saldo))), 1);
    const BAR_H = 120;

    const mediaEnt = Math.round(dados.reduce((s, d) => s + d.entradas, 0) / dados.length);
    const mediaSai = Math.round(dados.reduce((s, d) => s + d.saidas, 0) / dados.length);
    const mediaSaldo = Math.round(dados.reduce((s, d) => s + d.saldo, 0) / dados.length);

    el.innerHTML = `
      <div class="card" style="padding:20px">
        <div class="section-label" style="padding:0;margin-bottom:16px">Entradas vs. Saídas — últimos 6 meses</div>
        <div style="display:flex;gap:4px;align-items:flex-end;height:${BAR_H+40}px">
          ${dados.map(d => `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
              <div style="width:100%;display:flex;gap:2px;align-items:flex-end;height:${BAR_H}px">
                <div style="flex:1;background:var(--green-dim);border-radius:3px 3px 0 0;height:${Math.max((d.entradas/maxVal)*BAR_H,2)}px;border-top:1.5px solid var(--green)"></div>
                <div style="flex:1;background:var(--red-dim);border-radius:3px 3px 0 0;height:${Math.max((d.saidas/maxVal)*BAR_H,2)}px;border-top:1.5px solid var(--red)"></div>
              </div>
              <div style="font-size:10px;color:var(--text3);text-align:center">${d.label}</div>
            </div>`).join('')}
        </div>
        <div style="display:flex;gap:16px;margin-top:10px">
          <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2)">
            <div style="width:10px;height:10px;border-radius:2px;background:var(--green)"></div>Entradas
          </div>
          <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2)">
            <div style="width:10px;height:10px;border-radius:2px;background:var(--red)"></div>Saídas
          </div>
        </div>
      </div>

      <div class="card" style="padding:20px">
        <div class="section-label" style="padding:0;margin-bottom:16px">Médias dos últimos 6 meses</div>
        ${[
          ['Entradas', fmtMoney(mediaEnt), 'var(--green)'],
          ['Saídas', fmtMoney(mediaSai), 'var(--red)'],
          ['Saldo médio', fmtMoney(mediaSaldo), 'var(--accent2)'],
        ].map(([label, val, cor]) => `
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--border)">
            <span style="font-size:13px;color:var(--text2)">${label}</span>
            <span style="font-size:14px;font-weight:500;font-family:'DM Mono',monospace;color:${cor}">${val}</span>
          </div>`).join('')}
      </div>
      <div style="height:8px"></div>`;
  }

  /* ══════════════════════════════════════════
     RENDER: PERFIL / CONFIG
  ══════════════════════════════════════════ */
  function setCfgTab(tab) {
    state.cfgTab = tab;
    ['categorias','cartoes','notif','dados'].forEach(t => {
      document.getElementById('ct-'+t)?.classList.toggle('active', t === tab);
    });
    renderPerfil();
  }

  async function renderPerfil() {
    const el = document.getElementById('cfg-content');
    el.innerHTML = '<div class="spinner"></div>';
    if (state.cfgTab === 'categorias') await renderCfgCategorias(el);
    else if (state.cfgTab === 'cartoes') await renderCfgCartoes(el);
    else if (state.cfgTab === 'notif') await renderCfgNotif(el);
    else await renderCfgDados(el);
  }

  async function renderCfgCategorias(el) {
    const cats = state.categorias;
    const saida = cats.filter(c => c.tipo === 'saida');
    const entrada = cats.filter(c => c.tipo === 'entrada');

    const renderGrupo = (list, tipo) => list.map(c => `
      <div class="cat-row" id="cat-row-${c.id}">
        <div class="cat-row-header" onclick="App._toggleCatRow(${c.id})">
          <div class="cat-color-dot" style="background:${c.cor}"></div>
          <span class="cat-row-name">${c.emoji} ${c.nome}</span>
          <span class="cat-row-count">${c.subcats?.length || 0} subcat${c.subcats?.length!==1?'s':''}</span>
          <div class="cat-row-actions" onclick="event.stopPropagation()">
            ${c.subcats?.length > 0 ? `<button class="cat-action-btn" onclick="App._openAddSubcat(${c.id})" title="Nova subcategoria"><svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>` : ''}
            <button class="cat-action-btn" onclick="App._openEditCat(${c.id})" title="Editar"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button class="cat-action-btn del" onclick="App._deleteCategoria(${c.id})" title="Excluir"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
          </div>
          <svg class="cat-chevron" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="cat-subcats">
          ${(c.subcats||[]).map(s => `
            <div class="subcat-row-item">
              <div class="subcat-mini-dot"></div>
              <span class="subcat-row-name">${s}</span>
              <div class="subcat-row-actions">
                <button class="cat-action-btn del" onclick="App._deleteSubcat(${c.id},'${s}')" title="Excluir subcategoria"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
              </div>
            </div>`).join('')}
        </div>
      </div>`).join('');

    el.innerHTML = `
      <div style="padding:0 20px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span class="section-label" style="padding:0;margin:0">Saídas</span>
        <button class="cat-action-btn" onclick="App._openAddCat('saida')" style="width:auto;padding:6px 12px;font-size:12px;color:var(--accent2);border-color:var(--accent-dim);background:var(--accent-dim);height:auto;border-radius:20px">+ Nova</button>
      </div>
      ${renderGrupo(saida, 'saida')}
      <div style="height:16px"></div>
      <div style="padding:0 20px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span class="section-label" style="padding:0;margin:0">Entradas</span>
        <button class="cat-action-btn" onclick="App._openAddCat('entrada')" style="width:auto;padding:6px 12px;font-size:12px;color:var(--accent2);border-color:var(--accent-dim);background:var(--accent-dim);height:auto;border-radius:20px">+ Nova</button>
      </div>
      ${renderGrupo(entrada, 'entrada')}
      <div style="height:20px"></div>`;
  }

  function _toggleCatRow(id) {
    const row = document.getElementById('cat-row-' + id);
    row?.classList.toggle('open');
  }

  const EMOJIS = ['🚗','🏠','🍽️','❤️','🎬','📚','💰','🛍️','✈️','💼','🎁','💻','🏋️','🎵','📱','🐾','🌿','⚡','🎓','🧴','🍺','☕','🎮','📷','🎸','🚀','💎','🔑','🏖️','🎂','🐶','🌸','🏥','🚌','🎨','📦','🛒','💊','🧘','🎭'];
  const COLORS = ['#f87171','#fb923c','#fbbf24','#4ade80','#34d399','#60a5fa','#818cf8','#a78bfa','#f472b6','#94a3b8','#7c6af7','#0ea5e9','#10b981','#f59e0b','#ef4444'];

  function _openAddCat(tipo) {
    openModal('add-cat', { tipo });
  }

  function _openEditCat(id) {
    const cat = getCatById(id);
    openModal('edit-cat', cat);
  }

  async function _deleteCategoria(id) {
    if (!confirm('Excluir esta categoria? Os lançamentos existentes não serão afetados.')) return;
    await DB.deleteCategoria(id);
    state.categorias = await DB.getCategorias();
    renderPerfil();
    toast('Categoria excluída', 'info');
  }

  async function _deleteSubcat(catId, subcat) {
    const cat = getCatById(catId);
    if (!cat) return;
    cat.subcats = (cat.subcats || []).filter(s => s !== subcat);
    await DB.saveCategoria(cat);
    state.categorias = await DB.getCategorias();
    renderPerfil();
  }

  function _openAddSubcat(catId) {
    openModal('add-subcat', { catId });
  }

  async function renderCfgCartoes(el) {
    const cartoes = state.cartoes;
    const lancs = await DB.getAllLancamentos();
    const mesAno = mesAnoStr(state.currentMonth, state.currentYear);
    const mesLancs = lancs.filter(l => l.mesAno === mesAno && l.tipo === 'credito');

    el.innerHTML = cartoes.map(c => {
      const usado = mesLancs.filter(l => l.cartaoId === c.id).reduce((s, l) => s + (l.valorParcela || 0), 0);
      const pct = c.limite ? Math.min((usado / c.limite) * 100, 100) : 0;
      const disp = c.limite ? c.limite - usado : 0;
      return `
        <div class="cartao-cfg-card">
          <div class="cartao-cfg-header">
            <div class="cartao-cfg-band" style="background:${c.cor}"></div>
            <div class="cartao-cfg-info">
              <div class="cartao-cfg-nome">${c.nome}</div>
              <div class="cartao-cfg-datas">Fecha dia ${c.fechamento} · Vence dia ${c.vencimento}</div>
            </div>
            <div class="cartao-cfg-limit">
              <div class="cartao-cfg-limit-label">Limite usado</div>
              <div class="cartao-cfg-limit-val" style="color:${c.cor}">${fmtMoneyShort(usado)} / ${fmtMoneyShort(c.limite||0)}</div>
            </div>
          </div>
          <div class="cartao-cfg-body">
            <div class="cartao-cfg-prog">
              <div class="cartao-cfg-prog-row">
                <span class="cartao-cfg-prog-label">${pct.toFixed(1)}% do limite usado</span>
                <span class="cartao-cfg-prog-val">${fmtMoney(disp)} disponível</span>
              </div>
              <div class="mini-prog-bar"><div class="mini-prog-fill" style="width:${pct}%;background:${c.cor}"></div></div>
            </div>
            <div class="cartao-cfg-fields">
              <div>
                <div class="cartao-cfg-field-label">Fechamento</div>
                <input type="number" min="1" max="28" value="${c.fechamento}" onchange="App._updateCartao(${c.id},'fechamento',this.value)">
              </div>
              <div>
                <div class="cartao-cfg-field-label">Vencimento</div>
                <input type="number" min="1" max="31" value="${c.vencimento}" onchange="App._updateCartao(${c.id},'vencimento',this.value)">
              </div>
              <div>
                <div class="cartao-cfg-field-label">Limite total</div>
                <input type="text" value="${c.limite ? c.limite.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '0,00'}" oninput="App._maskMoney(this)" onchange="App._updateCartao(${c.id},'limite',this.value)">
              </div>
              <div>
                <div class="cartao-cfg-field-label">Alerta (%)</div>
                <input type="number" min="1" max="100" value="${c.alertaPct||80}" onchange="App._updateCartao(${c.id},'alertaPct',this.value)">
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="action-btn secondary" style="margin:0;flex:1;padding:10px;font-size:13px" onclick="App._editCartao(${c.id})">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Editar
              </button>
              <button class="action-btn danger" style="margin:0;flex:1;padding:10px;font-size:13px" onclick="App._deleteCartao(${c.id})">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                Excluir
              </button>
            </div>
          </div>
        </div>`;
    }).join('') + `
      <button class="action-btn primary" onclick="App._openAddCartao()">
        <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adicionar cartão
      </button>
      <div style="height:8px"></div>`;
  }

  async function _updateCartao(id, field, val) {
    const c = getCartaoById(id);
    if (!c) return;
    if (field === 'limite') c[field] = parseMoneyInput(val);
    else c[field] = parseFloat(val) || val;
    await DB.saveCartao(c);
    state.cartoes = await DB.getCartoes();
    toast('Cartão atualizado', 'ok');
  }

  function _openAddCartao() {
    openModal('add-cartao', {});
  }

  function _editCartao(id) {
    const c = getCartaoById(id);
    openModal('edit-cartao', c);
  }

  async function _deleteCartao(id) {
    if (!confirm('Excluir este cartão?')) return;
    await DB.deleteCartao(id);
    state.cartoes = await DB.getCartoes();
    renderPerfil();
    toast('Cartão excluído', 'info');
  }

  async function renderCfgNotif(el) {
    const cfg = {
      cartao: await DB.getConfig('notif_cartao', true),
      cartao_dias: await DB.getConfig('notif_cartao_dias', 3),
      orcamento: await DB.getConfig('notif_orcamento', true),
      orcamento_pct: await DB.getConfig('notif_orcamento_pct', 80),
      resumo: await DB.getConfig('notif_resumo', true),
      semdata: await DB.getConfig('notif_semdata', true),
      fixos: await DB.getConfig('notif_fixos', true),
    };

    const toggleRow = (key, title, sub, extraId = '') => `
      <div class="list-item" onclick="App._togglePanel('notif-panel-${key}')">
        <div class="list-info">
          <div class="list-title">${title}</div>
          <div class="list-sub">${sub}</div>
        </div>
        <div class="list-right">
          <div class="toggle ${cfg[key]?'on':''}" id="notif-toggle-${key}"
            onclick="event.stopPropagation();App._toggleNotif('${key}',this)">
            <div class="toggle-thumb" style="left:${cfg[key]?'20px':'2px'}"></div>
          </div>
        </div>
      </div>`;

    el.innerHTML = `
      <div class="card">
        ${toggleRow('cartao','Vencimento do cartão','Aviso antes da fatura vencer')}
        <div class="detail-panel" id="notif-panel-cartao">
          <div class="detail-row">
            <span class="detail-label">Dias antes do vencimento</span>
            <input class="detail-input" type="number" value="${cfg.cartao_dias}" min="1" max="10"
              onchange="DB.setConfig('notif_cartao_dias',parseInt(this.value))">
          </div>
        </div>
        ${toggleRow('orcamento','Alerta de orçamento','Aviso ao atingir % dos gastos')}
        <div class="detail-panel" id="notif-panel-orcamento">
          <div class="detail-row">
            <span class="detail-label">Avisar ao atingir</span>
            <select class="detail-select" onchange="DB.setConfig('notif_orcamento_pct',parseInt(this.value))">
              ${[70,80,90,100].map(p => `<option value="${p}" ${cfg.orcamento_pct===p?'selected':''}>${p}% das entradas</option>`).join('')}
            </select>
          </div>
        </div>
        ${toggleRow('resumo','Resumo mensal','Balanço automático no início do mês')}
        <div class="detail-panel" id="notif-panel-resumo" style="padding:10px 16px">
          <span class="detail-label" style="font-size:12px">Enviado automaticamente no dia 2 de cada mês</span>
        </div>
        ${toggleRow('semdata','Entradas sem data','Lembrete no fim do mês')}
        <div class="detail-panel" id="notif-panel-semdata" style="padding:10px 16px">
          <span class="detail-label" style="font-size:12px">Enviado no dia 28 de cada mês</span>
        </div>
        ${toggleRow('fixos','Gastos fixos não pagos','Lembrete no fim do mês')}
        <div class="detail-panel" id="notif-panel-fixos" style="padding:10px 16px">
          <span class="detail-label" style="font-size:12px">Enviado no dia 28 de cada mês</span>
        </div>
      </div>
      <div style="height:8px"></div>`;
  }

  function _togglePanel(id) {
    const el = document.getElementById(id);
    el?.classList.toggle('open');
  }

  async function _toggleNotif(key, el) {
    el.classList.toggle('on');
    el.querySelector('.toggle-thumb').style.left = el.classList.contains('on') ? '20px' : '2px';
    await DB.setConfig('notif_' + key, el.classList.contains('on'));
  }

  async function renderCfgDados(el) {
    const allLancs = await DB.getAllLancamentos();
    const meses = [...new Set(allLancs.map(l => l.mesAno))].sort();

    el.innerHTML = `
      <div class="card" style="padding:20px;margin-bottom:14px">
        <div class="section-label" style="padding:0;margin-bottom:12px">Resumo do banco de dados</div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid var(--border)">
          <span style="font-size:13px;color:var(--text2)">Total de lançamentos</span>
          <span style="font-size:13px;font-family:'DM Mono',monospace">${allLancs.length}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid var(--border)">
          <span style="font-size:13px;color:var(--text2)">Meses com dados</span>
          <span style="font-size:13px;font-family:'DM Mono',monospace">${meses.length}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0">
          <span style="font-size:13px;color:var(--text2)">Período</span>
          <span style="font-size:13px;font-family:'DM Mono',monospace">${meses.length > 0 ? meses[0] + ' – ' + meses[meses.length-1] : '—'}</span>
        </div>
      </div>

      <button class="action-btn success" onclick="App._exportar()">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Exportar backup (JSON)
      </button>

      <button class="action-btn secondary" onclick="document.getElementById('import-input').click()">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Importar backup (JSON)
      </button>
      <input type="file" id="import-input" accept=".json" style="display:none" onchange="App._importar(this)">

      <button class="action-btn secondary" onclick="App.gotoScreen('screen-sheets')" style="display:none">
        <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Importar do Google Sheets
      </button>

      <div style="height:16px"></div>
      <div class="divider-line" style="margin:0 20px 16px"></div>

      <button class="action-btn danger" onclick="App._limpar()">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        Apagar todos os dados
      </button>

      <div class="version-tag">Finanças App · v1.0.0<br>Dados armazenados localmente neste dispositivo</div>
      <div style="height:8px"></div>`;
  }

  async function _exportar() {
    const json = await DB.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financas_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup exportado!', 'ok');
  }

  async function _importar(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        await DB.importAll(e.target.result);
        state.categorias = await DB.getCategorias();
        state.cartoes = await DB.getCartoes();
        state.lancamentos = await DB.getLancamentos(mesAnoStr(state.currentMonth, state.currentYear));
        toast('Backup importado com sucesso!', 'ok');
        renderPerfil();
      } catch (err) {
        toast('Erro ao importar: arquivo inválido', 'err');
      }
    };
    reader.readAsText(file);
  }

  async function _limpar() {
    if (!confirm('Tem certeza? Todos os dados serão apagados permanentemente.')) return;
    await DB.clearAll();
    await DB.seedDefaults();
    state.categorias = await DB.getCategorias();
    state.cartoes = await DB.getCartoes();
    state.lancamentos = [];
    toast('Dados apagados', 'info');
    renderPerfil();
  }

  /* ══════════════════════════════════════════
     MODAL
  ══════════════════════════════════════════ */
  function openModal(type, data) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');

    if (type === 'add-cat' || type === 'edit-cat') {
      const isEdit = type === 'edit-cat';
      content.innerHTML = `
        <div class="modal-title">${isEdit ? 'Editar categoria' : `Nova categoria de ${data.tipo === 'saida' ? 'saída' : 'entrada'}`}</div>
        <div class="field">
          <div class="field-label">Nome</div>
          <input type="text" id="m-cat-nome" value="${isEdit ? data.nome : ''}">
        </div>
        <div class="field">
          <div class="field-label">Ícone</div>
          <div class="emoji-grid" id="m-emoji-grid">
            ${EMOJIS.map(e => `<div class="emoji-opt ${isEdit && data.emoji===e?'sel':''}" onclick="App._selEmoji(this)">${e}</div>`).join('')}
          </div>
        </div>
        <div class="field">
          <div class="field-label">Cor</div>
          <div class="color-grid">
            ${COLORS.map(c => `<div class="color-opt ${isEdit && data.cor===c?'sel':''}" style="background:${c}" onclick="App._selColor(this)"></div>`).join('')}
          </div>
        </div>
        <div class="modal-btns">
          <button class="btn-cancel" onclick="App.closeModal()">Cancelar</button>
          <button class="btn-save" onclick="App._saveCategoria(${isEdit?data.id:'null'},'${isEdit?data.tipo:data.tipo}')">Salvar</button>
        </div>`;
    }

    else if (type === 'add-subcat') {
      content.innerHTML = `
        <div class="modal-title">Nova subcategoria</div>
        <div class="field">
          <div class="field-label">Nome</div>
          <input type="text" id="m-subcat-nome" autofocus>
        </div>
        <div class="modal-btns">
          <button class="btn-cancel" onclick="App.closeModal()">Cancelar</button>
          <button class="btn-save" onclick="App._saveSubcat(${data.catId})">Salvar</button>
        </div>`;
    }

    else if (type === 'add-cartao' || type === 'edit-cartao') {
      const isEdit = type === 'edit-cartao';
      content.innerHTML = `
        <div class="modal-title">${isEdit ? 'Editar cartão' : 'Novo cartão'}</div>
        <div class="field">
          <div class="field-label">Nome</div>
          <input type="text" id="m-cartao-nome" value="${isEdit ? data.nome : ''}">
        </div>
        <div class="field">
          <div class="field-label">Cor</div>
          <div class="color-grid">
            ${COLORS.map(c => `<div class="color-opt ${isEdit && data.cor===c?'sel':!isEdit&&c==='#a78bfa'?'sel':''}" style="background:${c}" onclick="App._selColor(this)"></div>`).join('')}
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <div class="field-label">Fechamento</div>
            <input type="number" id="m-cartao-fech" min="1" max="28" value="${isEdit ? data.fechamento : 5}">
          </div>
          <div class="field">
            <div class="field-label">Vencimento</div>
            <input type="number" id="m-cartao-venc" min="1" max="31" value="${isEdit ? data.vencimento : 10}">
          </div>
        </div>
        <div class="field">
          <div class="field-label">Limite total</div>
          <div class="valor-wrap">
            <span class="valor-prefix">R$</span>
            <input type="text" inputmode="numeric" id="m-cartao-limite" oninput="App._maskMoney(this)"
              value="${isEdit ? (data.limite||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}">
          </div>
        </div>
        <div class="modal-btns">
          <button class="btn-cancel" onclick="App.closeModal()">Cancelar</button>
          <button class="btn-save" onclick="App._saveCartao(${isEdit?data.id:'null'})">Salvar</button>
        </div>`;
    }

    else if (type === 'confirm-delete-parcelas') {
      content.innerHTML = `
        <div class="modal-title">Excluir compra parcelada</div>
        <p style="font-size:14px;color:var(--text2);line-height:1.6;margin-bottom:20px">Esta compra tem ${data.totalParcelas} parcelas. Deseja excluir apenas esta parcela ou todas as parcelas?</p>
        <div class="modal-btns" style="flex-direction:column">
          <button class="btn-save" style="background:var(--red)" onclick="App._deletarTodasParcelas(${data.grupoId})">Excluir todas as ${data.totalParcelas} parcelas</button>
          <button class="btn-cancel" style="margin-top:8px" onclick="App._deletarUmaParcela(${data.id})">Excluir só esta parcela</button>
          <button class="btn-cancel" style="margin-top:8px" onclick="App.closeModal()">Cancelar</button>
        </div>`;
    }

    overlay.classList.add('open');
  }

  function closeModal(e) {
    if (!e || e.target === document.getElementById('modal-overlay')) {
      document.getElementById('modal-overlay').classList.remove('open');
    }
  }

  function _selEmoji(el) {
    document.querySelectorAll('#m-emoji-grid .emoji-opt').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel');
  }

  function _selColor(el) {
    el.closest('.color-grid')?.querySelectorAll('.color-opt').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel');
  }

  async function _saveCategoria(id, tipo) {
    const nome = document.getElementById('m-cat-nome')?.value?.trim();
    if (!nome) { toast('Informe o nome', 'err'); return; }
    const emoji = document.querySelector('#m-emoji-grid .emoji-opt.sel')?.textContent || '📦';
    const cor = document.querySelector('.color-opt.sel')?.style.background || '#9ca3af';

    const existing = id !== null ? getCatById(id) : null;
    const obj = existing
      ? { ...existing, nome, emoji, cor }
      : { tipo, nome, emoji, cor, subcats: [] };
    if (id !== null) obj.id = id;

    await DB.saveCategoria(obj);
    state.categorias = await DB.getCategorias();
    closeModal();
    renderPerfil();
    toast(id !== null ? 'Categoria atualizada' : 'Categoria criada', 'ok');
  }

  async function _saveSubcat(catId) {
    const nome = document.getElementById('m-subcat-nome')?.value?.trim();
    if (!nome) { toast('Informe o nome', 'err'); return; }
    const cat = getCatById(catId);
    if (!cat) return;
    cat.subcats = [...(cat.subcats || []), nome];
    await DB.saveCategoria(cat);
    state.categorias = await DB.getCategorias();
    closeModal();
    renderPerfil();
    toast('Subcategoria adicionada', 'ok');
  }

  async function _saveCartao(id) {
    const nome = document.getElementById('m-cartao-nome')?.value?.trim();
    if (!nome) { toast('Informe o nome', 'err'); return; }
    const cor = document.querySelector('.color-opt.sel')?.style.background || '#a78bfa';
    const fechamento = parseInt(document.getElementById('m-cartao-fech')?.value || 5);
    const vencimento = parseInt(document.getElementById('m-cartao-venc')?.value || 10);
    const limite = parseMoneyInput(document.getElementById('m-cartao-limite')?.value || '0');

    const existing = id !== null ? getCartaoById(id) : null;
    const obj = existing
      ? { ...existing, nome, cor, fechamento, vencimento, limite }
      : { nome, cor, fechamento, vencimento, limite };
    if (id !== null) obj.id = id;

    await DB.saveCartao(obj);
    state.cartoes = await DB.getCartoes();
    closeModal();
    renderPerfil();
    toast(id !== null ? 'Cartão atualizado' : 'Cartão adicionado', 'ok');
  }

  async function _deletarTodasParcelas(grupoId) {
    const allLancs = await DB.getAllLancamentos();
    const grupo = allLancs.filter(l => l.grupoId === grupoId);
    for (const l of grupo) await DB.deleteLancamento(l.id);
    state.lancamentos = await DB.getLancamentos(mesAnoStr(state.currentMonth, state.currentYear));
    closeModal();
    toast('Todas as parcelas excluídas', 'info');
    goBack();
  }

  async function _deletarUmaParcela(id) {
    await DB.deleteLancamento(id);
    state.lancamentos = await DB.getLancamentos(mesAnoStr(state.currentMonth, state.currentYear));
    closeModal();
    toast('Parcela excluída', 'info');
    goBack();
  }

  /* ══════════════════════════════════════════
     INIT
  ══════════════════════════════════════════ */
  async function init() {
    await DB.open();
    await DB.seedDefaults();
    await loadData();

    // relógio
    updateClock();
    setInterval(updateClock, 30000);

    // tela inicial
    state.editingId = null;
    gotoScreen('screen-home', false);

    // ao abrir tela novo: resetar estado
    document.getElementById('fab').addEventListener('click', () => {
      state.editingId = null;
      setTipoLanc('entrada');
    });
  }

  return {
    // navegação
    gotoScreen, goBack,
    changeMonth,
    // home
    renderHome,
    // lançamentos
    setLancTab, editLancamento,
    // novo lançamento (form)
    setTipoLanc,
    _maskMoney, _selCat, _selSubcat, _selPay, _selCartao, _updateParcelas,
    _salvar, _deletar, _deletarTodasParcelas, _deletarUmaParcela,
    // relatórios
    setRelTab,
    // config
    setCfgTab,
    _toggleCatRow, _openAddCat, _openEditCat, _deleteCategoria, _deleteSubcat, _openAddSubcat,
    _updateCartao, _openAddCartao, _editCartao, _deleteCartao,
    _toggleNotif, _togglePanel,
    _exportar, _importar, _limpar,
    // modal
    openModal, closeModal,
    _selEmoji, _selColor,
    _saveCategoria, _saveSubcat, _saveCartao,
    // init
    init,
  };
})();

// arrancar o app
App.init();
