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
    parcFiltroCartao: null,
    parcCatFilter: [],
    parcImpactoVisible: true,
    parcAbertos: new Set(),
    lancamentos: [],
    categorias: [],
    cartoes: [],
  };

  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  /* ── Utilitários ─────────────────────── */
  function mesAnoStr(m, y) { return `${String(m+1).padStart(2,'0')}-${y}`; }
  // Converte "MM-YYYY" para número comparável (ex: "04-2026" → 202604)
  function mesAnoNum(key) {
    const [mm, yy] = key.split('-').map(Number);
    return yy * 100 + mm;
  }
  function mesAnoLe(a, b) { return mesAnoNum(a) <= mesAnoNum(b); } // a <= b
  function mesAnoLt(a, b) { return mesAnoNum(a) < mesAnoNum(b); }  // a < b
  function mesAnoGt(a, b) { return mesAnoNum(a) > mesAnoNum(b); }  // a > b

  // ──────────────────────────────────────────────────────────────────
  // REGRA OFICIAL DA FATURA (FinApp)
  // ──────────────────────────────────────────────────────────────────
  // A fatura "mesAnoV" (nome = MêsV/anoV) tem:
  //   • PERÍODO DE GASTOS: do dia diaF/mesAnoV-1 até dia (diaF-1)/mesAnoV
  //     (início = data de fechamento da fatura ANTERIOR; fim = véspera do diaF do próprio mesAnoV)
  //   • DATA DE VENCIMENTO: diaV/mesAnoV
  //
  // Exemplos (diaF=4, diaV=11):
  //   • Fatura "Mai/26": período 04/04/26 a 03/05/26, vence 11/05/26
  //   • Fatura "Jun/26": período 04/05/26 a 03/06/26, vence 11/06/26
  //
  // Compra em data dCompra entra na fatura cujo período inclui dCompra:
  //   • Se diaCompra >= diaF → fatura mesV = mês da compra + 1
  //   • Se diaCompra <  diaF → fatura mesV = mês da compra
  //
  // Fatura ATUAL = aquela cujo período inclui hoje (mesma regra de cima com hoje).
  //
  // No banco: l.mesAno e l.mesPagamento guardam o "mesV/anoV" da fatura (mês do vencimento).
  // ──────────────────────────────────────────────────────────────────

  // ──────────────────────────────────────────────────────────────────
  // REGRA OFICIAL DA FATURA (FinApp) — REVISADA
  // ──────────────────────────────────────────────────────────────────
  // diaF e diaV são fixos por cartão.
  // Para uma fatura que vence em dataV = diaV/mesV/anoV:
  //   • FIM    = primeira data com dia=diaF-1 ANTERIOR a dataV
  //              (andando para trás a partir de dataV)
  //   • INÍCIO = primeira data com dia=diaF ANTERIOR ao FIM
  //
  // Exemplos:
  //   • diaF=4, diaV=11, fatura "Mai/26" (vence 11/05/26):
  //       FIM    = 03/05/26   (primeiro 03 antes de 11/05)
  //       INÍCIO = 04/04/26   (primeiro 04 antes de 03/05)
  //   • diaF=22, diaV=1, fatura "Jan/27" (vence 01/01/27):
  //       FIM    = 21/12/26   (primeiro 21 antes de 01/01/27)
  //       INÍCIO = 22/11/26   (primeiro 22 antes de 21/12/26)
  //
  // Compra cai na fatura cujo período INÍCIO..FIM inclui a data da compra.
  // ──────────────────────────────────────────────────────────────────

  // Auxiliar: retorna a primeira data com `dia` que é estritamente ANTERIOR à dRef
  function _primeiraDataAntesEstrito(dia, dRef) {
    let m = dRef.getMonth();
    let y = dRef.getFullYear();
    let cand = new Date(y, m, dia);
    if (cand >= dRef) {
      // candidata desse mês não é estritamente anterior — usa mês anterior
      cand = new Date(y, m - 1, dia);
    }
    return cand;
  }

  // Auxiliar: retorna a primeira data com `dia` que é estritamente POSTERIOR à dRef
  function _primeiraDataDepoisEstrito(dia, dRef) {
    let m = dRef.getMonth();
    let y = dRef.getFullYear();
    let cand = new Date(y, m, dia);
    if (cand <= dRef) {
      cand = new Date(y, m + 1, dia);
    }
    return cand;
  }

  // Dada uma fatura mesAnoV (ano/mês do vencimento), retorna {dInicio, dFim, dVenc}
  function periodoFatura(mesAnoV, cartao) {
    const diaF = cartao?.fechamento || 5;
    const diaV = cartao?.vencimento || 10;
    const [mmV, yyV] = mesAnoV.split('-').map(Number); // mmV 1-based
    const dVenc = new Date(yyV, mmV - 1, diaV);
    // FIM = primeira data (diaF-1) ANTERIOR a dVenc
    const dFim = _primeiraDataAntesEstrito(diaF - 1, dVenc);
    // INÍCIO = primeira data (diaF) ANTERIOR a dFim
    const dInicio = _primeiraDataAntesEstrito(diaF, dFim);
    return { dInicio, dFim, dVenc };
  }

  // Dada uma data (compra ou hoje), retorna a fatura {mmV, yyV, mesAnoV} cujo período inclui essa data
  function faturaDeData(dRef, cartao) {
    const diaF = cartao?.fechamento || 5;
    const diaV = cartao?.vencimento || 10;
    // Algoritmo: a próxima data diaF estritamente posterior a dRef é o início da PRÓXIMA fatura.
    // Logo, FIM da nossa fatura = (próxima diaF) - 1 dia.
    // dVenc = primeira data diaV estritamente posterior ao nosso FIM.
    // Normalizar dRef para zerar hora (evitar problemas de comparação)
    const dCompra = new Date(dRef.getFullYear(), dRef.getMonth(), dRef.getDate());
    const dProxFech = _primeiraDataDepoisEstrito(diaF, dCompra);
    const dFim = new Date(dProxFech.getFullYear(), dProxFech.getMonth(), dProxFech.getDate() - 1);
    const dVenc = _primeiraDataDepoisEstrito(diaV, dFim);
    const mmV = dVenc.getMonth() + 1;
    const yyV = dVenc.getFullYear();
    return { mmV, yyV, mesAnoV: mesAnoStr(mmV - 1, yyV) };
  }

  // Retorna a fatura ATUAL do cartão (a que inclui hoje)
  function faturaAtual(cartao) {
    return faturaDeData(new Date(), cartao);
  }

  // Retorna a data de vencimento da fatura cujo nome (mesAno) é dado
  function dataVencFatura(mesAno, cartao) {
    if (!cartao) return null;
    return periodoFatura(mesAno, cartao).dVenc;
  }

  // Compatibilidade: retorna { dMesBase, dFech, dVenc } para a fatura onde a compra entra
  //   • dMesBase = primeiro dia do mesV da fatura (referência para iterar parcelas)
  //   • dFech    = data do FIM do período (último dia da fatura) — exibido como "Fechamento"
  //   • dVenc    = data de vencimento
  function calcMesAnoFatura(dCompra, fechamento, vencimento) {
    const cartaoFake = { fechamento, vencimento };
    const { mmV, yyV, mesAnoV } = faturaDeData(dCompra, cartaoFake);
    const { dFim, dVenc } = periodoFatura(mesAnoV, cartaoFake);
    const dMesBase = new Date(yyV, mmV - 1, 1);
    return { dMesBase, dFech: dFim, dVenc };
  }

  // Uma parcela é considerada paga se o lançamento de fatura do cartão
  // referente ao mês de pagamento estiver com pago=true.
  // _faturasPagas é um Set<"cartaoId|mesAnoPagamento"> montado em renderParcelamentos.
  let _faturasPagas = null;

  function isParcelaPaga(mesAno, cartao) {
    const hoje = new Date();
    hoje.setHours(23, 59, 59, 0);
    const dVenc = dataVencFatura(mesAno, cartao);
    if (!dVenc) return false;
    // Vencimento no passado → paga automaticamente
    if (dVenc < hoje) return true;
    // Vencimento futuro → verifica lançamento automático
    if (_faturasPagas && cartao) {
      const [mm, yy] = mesAno.split('-').map(Number);
      const dPgto = new Date(yy, mm, 1);
      const mesPgto = mesAnoStr(dPgto.getMonth(), dPgto.getFullYear());
      return _faturasPagas.has(cartao.id + '|' + mesPgto);
    }
    return false;
  }
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

  // Calcula em qual mesAno (tela) uma compra vai aparecer, dado o cartão e a data da compra.
  // Lógica conforme especificação:
  //   1) mesAnoFechamento: se diaFechamento <= diaCompra → mês da compra; senão → mês anterior
  //   2) mesAnoVencimento: se diaVencimento > diaFechamento → mesmo mês do fechamento; senão → mês seguinte
  //   3) mesAnoFatura (tela): se vencimento == compra+1 → mês da compra; se vencimento == compra+2 → mês da compra+1
  // (LÓGICA OBSOLETA — substituída pelas funções faturaDeData/periodoFatura/calcMesAnoFatura no topo do arquivo)

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
    const navMap = {'screen-home':'nav-home','screen-lancamentos':'nav-lancamentos','screen-relatorios':'nav-relatorios','screen-perfil':'nav-perfil','screen-parcelamentos':'nav-relatorios'};
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    if (navMap[id]) document.getElementById(navMap[id])?.classList.add('active');
    if (id==='screen-home') renderHome();
    if (id==='screen-lancamentos') renderLancamentos();
    if (id==='screen-relatorios') {
      const el=document.getElementById('rel-month-label');
      if(el) el.textContent=`${MONTHS[state.currentMonth]} ${state.currentYear}`;
      renderRelatorios();
    }
    if (id==='screen-perfil') renderPerfil();
    if (id==='screen-parcelamentos') renderParcelamentos();
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
    for (const c of state.cartoes) await atualizarFaturaFixa(c.id);
    state.lancamentos = await DB.getLancamentos(mesAnoStr(state.currentMonth, state.currentYear));
  }

  async function changeMonth(dir) {
    state.currentMonth += dir;
    if (state.currentMonth<0) { state.currentMonth=11; state.currentYear--; }
    if (state.currentMonth>11) { state.currentMonth=0; state.currentYear++; }
    await DB.ensureFixosMes(mesAnoStr(state.currentMonth, state.currentYear), mesAnoStr(new Date().getMonth(), new Date().getFullYear()));
    for (const c of state.cartoes) await atualizarFaturaFixa(c.id);
    state.lancamentos = await DB.getLancamentos(mesAnoStr(state.currentMonth, state.currentYear));
    const label = `${MONTHS[state.currentMonth]} ${state.currentYear}`;
    ['home-month-label','lanc-month-label','rel-month-label'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=label;});
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
    const saved = localStorage.getItem('saldo_ini_'+mesAnoStr(m,y));
    if (saved !== null) return parseFloat(saved);
    return 0;
  }

  // Salva o saldo final do mês como saldo inicial do mês seguinte
  function propagarSaldoParaProximoMes(saldoFinal, m, y) {
    const nextM = m===11?0:m+1;
    const nextY = m===11?y+1:y;
    const key = 'saldo_ini_'+mesAnoStr(nextM, nextY);
    // Só sobrescreve se não houver valor salvo manualmente pelo usuário
    // (usamos uma flag separada para distinguir manual de automático)
    const isManual = localStorage.getItem('saldo_ini_manual_'+mesAnoStr(nextM, nextY));
    if (!isManual) {
      localStorage.setItem(key, String(saldoFinal));
    }
  }

  // Calcula saldo final de um mês considerando APENAS lançamentos efetivados
  // Para meses já encerrados (ou para carry-over): usa último dia do mês como limite
  // Para o mês atual (exibição em tempo real): usa hoje como limite
  // O parâmetro usarUltimoDia=true força o uso do último dia (para carry-over entre meses)
  async function getSaldoFinalMesFechado(m, y, allLancs, usarUltimoDia=false) {
    const key = mesAnoStr(m, y);
    const lancs = allLancs ? allLancs.filter(l=>l.mesAno===key) : await DB.getLancamentos(key);
    const saldoIni = await getSaldoInicialMes(m, y);

    // Limite de confirmação:
    // - Se usarUltimoDia=true (carry-over): sempre usa último dia do mês
    // - Se mês já encerrado: último dia do mês
    // - Se mês atual: hoje
    const hoje = todayStr();
    const ultimoDiaMes = `${y}-${String(m+1).padStart(2,'0')}-${String(new Date(y,m+1,0).getDate()).padStart(2,'0')}`;
    const limiteConfirmacao = (usarUltimoDia || ultimoDiaMes < hoje) ? ultimoDiaMes : hoje;

    // Só entradas com data <= limiteConfirmacao (efetivamente recebidas)
    const entradas = lancs.filter(l=>l.tipo==='entrada' && l.data && l.data<=limiteConfirmacao)
                          .reduce((s,l)=>s+(l.valor||0),0);
    // Saídas débito efetivadas (data <= limiteConfirmacao) — débitos sem data não contam
    const debitos = lancs.filter(l=>l.tipo==='debito' && l.data && l.data<=limiteConfirmacao).reduce((s,l)=>s+(l.valor||0),0);
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

    // saídas no débito apenas (item 4) — apenas efetivados (data <= hoje)
    const debitos = lancs.filter(l=>l.tipo==='debito' && isDateConfirmed(l.data)).reduce((s,l)=>s+(l.valor||0),0);
    const debitosPend = lancs.filter(l=>l.tipo==='debito' && !isDateConfirmed(l.data)).reduce((s,l)=>s+(l.valor||0),0);
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

    // Propagar saldo final como saldo inicial do próximo mês
    propagarSaldoParaProximoMes(saldoFinal, state.currentMonth, state.currentYear);

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
    const nSaidasDeb = lancs.filter(l=>(l.tipo==='debito'&&isDateConfirmed(l.data))||(l.tipo==='fixo'&&l.pago&&l.pagamento==='debito')).length;
    document.getElementById('h-saidas-sub').textContent = `${nSaidasDeb} lançamento${nSaidasDeb!==1?'s':''}`;
    const pendDebEl = document.getElementById('h-saidas-pending');
    if (debitosPend>0 && pendDebEl) { pendDebEl.style.display=''; pendDebEl.textContent=`+${fmtMoney(debitosPend)} pendente`; }
    else if (pendDebEl) pendDebEl.style.display='none';

    // Progresso (inclui pendentes)
    const pctEl = document.getElementById('h-prog-pct');
    const fillEl = document.getElementById('h-prog-fill');
    const hintEl = document.getElementById('h-prog-hint');
    const totalEntradasTotal = totalEntradas + totalPend;
    const totalSaidasTotal = totalSaidasDebito + debitosPend;
    if (totalEntradasTotal>0) {
      const pct = Math.min((totalSaidasTotal/totalEntradasTotal)*100,100);
      pctEl.textContent = pct.toFixed(0)+'%';
      pctEl.style.color = pct>90?'var(--red)':pct>70?'var(--amber)':'var(--green)';
      fillEl.style.width = pct+'%';
      hintEl.textContent = '';
    } else {
      pctEl.textContent='—'; fillEl.style.width='0%';
      hintEl.textContent = 'Nenhuma entrada registrada';
    }

    // Alert
    const alertEl = document.getElementById('home-alert');
    if (totalSemData>0) {
      alertEl.style.display='';
      alertEl.innerHTML=`<div class="alert-banner"><div class="alert-icon"><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><div class="alert-text"><strong>${totalSemData} entrada${totalSemData>1?'s':''} sem data</strong> — não serão contabilizadas até receber uma data</div></div>`;
    } else alertEl.style.display='none';

    // Cartões — mostra FATURA ATUAL (independente do mês selecionado)
    const allLancsHome = await DB.getAllLancamentos();
    const cartaoEl = document.getElementById('h-cartoes');
    cartaoEl.innerHTML = state.cartoes.map(c=>{
      // Fatura ATUAL pela regra oficial (fatura cujo período inclui hoje)
      const { mmV, yyV, mesAnoV: mesAnoFat } = faturaAtual(c);
      const { dInicio, dFim, dVenc: dVencAtual } = periodoFatura(mesAnoFat, c);
      // Para exibição: "Fechamento" = último dia do período da fatura (dFim)
      const dFechAtual = dFim;
      // Nome da fatura: MêsV/anoVYY
      const nomeFat = MONTHS_SHORT[mmV - 1] + '/' + String(yyV).slice(2);
      // Valor da fatura = soma de créditos cujo mesPagamento (fatura) == mesAnoFat
      let valorFat = 0;
      allLancsHome.filter(l => !l.autoFatura && l.tipo === 'credito' && l.cartaoId === c.id &&
                               (l.mesPagamento || l.mesAno) === mesAnoFat)
                  .forEach(l => { valorFat += Math.abs(l.valorParcela || 0); });
      allLancsHome.filter(l => !l.autoFatura && l.tipo === 'fixo' && l.pago && l.cartaoId === c.id &&
                               (l.mesPagamento || l.mesAno) === mesAnoFat)
                  .forEach(l => { valorFat += (l.valor || 0); });
      const strI = dInicio.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
      const strF = dFechAtual.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
      const strV = dVencAtual.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
      return `<div class="cartao-chip" style="cursor:pointer;padding:12px 14px" onclick="App._openCartaoBS(${c.id})">
        <div class="cartao-band" style="background:${c.cor}"></div>
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          ${getBancoIconHtml(c.nome,32)||`<div style="width:32px;height:32px;border-radius:8px;background:${c.cor}22;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">💳</div>`}
          <div class="cartao-chip-info" style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <div class="cartao-chip-nome">${c.nome}</div>
              <div style="font-size:10px;color:var(--text2);background:${c.cor}22;padding:1px 7px;border-radius:6px;font-weight:600">${nomeFat}</div>
            </div>
            <div style="font-size:10.5px;color:var(--text3);margin-top:3px;line-height:1.45">
              Período <span style="color:var(--text2)">${strI} → ${strF}</span><br>
              Vence <span style="color:var(--text2)">${strV}</span>
            </div>
            <div class="cartao-mini-bar" style="margin-top:6px"><div class="cartao-mini-fill" style="width:${(()=>{const hoje=new Date();const h=new Date(hoje.getFullYear(),hoje.getMonth(),hoje.getDate());const ini=new Date(dInicio.getFullYear(),dInicio.getMonth(),dInicio.getDate());const fim=new Date(dFechAtual.getFullYear(),dFechAtual.getMonth(),dFechAtual.getDate());const total=fim-ini;const passado=h-ini;return total<=0?0:Math.max(0,Math.min(100,(passado/total)*100)).toFixed(1);})()}%;background:${c.cor}"></div></div>
          </div>
        </div>
        <div class="cartao-chip-vals">
          <div class="cartao-chip-usado" style="color:${c.cor}">${fmtMoney(valorFat)}</div>
          <div class="cartao-chip-limite" style="font-size:10px;color:var(--text3)">fatura</div>
        </div>
      </div>`;
    }).join('');
  }

  function abrirCartao(cartaoId) {
    state.cartaoFiltro = cartaoId;
    state.lancTab = 'saidas';
    state.lancSubTab = 'credito_'+cartaoId;
    gotoScreen('screen-lancamentos');
  }

  /* ── Feed item ───────────────────────── */
  function renderFaturaAutoItem(l, showPagoToggle) {
    const cartao = getCartaoById(l.faturaCartaoId);
    const iconHtml = cartao ? (getBancoIconHtml(cartao.nome, 34) || `<span style="font-size:18px">💳</span>`) : '💳';
    const cor = '#888899';
    const pago = l.pago;
    const pagoToggle = showPagoToggle ? `
      <div class="fixo-pago-toggle ${pago?'pago':''}" onclick="event.stopPropagation();App.toggleFixoPago(${l.id})" title="${pago?'Não pago':'Marcar como pago'}">
        ${pago?'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>':'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/></svg>'}
      </div>` : '';
    return `<div class="feed-item fatura-auto" onclick="void(0)" style="cursor:default;opacity:${pago?'0.55':'1'}">
      ${pagoToggle}
      <div class="feed-icon" style="background:#88889918;overflow:hidden;padding:0">
        ${iconHtml}
      </div>
      <div class="feed-info">
        <div class="feed-nome" style="color:var(--text2)">${l.descricao || 'Fatura '+cartao?.nome}</div>
        <div class="feed-cat" style="display:flex;align-items:center;gap:5px">
          <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:#88889922;color:#888899">AUTO</span>
          Pagamento fatura · ${cartao?.nome||'Cartão'}${l.data?' · '+new Date(l.data+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}):''}
        </div>
      </div>
      <div class="feed-right">
        <div class="feed-val" style="color:${cor}">-${fmtMoney(l.valor||0)}</div>
        ${pago?'<span class="badge" style="background:var(--green-dim);color:var(--green)">pago</span>':'<span class="badge" style="background:#88889922;color:#888899">pendente</span>'}
      </div>
    </div>`;
  }

  function renderFeedItem(l, showPagoToggle=false) {
    // Fatura automática: tratamento especial
    if (l.autoFatura && l.faturaCartaoId) {
      return renderFaturaAutoItem(l, showPagoToggle);
    }
    const cat = getCatById(l.categoriaId);
    const isEntrada = l.tipo==='entrada';
    const isFixo = l.tipo==='fixo';
    const isDebito = l.tipo==='debito';
    const isCredito = l.tipo==='credito';
    const cartao = (isCredito||isFixo) ? getCartaoById(l.cartaoId) : null;

    // ── Cor do valor por tipo (não mais por categoria) ──
    // Entrada: verde se efetivada, cinza se pendente/sem data
    // Débito: vermelho se efetivado (data <= hoje), cinza se pendente
    // Fixo: cinza se não pago, após pago segue tipo (débito→vermelho, crédito→cor do cartão)
    // Crédito: cor do cartão
    const semData = isEntrada && !l.data;
    const pendente = isEntrada && l.data && !isDateConfirmed(l.data);
    const debitoConfirmado = isDebito && l.data && isDateConfirmed(l.data);
    const debitoPendente = isDebito && (!l.data || !isDateConfirmed(l.data));

    const isEstorno = isCredito && l.estorno;
    let corValor;
    if (isEntrada) {
      corValor = (semData || pendente) ? 'var(--text3)' : 'var(--green)';
    } else if (isDebito) {
      corValor = debitoPendente ? 'var(--text3)' : 'var(--red)';
    } else if (isFixo) {
      if (!l.pago) {
        corValor = 'var(--text3)';
      } else if (l.pagamento === 'debito') {
        corValor = 'var(--red)';
      } else if (cartao) {
        corValor = cartao.cor;
      } else {
        corValor = 'var(--red)';
      }
    } else if (isCredito) {
      corValor = isEstorno ? 'var(--green)' : (cartao ? cartao.cor : 'var(--red)');
    } else {
      corValor = 'var(--text3)';
    }

    // bgCor do ícone — mantém baseado em tipo geral
    const bgCor = isEntrada ? 'var(--green-dim)' : isFixo ? '#88889922' :
                  isCredito && cartao ? cartao.cor+'28' : 'var(--red-dim)';
    const sinal = (isEntrada || isEstorno) ? '+' : '-';
    // Crédito: mostra valor total da compra; dataCompra como data de referência
    const valor = isCredito ? Math.abs(l.valorTotal || l.valorParcela || 0) : (l.valor||0);
    const dataRef = isCredito ? (l.dataCompra || l.data) : l.data;
    const dataTxt = dataRef ? new Date(dataRef+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}) : '';

    // ── Nome em destaque: descrição > subcategoria > categoria ──
    let nome;
    if (l.descricao) {
      nome = l.descricao;
    } else if (l.subcat) {
      nome = l.subcat;
    } else if (cat) {
      nome = cat.nome;
    } else {
      nome = l.tipo;
    }

    // ── Detalhe: categoria ou "cat › subcat" ──
    let detalhe = '';
    if (l.subcat && cat) {
      const subObj = cat.subcats ? cat.subcats.find(s=>(typeof s==='string'?s:s.nome)===l.subcat) : null;
      const subEmoji = (subObj && typeof subObj==='object') ? subObj.emoji : '';
      detalhe = `${subEmoji ? subEmoji+' ' : ''}${cat.nome} › ${l.subcat}`;
    } else if (cat) {
      detalhe = cat.nome;
    }
    if (isFixo) {
      detalhe += ` · ${l.pagamento==='debito'?'Gasto fixo · Débito': `Gasto fixo · ${cartao?.nome||'Crédito'}`}`;
      if (l.dataPagamento) {
        const dpTxt = new Date(l.dataPagamento+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
        detalhe += ` · pago em ${dpTxt}`;
      }
    } else if (isCredito && cartao) {
      if (isEstorno) detalhe += ' · Estorno';
      detalhe += ` · ${cartao.nome}`;
      if (l.totalParcelas > 1) detalhe += ` · ${l.totalParcelas}x de ${fmtMoney(Math.abs(l.valorParcela||0))}`;
      else detalhe += ' · à vista';
    } else if (isDebito) {
      detalhe += ' · Débito';
    } else if (l.fixo) {
      detalhe += ' · Entrada fixa';
    }
    if (dataTxt) detalhe += ` · ${dataTxt}`;

    // Badge de status
    const badge = semData ? '<span class="badge badge-nodate">sem data</span>' :
                  pendente ? '<span class="badge badge-pending">pendente</span>' :
                  (isDebito && debitoPendente && l.data) ? '<span class="badge badge-pending">pendente</span>' : '';

    const pagoToggle = (isFixo && showPagoToggle) ? `
      <div class="fixo-pago-toggle ${l.pago?'pago':''}" onclick="event.stopPropagation();App.toggleFixoPago(${l.id})" title="${l.pago?'Não pago':'Marcar como pago'}">
        ${l.pago?'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>':'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/></svg>'}
      </div>` : '';

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
        <div class="feed-val" style="color:${corValor}">${sinal}${fmtMoney(valor)}</div>
        ${badge}
      </div>
    </div>`;
  }

  async function toggleFixoPago(id) {
    const l = state.lancamentos.find(x=>x.id===id);
    if (!l) return;
    l.pago = !l.pago;
    // Ao marcar como pago: registrar data de pagamento como hoje
    if (l.pago) {
      l.dataPagamento = todayStr();
    } else {
      l.dataPagamento = null;
    }
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
    // Crédito: mostrar só a parcela 1 de cada grupo (compra), referenciada pela dataCompra
    // Remover parcelas 2+ do mesmo grupo de crédito
    const gruposVistosLanc = new Set();
    let lancs = [...state.lancamentos].filter(l => {
      if (l.tipo === 'credito' && l.grupoId) {
        if (l.parcela > 1) return false; // só mostra parcela 1
        if (gruposVistosLanc.has(l.grupoId)) return false;
        gruposVistosLanc.add(l.grupoId);
      }
      return true;
    }).sort((a,b)=>{
      const aData = a.tipo==='credito' ? (a.dataCompra||a.data) : a.data;
      const bData = b.tipo==='credito' ? (b.dataCompra||b.data) : b.data;
      const aTemData = !!aData;
      const bTemData = !!bData;
      if (!aTemData && bTemData) return -1;
      if (aTemData && !bTemData) return 1;
      if (!aTemData && !bTemData) {
        const aCat = getCatById(a.categoriaId);
        const bCat = getCatById(b.categoriaId);
        const aLabel = (a.subcat || aCat?.nome || '').toLowerCase();
        const bLabel = (b.subcat || bCat?.nome || '').toLowerCase();
        return aLabel.localeCompare(bLabel, 'pt-BR');
      }
      if (bData !== aData) return bData.localeCompare(aData);
      return (b.criadoEm||0)-(a.criadoEm||0);
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
      const gridCols = subTabs.length <= 3 ? subTabs.length : subTabs.length <= 6 ? 3 : 4;
      subTabsHtml = `<div id="saida-subtabs" style="display:grid;grid-template-columns:repeat(${gridCols},1fr);gap:6px;padding:0 20px 12px;flex-shrink:0">
        ${subTabs.map(t => {
          const isActive = activeKey === t.key;
          const bg = isActive ? (t.cor || 'var(--accent)') : 'var(--bg3)';
          const bc = isActive ? (t.cor || 'var(--accent)') : 'var(--border2)';
          const tx = isActive ? '#fff' : 'var(--text2)';
          const dot = t.cor ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${isActive?'#fff':t.cor};flex-shrink:0"></span>` : '';
          return `<div data-subtab="${t.key}" style="display:flex;align-items:center;justify-content:center;gap:5px;padding:7px 6px;border-radius:12px;border:0.5px solid ${bc};background:${bg};cursor:pointer;transition:all 0.15s">${dot}<span style="font-size:12px;font-weight:500;color:${tx}">${t.label}</span></div>`;
        }).join('')}
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

    // ── Barra de totais dinâmicos ──────────────────
    const totalEntradas = lancs.filter(l=>l.tipo==='entrada'||l.tipo==='entrada_fixa').reduce((s,l)=>s+(isDateConfirmed(l.data)?l.valor:0),0);
    const totalSaidas = lancs.filter(l=>['debito','credito','fixo'].includes(l.tipo)).reduce((s,l)=>{
      if (l.tipo==='fixo') return s+(l.pago ? l.valor : 0);
      if (l.tipo==='debito') return s+(isDateConfirmed(l.data) ? l.valor : 0);
      if (l.tipo==='credito') return s+(isDateConfirmed(l.dataCompra||l.data) ? (l.valorTotal||l.valorParcela||l.valor) : 0);
      return s;
    },0);
    const saldo = totalEntradas - totalSaidas;

    let totaisHtml = '';
    if (lancs.length > 0) {
      if (state.lancTab==='entradas') {
        totaisHtml = `<div style="margin:0 20px 12px;padding:12px 16px;background:var(--bg3);border-radius:14px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;color:var(--text3)">${lancs.length} lançamento${lancs.length!==1?'s':''}</span>
          <span style="font-size:15px;font-weight:700;color:var(--green)">${fmtMoney(totalEntradas)}</span>
        </div>`;
      } else if (state.lancTab==='saidas') {
        totaisHtml = `<div style="margin:0 20px 12px;padding:12px 16px;background:var(--bg3);border-radius:14px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;color:var(--text3)">${lancs.length} lançamento${lancs.length!==1?'s':''}</span>
          <span style="font-size:15px;font-weight:700;color:var(--red)">-${fmtMoney(totalSaidas)}</span>
        </div>`;
      } else if (state.lancTab==='fixos') {
        const totalFixosPagos = lancs.filter(l=>l.pago).reduce((s,l)=>s+l.valor,0);
        const totalFixosPendentes = lancs.filter(l=>!l.pago).reduce((s,l)=>s+l.valor,0);
        totaisHtml = `<div style="margin:0 20px 12px;padding:12px 16px;background:var(--bg3);border-radius:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:12px;color:var(--text3)">${lancs.length} fixo${lancs.length!==1?'s':''}</span>
            <span style="font-size:11px;color:var(--text3)">${lancs.filter(l=>l.pago).length} pago${lancs.filter(l=>l.pago).length!==1?'s':''} · ${lancs.filter(l=>!l.pago).length} pendente${lancs.filter(l=>!l.pago).length!==1?'s':''}</span>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span style="font-size:12px;color:var(--text3)">Pago: <span style="color:var(--red);font-weight:600">-${fmtMoney(totalFixosPagos)}</span></span>
            <span style="font-size:12px;color:var(--text3)">Pendente: <span style="color:var(--text2);font-weight:600">-${fmtMoney(totalFixosPendentes)}</span></span>
          </div>
        </div>`;
      } else {
        // Todos
        const saldoCor = saldo >= 0 ? 'var(--green)' : 'var(--red)';
        const saldoSinal = saldo >= 0 ? '+' : '-';
        totaisHtml = `<div style="margin:0 20px 12px;padding:12px 16px;background:var(--bg3);border-radius:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-size:11px;color:var(--text3)">${lancs.length} lançamento${lancs.length!==1?'s':''}</span>
            <span style="font-size:13px;font-weight:700;color:${saldoCor}">${saldoSinal}${fmtMoney(Math.abs(saldo))}</span>
          </div>
          <div style="display:flex;gap:8px">
            <div style="flex:1;background:var(--bg2);border-radius:10px;padding:8px 10px">
              <div style="font-size:10px;color:var(--text3);margin-bottom:2px">Entradas</div>
              <div style="font-size:13px;font-weight:600;color:var(--green)">${fmtMoney(totalEntradas)}</div>
            </div>
            <div style="flex:1;background:var(--bg2);border-radius:10px;padding:8px 10px">
              <div style="font-size:10px;color:var(--text3);margin-bottom:2px">Saídas</div>
              <div style="font-size:13px;font-weight:600;color:var(--red)">-${fmtMoney(totalSaidas)}</div>
            </div>
          </div>
        </div>`;
      }
    }

    // Filtros + totais vão no bloco colapsável
    const stickyEl = document.getElementById('lanc-sticky-header');
    stickyEl.innerHTML = subTabsHtml + filterHtml + totaisHtml;
    stickyEl.querySelectorAll('[data-subtab]').forEach(el => {
      el.addEventListener('click', () => App.setLancSubTab(el.dataset.subtab));
    });

    // Só os lançamentos vão no feed
    let html = '';
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
    renderLancamentos();
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
      const temDiaFixo = edit?.diaDoMes ? true : false;
      // Se tem diaDoMes, usa lógica automática (sem toggle pago manual)
      el.innerHTML=`${campoValor}
        <div class="field"><div class="field-label">Tipo de pagamento</div>
          <div class="cat-grid" id="payment-grid">
            <div class="cat-chip ${tipoSel==='debito'?'sel':''}" data-pay="debito" onclick="App._selPay(this,'debito')">
              <div class="cat-emoji">🏦</div><div class="cat-name">Débito</div></div>
            ${state.cartoes.map(c=>{const icon=getBancoIconHtml(c.nome,28);return `<div class="cat-chip ${tipoSel===String(c.id)?'sel':''}" data-pay="${c.id}" onclick="App._selPay(this,${c.id})">
              <div class="cat-emoji" style="height:32px;display:flex;align-items:center;justify-content:center">${icon||`<span style="display:inline-block;width:26px;height:26px;border-radius:6px;background:${c.cor}33;display:flex;align-items:center;justify-content:center;font-size:14px">💳</span>`}</div>
              <div class="cat-name">${c.nome}</div></div>`;}).join('')}
          </div></div>
        ${campoCat}
        <div class="row2">
          <div class="field"><div class="field-label">Dia do mês <span class="opt-badge">opcional</span></div>
            <input type="number" id="f-dia-fixo" min="1" max="28" placeholder="Ex: 5" value="${edit?.diaDoMes||''}" oninput="App._onFixoDiaChange()">
            <div style="font-size:11px;color:var(--text3);margin-top:5px">Se preenchido, pagamento automático neste dia</div>
          </div>
          <div class="field" id="campo-data-pagto"><div class="field-label">Data de pagamento <span class="opt-badge">opcional</span></div>
            <input type="date" id="f-data-pagto" value="${edit?.dataPagamento||''}">
          </div>
        </div>
        <div id="fixo-pago-section" style="${edit?.diaDoMes?'display:none':''}">
          <div class="field"><div class="field-label">Pago este mês?</div>
            <div class="toggle-field"><span class="toggle-label">Marcar como pago</span>
              <div class="toggle ${edit?.pago?'on':''}" id="toggle-pago" onclick="this.classList.toggle('on');this.querySelector('.toggle-thumb').style.left=this.classList.contains('on')?'20px':'2px'">
                <div class="toggle-thumb" style="left:${edit?.pago?'20px':'2px'}"></div></div></div></div>
        </div>
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
            ${state.cartoes.map(c=>{const icon=getBancoIconHtml(c.nome,28);return `<div class="cat-chip ${c.id===cartaoSel?'sel':''}" data-cartao="${c.id}" onclick="App._selCartao(this,${c.id})">
              <div class="cat-emoji" style="height:32px;display:flex;align-items:center;justify-content:center">${icon||`<span style="display:inline-block;width:26px;height:26px;border-radius:6px;background:${c.cor}33;display:flex;align-items:center;justify-content:center;font-size:14px">💳</span>`}</div>
              <div class="cat-name">${c.nome}</div></div>`;}).join('')}
          </div></div>
        ${campoCat}${campoDesc}
        <div class="toggle-field" onclick="(function(){var t=document.getElementById('estorno-toggle');var v=t.dataset.on==='1';t.dataset.on=v?'0':'1';t.classList.toggle('on',!v);})()">
          <span class="toggle-label">Estorno (subtrai da fatura)</span>
          <div class="toggle ${edit?.estorno?'on':''}" id="estorno-toggle" data-on="${edit?.estorno?'1':'0'}">
            <div class="toggle-thumb"></div>
          </div>
        </div>
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
    const { dMesBase: dMesBasePrev, dFech: dFechPrev, dVenc: dVencPrev } = calcMesAnoFatura(dCompra, fechamento, vencimento);
    // dMesBase = mês do vencimento (nome da fatura)
    const nomeFatPrev = MONTHS_SHORT[dMesBasePrev.getMonth()]+'/'+String(dMesBasePrev.getFullYear()).slice(2);
    const faturaLabel = `Fatura ${nomeFatPrev} · fecha ${dFechPrev.getDate()}/${dFechPrev.getMonth()+1} · vence ${dVencPrev.getDate()}/${dVencPrev.getMonth()+1}`;
    const parcela=val/n;
    let rows='';
    for(let i=0;i<Math.min(n,6);i++){
      const d=new Date(dMesBasePrev);
      d.setMonth(d.getMonth()+i);
      rows+=`<div class="parcela-row"><span class="parcela-mes">${i+1}/${n} · ${MONTHS[d.getMonth()]}/${d.getFullYear()}</span><span class="parcela-val">${fmtMoney(parcela)}</span></div>`;
    }
    if(n>6) rows+=`<div class="parcela-row"><span class="parcela-mes" style="color:var(--text3)">+ ${n-6} parcelas...</span></div>`;
    rows+=`<div class="parcela-info">${faturaLabel}</div>`;
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
      const diaFixo=parseInt(document.getElementById('f-dia-fixo')?.value||'0')||null;
      const dataPagtoInput=document.getElementById('f-data-pagto')?.value||'';
      obj.diaDoMes=diaFixo||null;
      if(diaFixo){
        // Pagamento automático: data determinada pelo dia do mês
        obj.data=`${state.currentYear}-${String(state.currentMonth+1).padStart(2,'0')}-${String(diaFixo).padStart(2,'0')}`;
        // pago = automaticamente se data <= hoje
        obj.pago=isDateConfirmed(obj.data);
        obj.dataPagamento=obj.pago?(dataPagtoInput||obj.data):null;
      } else {
        obj.pago=document.getElementById('toggle-pago')?.classList.contains('on')||false;
        obj.dataPagamento=dataPagtoInput||null;
      }
      if(!state.editingId){
        // mesAnoMinimo = mês atual (não replicar em meses passados)
        const mesAnoMinimo=mesAnoStr(state.currentMonth,state.currentYear);
        const tmpl={tipo:'fixo',categoriaId:catId,subcat,descricao:desc,valor,pagamento:obj.pagamento,cartaoId:obj.cartaoId,diaDoMes:diaFixo||null,mesAnoMinimo};
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
      const dataCompra=data||todayStr();
      const dCompra=new Date(dataCompra+'T12:00:00');
      const estorno = document.getElementById('estorno-toggle')?.dataset.on === '1';
      const valorParcela=(estorno ? -1 : 1) * (valor/n);
      // Calcular em qual fatura (mesAnoV) a primeira parcela cai, pela regra oficial
      const { mmV: mmV1, yyV: yyV1, mesAnoV: mesAnoFat1 } = faturaDeData(dCompra, cartao);
      if(!state.editingId){
        const grupoId=Date.now();
        // mesAno = mês da COMPRA (para aparecer no mês certo na aba Lançamentos)
        // mesPagamento = mês da FATURA da parcela (mesAnoV) — primeira parcela em mesAnoFat1, depois +1 mês cada
        const mesAnoCompra = mesAnoStr(dCompra.getMonth(), dCompra.getFullYear());
        for(let i=0;i<n;i++){
          // i-ésima parcela: mês da fatura = mmV1 + i
          const dParcela = new Date(yyV1, (mmV1 - 1) + i, 1);
          const maPagamento = mesAnoStr(dParcela.getMonth(), dParcela.getFullYear());
          await DB.addLancamento({
            tipo:'credito',categoriaId:catId,subcat,descricao:desc,
            mesAno:mesAnoCompra,
            mesPagamento:maPagamento,
            dataCompra:dataCompra,
            valorTotal:valor,totalParcelas:n,valorParcela,
            parcela:i+1,cartaoId,data:dataCompra,grupoId,estorno,
          });
        }
        state.lancamentos=await DB.getLancamentos(mesAno);
        // Atualizar gasto fixo de pagamento de fatura
        await atualizarFaturaFixa(cartaoId);
        state.lancamentos=await DB.getLancamentos(mesAno);
        const nomeFat1 = MONTHS_SHORT[mmV1 - 1]+'/'+String(yyV1).slice(2);
        toast(`Compra salva — parcela 1 na fatura ${nomeFat1}`,'ok');
        goBack(); return;
      } else {
        obj.valorTotal=valor;obj.totalParcelas=n;obj.valorParcela=valorParcela;obj.cartaoId=cartaoId;obj.data=dataCompra;obj.dataCompra=dataCompra;obj.estorno=document.getElementById('estorno-toggle')?.dataset.on==='1';
      }
    }

    if(state.editingId){
      obj.id=state.editingId;
      const orig=state.lancamentos.find(l=>l.id===state.editingId);
      if(orig){
        obj.criadoEm=orig.criadoEm;
        obj.grupoId=orig.grupoId;
        obj.templateId=orig.templateId;
        // Preservar identidade da parcela de crédito ao editar
        // (mesAno/mesPagamento determinam em qual mês e fatura ela aparece — sempre vêm do original,
        //  pois o form nem oferece pra editar isso. valor/cartão/data já foram setados acima se mudaram.)
        if(orig.tipo==='credito'){
          obj.mesAno = obj.mesAno || orig.mesAno;
          obj.mesPagamento = obj.mesPagamento || orig.mesPagamento;
          // se o branch credito não setou (ex: edição que nem entra no else por algum motivo), preserva
          if (obj.parcela == null) obj.parcela = orig.parcela;
          if (obj.totalParcelas == null) obj.totalParcelas = orig.totalParcelas;
          if (obj.dataCompra == null) obj.dataCompra = orig.dataCompra;
          // Recalcular mesPagamento se a dataCompra ou cartão mudou
          const cartaoNovo = getCartaoById(obj.cartaoId);
          if (cartaoNovo && obj.dataCompra) {
            const dC = new Date(obj.dataCompra + 'T12:00:00');
            const { mmV, yyV } = faturaDeData(dC, cartaoNovo);
            // i-ésima parcela (1-indexed): mês da fatura = mmV + (parcela-1)
            const dP = new Date(yyV, (mmV - 1) + ((obj.parcela||1) - 1), 1);
            obj.mesPagamento = mesAnoStr(dP.getMonth(), dP.getFullYear());
            obj.mesAno = mesAnoStr(dC.getMonth(), dC.getFullYear());
          }
        }
      }
      // Fixo e entrada_fixa com templateId: perguntar escopo da edição (exceto ao marcar pago)
      const isFixoOuEntradaFixa = (tipo==='fixo'||tipo==='entrada_fixa') && orig?.templateId;
      if(isFixoOuEntradaFixa){
        // Guardar obj pendente e abrir modal de escopo
        state._editPendingObj = obj;
        state._editPendingMesAno = mesAno;
        openModal('confirm-edit-fixo', orig);
        return;
      }
      await DB.updateLancamento(obj);
      // Se editou uma parcela de crédito e mudou data/cartão/valor/qtd parcelas,
      // propagar a mudança para todas as outras parcelas do mesmo grupo.
      if (obj.tipo === 'credito' && obj.grupoId) {
        const orig2 = state.lancamentos.find(l => l.id === obj.id) || {};
        const allLancs = await DB.getAllLancamentos();
        const irmas = allLancs.filter(l => l.grupoId === obj.grupoId && l.id !== obj.id);
        const cartaoAtual = getCartaoById(obj.cartaoId);
        for (const sis of irmas) {
          const novoSis = {
            ...sis,
            // Campos que se aplicam a toda a compra:
            categoriaId: obj.categoriaId,
            subcat: obj.subcat,
            descricao: obj.descricao,
            valorTotal: obj.valorTotal,
            totalParcelas: obj.totalParcelas,
            valorParcela: obj.valorParcela,
            cartaoId: obj.cartaoId,
            estorno: obj.estorno,
            dataCompra: obj.dataCompra,
            data: obj.dataCompra,
            mesAno: obj.mesAno, // mês da compra (igual para todas)
          };
          // Recalcular mesPagamento desta parcela com base na nova dataCompra/cartão
          if (cartaoAtual && obj.dataCompra) {
            const dC = new Date(obj.dataCompra + 'T12:00:00');
            const { mmV, yyV } = faturaDeData(dC, cartaoAtual);
            const dP = new Date(yyV, (mmV - 1) + ((sis.parcela||1) - 1), 1);
            novoSis.mesPagamento = mesAnoStr(dP.getMonth(), dP.getFullYear());
          }
          await DB.updateLancamento(novoSis);
        }
      }
      // Recalcular fatura automática do cartão se afeta uma fatura
      if (obj.tipo === 'credito' && obj.cartaoId) await atualizarFaturaFixa(obj.cartaoId);
      else if (obj.tipo === 'fixo' && obj.cartaoId) await atualizarFaturaFixa(obj.cartaoId);
      toast('Lançamento atualizado!','ok');
    } else {
      await DB.addLancamento(obj);
      toast('Lançamento salvo!','ok');
    }
    state.lancamentos=await DB.getLancamentos(mesAno);
    goBack();
  }

  // Toggle visibilidade do campo "pago" quando diaDoMes é preenchido
  function _onFixoDiaChange() {
    const diaEl = document.getElementById('f-dia-fixo');
    const pagoSection = document.getElementById('fixo-pago-section');
    if (!pagoSection) return;
    const temDia = diaEl && parseInt(diaEl.value) > 0;
    pagoSection.style.display = temDia ? 'none' : '';
  }

  // Confirmar edição apenas deste lançamento
  async function _editarSoEste() {
    const obj = state._editPendingObj;
    const mesAno = state._editPendingMesAno;
    if (!obj) { closeModal(); return; }
    await DB.updateLancamento(obj);
    state._editPendingObj = null;
    state.lancamentos = await DB.getLancamentos(mesAno);
    // Atualizar também o template se diaDoMes mudou (só para este não se propaga, mas valor/categoria pode mudar)
    closeModal();
    toast('Lançamento atualizado!','ok');
    goBack();
  }

  // Confirmar edição deste e todos os próximos
  async function _editarTodosSeguintes() {
    const obj = state._editPendingObj;
    const mesAno = state._editPendingMesAno;
    if (!obj) { closeModal(); return; }
    // 1. Atualizar lançamento atual
    await DB.updateLancamento(obj);
    // 2. Atualizar template para refletir nas cópias futuras
    if (obj.templateId) {
      const templates = await DB.getFixosTemplates();
      const tmpl = templates.find(t => t.id === obj.templateId);
      if (tmpl) {
        const novoTmpl = {...tmpl,
          categoriaId: obj.categoriaId,
          subcat: obj.subcat,
          descricao: obj.descricao,
          valor: obj.valor,
        };
        // Para fixo: salvar pagamento, cartaoId e diaDoMes também
        if (obj.tipo === 'fixo') {
          novoTmpl.pagamento = obj.pagamento;
          novoTmpl.cartaoId = obj.cartaoId;
          novoTmpl.diaDoMes = obj.diaDoMes || null;
        }
        await DB.saveFixoTemplate(novoTmpl);
        // 3. Atualizar todos os lançamentos futuros deste template
        const allLancs = await DB.getAllLancamentos();
        const mesAtual = mesAno;
        for (const l of allLancs.filter(l => l.templateId === obj.templateId && mesAnoNum(l.mesAno) > mesAnoNum(mesAtual))) {
          const updated = {...l,
            categoriaId: obj.categoriaId,
            subcat: obj.subcat,
            descricao: obj.descricao,
            valor: obj.valor,
          };
          if (obj.tipo === 'fixo') {
            updated.pagamento = obj.pagamento;
            updated.cartaoId = obj.cartaoId;
            if (obj.diaDoMes) {
              updated.diaDoMes = obj.diaDoMes;
              // Recalcular data para cada mês futuro
              const [mStr, yStr] = l.mesAno.split('-');
              updated.data = `${yStr}-${mStr}-${String(obj.diaDoMes).padStart(2,'0')}`;
              updated.pago = isDateConfirmed(updated.data);
            } else {
              updated.diaDoMes = null;
            }
          }
          await DB.updateLancamento(updated);
        }
      }
    }
    state._editPendingObj = null;
    state.lancamentos = await DB.getLancamentos(mesAno);
    closeModal();
    toast('Lançamento atualizado em todos os meses seguintes!','ok');
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
    const l=state.lancamentos.find(x=>x.id===id);
    if(!l) return;
    // Fatura automática: não editável
    if(l.autoFatura) {
      toast('Este lançamento é gerado automaticamente e não pode ser editado','info',3000);
      return;
    }
    state.editingId=id;
    gotoScreen('screen-novo');
    // entrada fixa tem templateId e fixo=true
    setTipoLanc(l.fixo?'entrada_fixa':l.tipo);
  }

  /* ══════════════════════════════════════
     RELATÓRIOS
  ══════════════════════════════════════ */
  function setRelTab(tab){
    state.relTab=tab;
    ['mensal','evolucao','cartoes','parcelamentos'].forEach(t=>document.getElementById('rt-'+t)?.classList.toggle('active',t===tab));
    const nav=document.getElementById('rel-month-nav');
    if(nav) nav.style.display=tab==='mensal'?'flex':'none';
    renderRelatorios();
  }

  async function renderRelatorios(){
    const el=document.getElementById('rel-content');
    el.innerHTML='<div class="spinner"></div>';
    if(state.relTab==='mensal') await renderRelMensal(el);
    else if(state.relTab==='cartoes') await renderLimiteCartoes(el);
    else if(state.relTab==='parcelamentos') await renderParcelamentos(el);
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
    const debito=lancs.filter(l=>l.tipo==='debito'&&isDateConfirmed(l.data)).reduce((s,l)=>s+(l.valor||0),0);
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
    propagarSaldoParaProximoMes(saldoFinal, state.currentMonth, state.currentYear);

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
  }

  async function renderLimiteCartoes(parentEl, append=false) {
    const allLancs = await DB.getAllLancamentos();
    const mesAtualKey = mesAnoStr(new Date().getMonth(), new Date().getFullYear());
    const hoje = new Date();

    // _faturasPagas precisa estar atualizado
    _faturasPagas = new Set();
    allLancs.filter(l => l.autoFatura && l.faturaCartaoId && l.pago && l.mesAno)
            .forEach(l => _faturasPagas.add(l.faturaCartaoId + '|' + l.mesAno));

    const rows = await Promise.all(state.cartoes.map(async c => {
      // Fatura ATUAL pela regra oficial
      const { mesAnoV: mesAnoFatAtual } = faturaAtual(c);

      // Limite comprometido = soma de créditos cuja FATURA (mesPagamento) é a atual ou futuras
      const parcelasEmAberto = allLancs.filter(l =>
        !l.autoFatura && l.tipo === 'credito' && l.cartaoId === c.id &&
        mesAnoNum(l.mesPagamento || l.mesAno) >= mesAnoNum(mesAnoFatAtual)
      );
      const totalComprometido = parcelasEmAberto.reduce((s, l) => s + Math.abs(l.valorParcela || 0), 0);

      const pct = c.limite ? Math.min((totalComprometido / c.limite) * 100, 100) : 0;
      const disp = Math.max((c.limite || 0) - totalComprometido, 0);
      const iconHtml = getBancoIconHtml(c.nome, 28);
      return `<div style="margin-bottom:12px;background:var(--bg3);border-radius:14px;padding:14px;cursor:pointer;transition:opacity 0.15s;active:opacity:0.7" onclick="App._openCartaoBS(${c.id})" ontouchstart="this.style.opacity='0.7'" ontouchend="this.style.opacity='1'">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          ${iconHtml || `<div style="width:28px;height:28px;border-radius:7px;background:${c.cor}22;display:flex;align-items:center;justify-content:center;font-size:13px">💳</div>`}
          <span style="font-size:15px;font-weight:600;color:${c.cor}">${c.nome}</span>
          <span style="margin-left:auto;font-size:13px;font-family:'DM Mono',monospace;color:var(--text2)">${fmtMoney(totalComprometido)} <span style="color:var(--text3)">/ ${fmtMoney(c.limite||0)}</span></span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--text3)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div style="height:8px;background:var(--bg4);border-radius:4px;overflow:hidden;margin-bottom:6px">
          <div style="height:100%;width:${pct}%;background:${c.cor};border-radius:4px"></div>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:11px;color:var(--text3)">${pct.toFixed(1)}% comprometido</span>
          <span style="font-size:11px;color:var(--text3)">${fmtMoney(disp)} disponível</span>
        </div>
      </div>`;
    }));

    const cardHtml = `<div style="padding:16px 16px 0">
      <div class="card" style="padding:20px">
        <div class="section-label" style="padding:0;margin-bottom:4px">Limite comprometido</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:16px">Total de parcelas em aberto vs. limite do cartão</div>
        ${rows.join('')}
      </div>
    </div>
    <div style="height:20px"></div>`;

    if (append) {
      parentEl.insertAdjacentHTML('beforeend', cardHtml);
    } else {
      parentEl.innerHTML = cardHtml;
    }
  }

  function _setRelPeriodo(p){state.relPeriodo=p;renderRelatorios();}

  /* ── Bottom Sheet: Detalhe do Cartão ── */
  let _cartaoBSPeriodo = 6; // meses padrão
  let _cartaoBSFaturaSel = null; // fatura selecionada no bottom sheet (mesAnoV); null = fatura atual

  function _closeCartaoBS(e) {
    if (e && e.target !== document.getElementById('cartao-bs-overlay')) return;
    document.getElementById('cartao-bs-overlay').classList.remove('open');
  }

  async function _openCartaoBS(cartaoId) {
    const overlay = document.getElementById('cartao-bs-overlay');
    const header  = document.getElementById('cartao-bs-header');
    const body    = document.getElementById('cartao-bs-body');
    const c = getCartaoById(cartaoId);
    if (!c) return;
    _cartaoBSFaturaSel = null; // sempre começa na fatura atual

    // Header
    const iconHtml = getBancoIconHtml(c.nome, 32);
    header.innerHTML = `
      ${iconHtml || `<div style="width:32px;height:32px;border-radius:9px;background:${c.cor}22;display:flex;align-items:center;justify-content:center;font-size:16px">💳</div>`}
      <div style="flex:1">
        <div style="font-size:17px;font-weight:700;color:${c.cor}">${c.nome}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:1px">Limite total: ${fmtMoney(c.limite||0)}</div>
      </div>
      <button onclick="App._closeCartaoBS({target:document.getElementById('cartao-bs-overlay')})"
        style="width:30px;height:30px;border-radius:50%;border:none;background:var(--bg4);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--text2)" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;

    body.innerHTML = '<div style="padding:40px 0;text-align:center;color:var(--text3);font-size:13px">Carregando…</div>';
    overlay.classList.add('open');

    await _renderCartaoBSBody(c);
  }

  async function _renderCartaoBSBody(c) {
    const body = document.getElementById('cartao-bs-body');
    const allLancs = await DB.getAllLancamentos();
    const hoje = new Date();

    // ── Calcular fatura ATUAL pela regra oficial ──
    // Fatura atual = aquela cujo período (diaF/mesV-1 a diaF-1/mesV) inclui hoje
    const { mesAnoV: mesAnoFatAtual } = faturaAtual(c);
    // Fatura SELECIONADA: por padrão a atual; pode ser sobrescrita pelo clique no gráfico
    const mesAnoFatKey = _cartaoBSFaturaSel || mesAnoFatAtual;
    const { dInicio, dFim, dVenc } = periodoFatura(mesAnoFatKey, c);
    const dFech = dFim; // "fechamento" exibido = último dia do período
    const isFaturaAtual = mesAnoFatKey === mesAnoFatAtual;

    // ── 1. Fatura atual ──
    _faturasPagas = new Set();
    allLancs.filter(l => l.autoFatura && l.faturaCartaoId && l.pago && l.mesAno)
            .forEach(l => _faturasPagas.add(l.faturaCartaoId + '|' + l.mesAno));

    // mesAnoFatKey já é o mês do vencimento (nome da fatura)
    const [mmFat, yyFat] = mesAnoFatKey.split('-').map(Number);

    // Valor da fatura = soma dos créditos cuja FATURA (mesPagamento) é a atual
    let valorFatura = 0;
    allLancs.filter(l => !l.autoFatura && l.tipo === 'credito' && l.cartaoId === c.id &&
                         (l.mesPagamento || l.mesAno) === mesAnoFatKey)
            .forEach(l => { valorFatura += Math.abs(l.valorParcela || 0); });
    allLancs.filter(l => !l.autoFatura && l.tipo === 'fixo' && l.pago && l.cartaoId === c.id &&
                         (l.mesPagamento || l.mesAno) === mesAnoFatKey)
            .forEach(l => { valorFatura += (l.valor || 0); });
    // Status pago: via fatura automática
    const faturasCartao = allLancs.filter(l => l.autoFatura && l.faturaCartaoId === c.id);
    const faturaAutoAtual = faturasCartao.find(l => l.mesAno === mesAnoFatKey);
    const pago = faturaAutoAtual ? !!faturaAutoAtual.pago : false;

    const strFech = dFech.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
    const strVenc = dVenc.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});

    // Label da fatura = mês do vencimento (nome oficial)
    const MONTHS_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    const labelMesFatura = `${MONTHS_PT[mmFat-1]} de ${yyFat}`;

    const statusColor = pago ? '#4ade80' : (valorFatura > 0 ? '#f59e0b' : '#6b7280');
    let statusLabel, statusBg;
    if (pago) { statusLabel = '✓ Paga'; statusBg = '#4ade8020'; }
    else if (!isFaturaAtual && mesAnoNum(mesAnoFatKey) > mesAnoNum(mesAnoFatAtual)) {
      statusLabel = valorFatura > 0 ? '📅 Programada' : '– Sem lançamentos';
      statusBg = valorFatura > 0 ? '#a78bfa20' : '#6b728020';
    } else {
      statusLabel = valorFatura > 0 ? '⏳ Aberta' : '– Sem lançamentos';
      statusBg = valorFatura > 0 ? '#f59e0b20' : '#6b728020';
    }

    // ── 2. Histórico (gráfico) ──
    // Eixo X = faturas (mesAnoV). Sempre começa na fatura ATUAL e mostra:
    //   • à esquerda: (_cartaoBSPeriodo - 1) faturas passadas
    //   • à direita: todas as faturas FUTURAS que tenham parcelas cadastradas
    // Isso permite ver compromissos futuros sem precisar configurar período.
    const meses = _cartaoBSPeriodo;
    // Descobrir o mes mais distante no futuro com parcelas deste cartão
    const futurosKeys = allLancs
      .filter(l => !l.autoFatura && l.tipo === 'credito' && l.cartaoId === c.id)
      .map(l => l.mesPagamento || l.mesAno)
      .filter(k => k && mesAnoNum(k) > mesAnoNum(mesAnoFatAtual));
    const maiorFuturo = futurosKeys.length
      ? futurosKeys.reduce((a, b) => mesAnoNum(a) > mesAnoNum(b) ? a : b)
      : mesAnoFatAtual;
    const [mmAtu, yyAtu] = mesAnoFatAtual.split('-').map(Number);
    const [mmMax, yyMax] = maiorFuturo.split('-').map(Number);
    // Quantos meses no futuro a partir da fatura atual
    const offsetFuturoMax = (yyMax - yyAtu) * 12 + (mmMax - mmAtu);
    const histDados = [];
    // Primeiro as passadas + atual
    for (let i = meses - 1; i >= 0; i--) {
      const dRef = new Date(yyAtu, (mmAtu - 1) - i, 1);
      const keyVenc = mesAnoStr(dRef.getMonth(), dRef.getFullYear());
      let valorRef = 0;
      allLancs.filter(l => !l.autoFatura && l.tipo === 'credito' && l.cartaoId === c.id &&
                           (l.mesPagamento || l.mesAno) === keyVenc)
              .forEach(l => { valorRef += Math.abs(l.valorParcela || 0); });
      histDados.push({
        label: dRef.toLocaleDateString('pt-BR',{month:'short'}).replace('.',''),
        valor: valorRef,
        key: keyVenc,
        isAtual: keyVenc === mesAnoFatAtual,
        isFutura: false,
      });
    }
    // Depois as futuras com parcelas
    for (let i = 1; i <= offsetFuturoMax; i++) {
      const dRef = new Date(yyAtu, (mmAtu - 1) + i, 1);
      const keyVenc = mesAnoStr(dRef.getMonth(), dRef.getFullYear());
      let valorRef = 0;
      allLancs.filter(l => !l.autoFatura && l.tipo === 'credito' && l.cartaoId === c.id &&
                           (l.mesPagamento || l.mesAno) === keyVenc)
              .forEach(l => { valorRef += Math.abs(l.valorParcela || 0); });
      if (valorRef === 0) continue; // só mostra futuras se tiverem valor
      histDados.push({
        label: dRef.toLocaleDateString('pt-BR',{month:'short'}).replace('.',''),
        valor: valorRef,
        key: keyVenc,
        isAtual: false,
        isFutura: true,
      });
    }
    const maxVal = Math.max(...histDados.map(d=>d.valor), 1);

    const barsHtml = histDados.map(d => {
      const h = Math.max((d.valor / maxVal) * 66, d.valor > 0 ? 4 : 0);
      const isSel = d.key === mesAnoFatKey;
      const bg = isSel ? c.cor : (d.isAtual ? c.cor + 'aa' : c.cor + '55');
      return `<div class="cartao-bs-bar-wrap">
        <div class="cartao-bs-bar${isSel?' active':''}"
          style="height:${h}px;background:${bg};cursor:pointer"
          onclick="App._setCartaoBSFatura(${c.id},'${d.key}')">
          <div class="cartao-bs-bar-tip">${fmtMoney(d.valor)}</div>
        </div>
        <div class="cartao-bs-bar-label" style="${d.isFutura?'opacity:0.6;font-style:italic':''}">${d.label}</div>
      </div>`;
    }).join('');

    // ── 3. Transações da fatura atual ──
    // Parcelas (crédito) E gastos fixos pagos no crédito cuja FATURA (mesPagamento) é a atual
    const txAtual = allLancs.filter(l =>
      !l.autoFatura && l.cartaoId === c.id &&
      (l.mesPagamento || l.mesAno) === mesAnoFatKey &&
      (l.tipo === 'credito' || (l.tipo === 'fixo' && l.pago))
    ).sort((a,b) => (b.dataCompra||b.data||'').localeCompare(a.dataCompra||a.data||''));

    const txHtml = txAtual.length === 0
      ? `<div style="padding:16px 0;text-align:center;color:var(--text3);font-size:13px">Nenhuma transação nesta fatura</div>`
      : txAtual.map(l => {
          const cat = getCatById(l.categoriaId);
          // Ícone: emoji da subcategoria ou categoria
          let emoji = cat?.emoji || '💳';
          if (l.subcat && cat?.subcats) {
            const sub = cat.subcats.find(s => (typeof s==='object' ? s.nome : s) === l.subcat);
            if (sub?.emoji) emoji = sub.emoji;
          }
          const cor = c.cor;
          const isFixoCred = l.tipo === 'fixo';
          const isEstornoCred = l.tipo === 'credito' && l.estorno;
          // Nome: descrição > subcat > cat
          const nome = l.descricao || l.subcat || cat?.nome || 'Compra';
          // Detalhe: "subcat · data da compra · parcela X/Y" (ou "Gasto fixo" pra fixo)
          let sub = '';
          if (l.subcat && cat) sub = `${cat.nome} › ${l.subcat}`;
          else if (cat) sub = cat.nome;
          const dataCompraFmt = (l.dataCompra||l.data)
            ? new Date((l.dataCompra||l.data)+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})
            : '';
          if (dataCompraFmt) sub += (sub ? ' · ' : '') + dataCompraFmt;
          let parcelaInfo;
          if (isFixoCred) {
            parcelaInfo = ` · <span style="font-size:10px;padding:1px 5px;border-radius:4px;background:${cor}22;color:${cor}">fixo</span>`;
          } else if (l.totalParcelas > 1) {
            parcelaInfo = ` · <span style="font-size:10px;padding:1px 5px;border-radius:4px;background:${cor}22;color:${cor}">${l.parcela||1}/${l.totalParcelas}</span>`;
          } else {
            parcelaInfo = ' · à vista';
          }
          const valor = isFixoCred
            ? Math.abs(l.valor || 0)
            : Math.abs(l.valorParcela || 0);
          const sinal = isEstornoCred ? '+' : '-';
          const corValor = isEstornoCred ? 'var(--green)' : cor;
          return `<div class="feed-item" onclick="App.editLancamento(${l.id})" style="margin:0 0 4px;border-radius:10px">
            <div class="feed-icon" style="background:${cor}22">
              <span style="font-size:17px;line-height:1">${emoji}</span>
            </div>
            <div class="feed-info">
              <div class="feed-nome">${nome}${parcelaInfo}</div>
              <div class="feed-cat">${sub}</div>
            </div>
            <div class="feed-right">
              <div class="feed-val" style="color:${corValor}">${sinal}${fmtMoney(valor)}</div>
            </div>
          </div>`;
        }).join('');

    // ── 4. Parcelas em aberto — reutilizando lógica de renderParcelamentos ──
    const creditos = allLancs.filter(l =>
      l.tipo === 'credito' && l.totalParcelas > 1 && l.grupoId && l.cartaoId === c.id
    );
    const grupos = {};
    creditos.forEach(l => {
      if (!grupos[l.grupoId]) grupos[l.grupoId] = [];
      grupos[l.grupoId].push(l);
    });

    const comprasParc = Object.values(grupos).map(parcelas => {
      parcelas.sort((a,b) => (a.parcela||0) - (b.parcela||0));
      const primeira = parcelas[0];
      const n = primeira.totalParcelas || parcelas.length;
      const valorParcela = primeira.valorParcela || 0;
      const totalCompra = primeira.valorTotal || (valorParcela * n);
      const pagas = parcelas.filter(p => isParcelaPaga(p.mesPagamento || p.mesAno, c)).length;
      const restantes = n - pagas;
      return { primeira, n, valorParcela, totalCompra, pagas, restantes, concluida: restantes === 0 };
    }).filter(cp => !cp.concluida);

    const parcHtml = comprasParc.length === 0
      ? `<div style="padding:16px 0;text-align:center;color:var(--text3);font-size:13px">Nenhuma parcela em aberto</div>`
      : comprasParc.map(cp => {
          const { primeira, n, valorParcela, pagas, restantes } = cp;
          const valRestante = valorParcela * restantes;
          const pct = Math.round((pagas / n) * 100);
          return `<div class="cartao-bs-parc">
            <div class="cartao-bs-parc-top">
              <div class="cartao-bs-parc-desc">${primeira.descricao||'Parcela'}</div>
              <div class="cartao-bs-parc-vals">
                <div class="cartao-bs-parc-mensal">${fmtMoney(Math.abs(valorParcela))}/mês</div>
                <div class="cartao-bs-parc-restante">${fmtMoney(Math.abs(valRestante))} restante</div>
              </div>
            </div>
            <div class="cartao-bs-parc-prog-row">
              <span class="cartao-bs-parc-prog-label">${pagas}/${n} pagas</span>
              <span class="cartao-bs-parc-prog-label">${restantes} restantes</span>
            </div>
            <div class="cartao-bs-mini-bar">
              <div class="cartao-bs-mini-fill" style="width:${pct}%;background:${c.cor}"></div>
            </div>
          </div>`;
        }).join('');

    body.innerHTML = `
      <!-- Fatura -->
      <div class="cartao-bs-section">
        <div class="cartao-bs-section-title">${isFaturaAtual ? 'Fatura atual' : 'Fatura selecionada'}</div>
        <div class="cartao-bs-fatura-card">
          <div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:4px">${labelMesFatura}</div>
            <div class="cartao-bs-fatura-valor">${fmtMoney(valorFatura)}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="cartao-bs-status" style="background:${statusBg};color:${statusColor}">${statusLabel}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <div class="cartao-bs-fatura-row">
              <span class="cartao-bs-fatura-label">Fechamento</span>
              <span class="cartao-bs-fatura-val">${strFech}</span>
            </div>
            <div class="cartao-bs-fatura-row">
              <span class="cartao-bs-fatura-label">Vencimento</span>
              <span class="cartao-bs-fatura-val">${strVenc}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Evolução -->
      <div class="cartao-bs-section">
        <div class="cartao-bs-section-title">Evolução das faturas</div>
        <div class="cartao-bs-period-sel">
          ${[3,6,12].map(n=>`<button class="cartao-bs-period-btn${_cartaoBSPeriodo===n?' active':''}"
            onclick="App._setCartaoBSPeriodo(${c.id},${n})">${n}M</button>`).join('')}
        </div>
        <div class="cartao-bs-bars">${barsHtml}</div>
      </div>

      <!-- Transações -->
      <div class="cartao-bs-section">
        <div class="cartao-bs-section-title">Transações · ${labelMesFatura}</div>
        ${txHtml}
      </div>

      <!-- Parcelas em aberto -->
      <div class="cartao-bs-section" style="margin-bottom:20px">
        <div class="cartao-bs-section-title">Parcelas em aberto</div>
        ${parcHtml}
      </div>
    `;
  }

  async function _setCartaoBSPeriodo(cartaoId, meses) {
    _cartaoBSPeriodo = meses;
    const c = getCartaoById(cartaoId);
    if (c) await _renderCartaoBSBody(c);
  }

  async function _setCartaoBSFatura(cartaoId, mesAnoV) {
    _cartaoBSFaturaSel = mesAnoV;
    const c = getCartaoById(cartaoId);
    if (c) {
      await _renderCartaoBSBody(c);
      // Scroll suave para a seção de transações
      const body = document.getElementById('cartao-bs-body');
      const transSec = body?.querySelector('.cartao-bs-section .cartao-bs-section-title');
      // Procurar a seção de transações
      const titles = body?.querySelectorAll('.cartao-bs-section-title');
      if (titles) {
        for (const t of titles) {
          if (t.textContent.startsWith('Transações')) {
            t.scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
          }
        }
      }
    }
  }

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
    ['categorias','cartoes','aparencia','dados'].forEach(t=>document.getElementById('ct-'+t)?.classList.toggle('active',t===tab));
    renderPerfil();
  }

  async function renderPerfil(){
    const el=document.getElementById('cfg-content');
    el.innerHTML='<div class="spinner"></div>';
    if(state.cfgTab==='categorias') await renderCfgCategorias(el);
    else if(state.cfgTab==='cartoes') await renderCfgCartoes(el);
    else if(state.cfgTab==='aparencia') await renderCfgAparencia(el);
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
    el.innerHTML=state.cartoes.map(c=>{
      return `<div class="cartao-cfg-card">
        <div class="cartao-cfg-header">
          ${getBancoIconHtml(c.nome,36)||`<div class="cartao-cfg-band" style="background:${c.cor}"></div>`}
          <div class="cartao-cfg-info"><div class="cartao-cfg-nome">${c.nome}</div><div class="cartao-cfg-datas">Fecha dia ${c.fechamento} · Vence dia ${c.vencimento}</div></div>
        </div>
        <div class="cartao-cfg-body">
          <div class="cartao-cfg-fields">
            <div><div class="cartao-cfg-field-label">Fechamento</div><input type="number" min="1" max="28" value="${c.fechamento}" onchange="App._updateCartao(${c.id},'fechamento',this.value)"></div>
            <div><div class="cartao-cfg-field-label">Vencimento</div><input type="number" min="1" max="31" value="${c.vencimento}" onchange="App._updateCartao(${c.id},'vencimento',this.value)"></div>
            <div style="grid-column:1/-1"><div class="cartao-cfg-field-label">Limite total</div><input type="text" value="${(c.limite||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}" oninput="App._maskMoney(this)" onchange="App._updateCartao(${c.id},'limite',this.value)"></div>
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



  async function renderCfgAparencia(el){
    const tema=await DB.getConfig('tema','dark');
    const isLight=tema==='light';
    el.innerHTML=`
      <div class="card" style="padding:20px;margin-bottom:14px">
        <div class="section-label" style="padding:0;margin-bottom:16px">Tema</div>
        <div style="display:flex;gap:12px">
          <div class="tema-option ${!isLight?'ativo':''}" onclick="App._setTema('dark')" id="tema-dark" style="flex:1;border-radius:14px;padding:16px;border:2px solid ${!isLight?'var(--accent)':'var(--border2)'};cursor:pointer;background:${!isLight?'var(--accent-dim)':'var(--bg3)'};transition:all 0.2s;display:flex;flex-direction:column;align-items:center;gap:10px">
            <div style="width:48px;height:48px;border-radius:12px;background:#0f0f12;display:flex;align-items:center;justify-content:center;font-size:22px">🌙</div>
            <span style="font-size:13px;font-weight:500;color:${!isLight?'var(--accent2)':'var(--text2)'}">Escuro</span>
          </div>
          <div class="tema-option ${isLight?'ativo':''}" onclick="App._setTema('light')" id="tema-light" style="flex:1;border-radius:14px;padding:16px;border:2px solid ${isLight?'var(--accent)':'var(--border2)'};cursor:pointer;background:${isLight?'var(--accent-dim)':'var(--bg3)'};transition:all 0.2s;display:flex;flex-direction:column;align-items:center;gap:10px">
            <div style="width:48px;height:48px;border-radius:12px;background:#f0f2f5;display:flex;align-items:center;justify-content:center;font-size:22px">☀️</div>
            <span style="font-size:13px;font-weight:500;color:${isLight?'var(--accent2)':'var(--text2)'}">Claro</span>
          </div>
        </div>
      </div>`;
  }

  async function _setTema(tema){
    await DB.setConfig('tema',tema);
    _aplicarTema(tema);
    const el=document.getElementById('cfg-content');
    await renderCfgAparencia(el);
  }

  function _aplicarTema(tema){
    document.body.classList.toggle('light-mode',tema==='light');
  }

  async function renderCfgDados(el){
    const allLancs=await DB.getAllLancamentos();
    const meses=[...new Set(allLancs.map(l=>l.mesAno))].sort();
    el.innerHTML=`
      <div class="card" style="padding:20px;margin-bottom:14px">
        <div class="section-label" style="padding:0;margin-bottom:12px">Banco de dados</div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid var(--border)"><span style="font-size:13px;color:var(--text2)">Total de lançamentos</span><span style="font-size:13px;font-family:'DM Mono',monospace">${allLancs.length}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid var(--border)"><span style="font-size:13px;color:var(--text2)">Meses com dados</span><span style="font-size:13px;font-family:'DM Mono',monospace">${meses.length}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span style="font-size:13px;color:var(--text2)">Período</span><span style="font-size:13px;font-family:'DM Mono',monospace">${meses.length>0?(()=>{const [mm0,yy0]=meses[0].split('-');const [mmN,yyN]=meses[meses.length-1].split('-');return MONTHS_SHORT[parseInt(mm0)-1]+'/'+yy0.slice(2)+' – '+MONTHS_SHORT[parseInt(mmN)-1]+'/'+yyN.slice(2);})():'—'}</span></div>
      </div>
      <button class="action-btn success" onclick="App._exportar()"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Exportar backup (JSON)</button>
      <button class="action-btn secondary" onclick="document.getElementById('import-input').click()"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Importar backup (JSON)</button>
      <input type="file" id="import-input" accept=".json" style="display:none" onchange="App._importar(this)">
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
    else if(type==='confirm-edit-fixo'){
      const isEntradaFixa=data.fixo||false;
      content.innerHTML=`<div class="modal-title">Editar ${isEntradaFixa?'entrada fixa':'gasto fixo'} recorrente</div>
        <p style="font-size:14px;color:var(--text2);line-height:1.6;margin-bottom:20px">Este lançamento se repete mensalmente. Aplicar alteração apenas a este mês ou a todos os meses seguintes?</p>
        <div class="modal-btns" style="flex-direction:column">
          <button class="btn-save" style="margin-bottom:8px" onclick="App._editarTodosSeguintes()">Este e todos os próximos meses</button>
          <button class="btn-cancel" style="margin-bottom:8px" onclick="App._editarSoEste()">Só este mês</button>
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
    const savedId = await DB.saveCartao(obj);
    state.cartoes=await DB.getCartoes();
    // Criar gastos fixos de fatura para este cartão em meses futuros
    const cartaoFinalId = id !== null ? id : savedId;
    if(cartaoFinalId) await atualizarFaturaFixa(cartaoFinalId);
    closeModal();renderPerfil();toast(id!==null?'Cartão atualizado':'Cartão adicionado','ok');
  }
  // Cria/atualiza o template de "fatura" automático do cartão
  async function _sincronizarFaturaTemplate(cartaoId) {
    const templates = await DB.getFixosTemplates();
    const antigo = templates.find(t => t.faturaCartaoId === cartaoId);
    if (antigo) await DB.deleteFixoTemplate(antigo.id);
    const mesAnoMinimo = mesAnoStr(new Date().getMonth(), new Date().getFullYear());
    const tmplId = await DB.saveFixoTemplate({
      tipo: 'fatura_cartao',
      faturaCartaoId: cartaoId,
      categoriaId: null,
      descricao: `Fatura ${getCartaoById(cartaoId)?.nome||'Cartão'}`,
      valor: 0,
      pagamento: String(cartaoId),
      cartaoId: cartaoId,
      mesAnoMinimo,
      autoFatura: true,
    });
    return tmplId;
  }

  // Recalcula e atualiza o gasto fixo de pagamento de fatura de um cartão
  // para o mês M+1 com base nos créditos do mês M
  // Recalcula os lançamentos automáticos de pagamento de fatura para um cartão.
  // Regra: para cada fatura (identificada pelo mesAno do vencimento = mesAnoFat),
  // o lançamento automático fica no mesmo mesAno (= mês do vencimento)
  // com valor = soma de todos os créditos cujo mesAno == mesAnoFat.
  // A data do lançamento = diaV/mesV/anoV (data de vencimento).
  async function atualizarFaturaFixa(cartaoId) {
    const allLancs = await DB.getAllLancamentos();
    const cartao = getCartaoById(cartaoId);
    if (!cartao) return;
    const hoje = new Date();
    const mesAtualKey = mesAnoStr(hoje.getMonth(), hoje.getFullYear());

    // Coletar todos os mesAno de faturas que têm parcelas deste cartão
    const mesesFatura = [...new Set(
      allLancs.filter(l => !l.autoFatura && l.tipo === 'credito' && l.cartaoId === cartaoId)
              .map(l => l.mesPagamento || l.mesAno)
    )];
    // Garantir que a fatura atual também é processada (mesmo sem créditos)
    // Fatura ATUAL pela regra oficial
    const { mesAnoV: mesAnoFatAtual } = faturaAtual(cartao);
    const diaV = cartao.vencimento || 10;
    if (!mesesFatura.includes(mesAnoFatAtual)) mesesFatura.push(mesAnoFatAtual);

    for (const mesAnoFat of mesesFatura) {
      // Não criar lançamentos em meses passados
      if (mesAnoNum(mesAnoFat) < mesAnoNum(mesAtualKey)) continue;

      // Valor = soma de todas as parcelas deste cartão cuja FATURA (mesPagamento) é mesAnoFat
      const parcelasFatura = allLancs.filter(l =>
        !l.autoFatura && l.tipo === 'credito' &&
        l.cartaoId === cartaoId && (l.mesPagamento || l.mesAno) === mesAnoFat
      );
      let totalFatura = parcelasFatura.reduce((s, l) => s + Math.abs(l.valorParcela || 0), 0);
      // Inclui fixos do cartão pagos nesta fatura
      allLancs.filter(l => l.tipo === 'fixo' && !l.autoFatura && l.cartaoId === cartaoId &&
                            (l.mesPagamento || l.mesAno) === mesAnoFat && l.pago)
              .forEach(l => { totalFatura += (l.valor || 0); });

      // Data de vencimento desta fatura: diaV no mês do mesAnoFat
      const [mmFat, yyFat] = mesAnoFat.split('-').map(Number);
      const dataVenc = `${yyFat}-${String(mmFat).padStart(2,'0')}-${String(diaV).padStart(2,'0')}`;

      const existente = allLancs.find(l =>
        l.autoFatura && l.faturaCartaoId === cartaoId && l.mesAno === mesAnoFat
      );

      const obj = {
        tipo: 'fixo',
        faturaCartaoId: cartaoId,
        cartaoId: null,
        pagamento: 'debito',
        descricao: `Fatura ${cartao.nome}`,
        valor: totalFatura,
        categoriaId: null,
        pago: existente?.pago || false,
        data: dataVenc,
        dataPagamento: existente?.dataPagamento || null,
        mesAno: mesAnoFat,
        autoFatura: true,
        criadoEm: existente?.criadoEm || Date.now(),
      };

      if (existente) {
        if (totalFatura > 0) { obj.id = existente.id; await DB.updateLancamento(obj); }
        else { await DB.deleteLancamento(existente.id); }
      } else if (totalFatura > 0) {
        await DB.addLancamento(obj);
      }
    }
  }

  async function _deletarTodasParcelas(grupoId){
    const allLancs=await DB.getAllLancamentos();
    const grupo = allLancs.filter(l=>l.grupoId===grupoId);
    const cartaoId = grupo[0]?.cartaoId;
    for(const l of grupo) await DB.deleteLancamento(l.id);
    if(cartaoId) await atualizarFaturaFixa(cartaoId);
    state.lancamentos=await DB.getLancamentos(mesAnoStr(state.currentMonth,state.currentYear));
    closeModal();toast('Todas as parcelas excluídas','info');goBack();
  }
  async function _deletarUmaParcela(id){
    const allLancs=await DB.getAllLancamentos();
    const lanc=allLancs.find(l=>l.id===id);
    const cartaoId=lanc?.cartaoId;
    await DB.deleteLancamento(id);
    if(cartaoId) await atualizarFaturaFixa(cartaoId);
    state.lancamentos=await DB.getLancamentos(mesAnoStr(state.currentMonth,state.currentYear));
    closeModal();toast('Parcela excluída','info');goBack();
  }
  async function _deletarFixoTemplate(templateId,id){
    await DB.deleteFixoTemplate(templateId);
    await DB.clearFixosDeletadosByTemplate(templateId); // limpar registros de deleção manual
    const allLancs=await DB.getAllLancamentos();
    const mesAtual=mesAnoStr(state.currentMonth,state.currentYear);
    for(const l of allLancs.filter(l=>l.templateId===templateId&&l.mesAno>=mesAtual))
      await DB.deleteLancamento(l.id);
    state.lancamentos=await DB.getLancamentos(mesAtual);
    closeModal();toast('Removido de todos os meses','info');goBack();
  }
  async function _deletarUmFixo(id){
    const allLancs=await DB.getAllLancamentos();
    const lanc=allLancs.find(l=>l.id===id);
    await DB.deleteLancamento(id);
    // Registrar que este template foi deletado manualmente neste mês
    // para que ensureFixosMes não recrie o lançamento ao navegar
    if(lanc?.templateId && lanc?.mesAno){
      await DB.markFixoDeletado(lanc.templateId, lanc.mesAno);
    }
    state.lancamentos=await DB.getLancamentos(mesAnoStr(state.currentMonth,state.currentYear));
    closeModal();toast('Excluído deste mês','info');goBack();
  }

  /* ══════════════════════════════════════
     INIT
  ══════════════════════════════════════ */



  async function migrarDataFaturas() {
    const jaRodou = localStorage.getItem('migr_data_fatura_v1');
    if (jaRodou) return;
    const allLancs = await DB.getAllLancamentos();
    const faturas = allLancs.filter(l => l.autoFatura && l.faturaCartaoId && !l.data);
    for (const l of faturas) {
      const cartao = getCartaoById(l.faturaCartaoId);
      if (!cartao) continue;
      const [mesStr, anoStr] = l.mesAno.split('-');
      const diaVenc = cartao.vencimento || 10;
      l.data = `${anoStr}-${mesStr}-${String(diaVenc).padStart(2,'0')}`;
      await DB.updateLancamento(l);
    }
    console.log(`[migração] ${faturas.length} faturas com data de vencimento preenchida`);
    localStorage.setItem('migr_data_fatura_v1', '1');
  }
  async function migrarFaturasParaDebito() {
    // Roda uma vez por versão: corrige faturas autoFatura para pagamento=debito
    const jaRodou = localStorage.getItem('migr_fatura_debito_v2');
    if (jaRodou) return;
    const allLancs = await DB.getAllLancamentos();
    // Seleciona faturas automáticas onde pagamento NÃO é a string 'debito'
    const faturas = allLancs.filter(l => l.autoFatura && l.faturaCartaoId && String(l.pagamento) !== 'debito');
    for (const l of faturas) {
      l.pagamento = 'debito';
      l.cartaoId = null;
      await DB.updateLancamento(l);
    }
    console.log(`[migração v2] ${faturas.length} faturas corrigidas para débito`);
    localStorage.setItem('migr_fatura_debito_v2', '1');
  }

  async function migrarFaturasAutoLimpeza() {
    // Remove todas as faturas autoFatura para que sejam recriadas com a lógica correta
    const jaRodou = localStorage.getItem('migr_fatura_auto_limpeza_v1');
    if (jaRodou) return;
    const allLancs = await DB.getAllLancamentos();
    const faturas = allLancs.filter(l => l.autoFatura);
    for (const l of faturas) await DB.deleteLancamento(l.id);
    console.log('[migração] ' + faturas.length + ' faturas automáticas removidas para recriação');
    localStorage.setItem('migr_fatura_auto_limpeza_v1', '1');
  }

  async function migrarParcelasParaRegraOficial() {
    const jaRodou = localStorage.getItem('migr_parcelas_regra_v1');
    if (jaRodou) return;
    const allLancs = await DB.getAllLancamentos();
    const creditos = allLancs.filter(l => l.tipo === 'credito' && l.cartaoId && l.dataCompra);
    let count = 0;
    // Agrupa por grupoId para processar cada compra
    const grupos = {};
    creditos.forEach(l => { if (l.grupoId) { if (!grupos[l.grupoId]) grupos[l.grupoId] = []; grupos[l.grupoId].push(l); } });
    for (const [grupoId, parcelas] of Object.entries(grupos)) {
      parcelas.sort((a, b) => (a.parcela || 0) - (b.parcela || 0));
      const primeira = parcelas[0];
      const cartao = getCartaoById(primeira.cartaoId);
      if (!cartao) continue;
      const dataC = primeira.dataCompra || primeira.data;
      if (!dataC) continue;
      const dCompra = new Date(dataC + 'T12:00:00');
      const { dMesBase } = calcMesAnoFatura(dCompra, cartao.fechamento || 5, cartao.vencimento || 10);
      for (let i = 0; i < parcelas.length; i++) {
        const p = parcelas[i];
        const dParcela = new Date(dMesBase);
        dParcela.setMonth(dParcela.getMonth() + i);
        const novoMesAno = mesAnoStr(dParcela.getMonth(), dParcela.getFullYear());
        if (p.mesAno !== novoMesAno) {
          await DB.updateLancamento({ ...p, mesAno: novoMesAno });
          count++;
        }
      }
    }
    console.log('[migração parcelas v1] ' + count + ' parcelas atualizadas');
    localStorage.setItem('migr_parcelas_regra_v1', '1');
  }

  async function migrarMesAnoParaCompra() {
    // v2: mesAno = mês da compra, mesPagamento = mês da fatura
    const jaRodou = localStorage.getItem('migr_mesano_compra_v2');
    if (jaRodou) return;
    const allLancs = await DB.getAllLancamentos();
    const creditos = allLancs.filter(l => l.tipo === 'credito' && !l.autoFatura && l.cartaoId && (l.dataCompra || l.data));
    let count = 0;
    const grupos = {};
    creditos.forEach(l => { if (l.grupoId) { if (!grupos[l.grupoId]) grupos[l.grupoId] = []; grupos[l.grupoId].push(l); } });
    for (const [grupoId, parcelas] of Object.entries(grupos)) {
      parcelas.sort((a, b) => (a.parcela || 0) - (b.parcela || 0));
      const primeira = parcelas[0];
      const cartao = getCartaoById(primeira.cartaoId);
      if (!cartao) continue;
      const dataC = primeira.dataCompra || primeira.data;
      if (!dataC) continue;
      const dCompra = new Date(dataC + 'T12:00:00');
      const mesAnoCompra = mesAnoStr(dCompra.getMonth(), dCompra.getFullYear());
      const { dMesBase } = calcMesAnoFatura(dCompra, cartao.fechamento || 5, cartao.vencimento || 10);
      for (let i = 0; i < parcelas.length; i++) {
        const p = parcelas[i];
        const dParcela = new Date(dMesBase);
        dParcela.setMonth(dParcela.getMonth() + i);
        const mesPag = mesAnoStr(dParcela.getMonth(), dParcela.getFullYear());
        if (p.mesAno !== mesAnoCompra || p.mesPagamento !== mesPag) {
          await DB.updateLancamento({ ...p, mesAno: mesAnoCompra, mesPagamento: mesPag });
          count++;
        }
      }
    }
    console.log('[migração v2] ' + count + ' parcelas: mesAno=compra, mesPagamento=fatura');
    localStorage.setItem('migr_mesano_compra_v2', '1');
  }

  async function migrarMesPagamentoV4() {
    // v4: Recalcula mesPagamento (mês da fatura) usando a regra OFICIAL REVISADA:
    // Para fatura mesAnoV (vence diaV/mmV/yyV):
    //   FIM    = primeira data diaF-1 ANTERIOR a dataV
    //   INÍCIO = primeira data diaF ANTERIOR ao FIM
    // Compra cai na fatura cujo período INÍCIO..FIM a inclui.
    const jaRodou = localStorage.getItem('migr_mes_pagamento_v4');
    if (jaRodou) return;
    const allLancs = await DB.getAllLancamentos();
    const creditos = allLancs.filter(l => l.tipo === 'credito' && !l.autoFatura && l.cartaoId && (l.dataCompra || l.data));
    let count = 0;
    const grupos = {};
    creditos.forEach(l => { if (l.grupoId) { if (!grupos[l.grupoId]) grupos[l.grupoId] = []; grupos[l.grupoId].push(l); } });
    for (const [grupoId, parcelas] of Object.entries(grupos)) {
      parcelas.sort((a, b) => (a.parcela || 0) - (b.parcela || 0));
      const primeira = parcelas[0];
      const cartao = getCartaoById(primeira.cartaoId);
      if (!cartao) continue;
      const dataC = primeira.dataCompra || primeira.data;
      if (!dataC) continue;
      const dCompra = new Date(dataC + 'T12:00:00');
      const mesAnoCompra = mesAnoStr(dCompra.getMonth(), dCompra.getFullYear());
      const { mmV, yyV } = faturaDeData(dCompra, cartao);
      for (let i = 0; i < parcelas.length; i++) {
        const p = parcelas[i];
        const dParcela = new Date(yyV, (mmV - 1) + i, 1);
        const mesPag = mesAnoStr(dParcela.getMonth(), dParcela.getFullYear());
        if (p.mesAno !== mesAnoCompra || p.mesPagamento !== mesPag) {
          await DB.updateLancamento({ ...p, mesAno: mesAnoCompra, mesPagamento: mesPag });
          count++;
        }
      }
    }
    console.log('[migração v4] ' + count + ' parcelas com mesPagamento recalculado pela regra oficial revisada');
    localStorage.setItem('migr_mes_pagamento_v4', '1');
  }

  async function init(){
    await DB.open();
    await DB.seedDefaults();
    // Aplicar tema salvo antes de qualquer render
    const temaSalvo = await DB.getConfig('tema','dark');
    _aplicarTema(temaSalvo);
    // Migração: corrigir faturas automáticas que estavam com pagamento=cartaoId
    await migrarFaturasParaDebito();
    // Migração: preencher data das faturas automáticas com dia de vencimento do cartão
    await migrarDataFaturas();
    await loadData();
    // Migração: limpar faturas automáticas antigas (lógica mudou)
    await migrarFaturasAutoLimpeza();
    // Migração: recalcular mesAno das parcelas de crédito pela regra oficial
    // (precisa rodar após loadData para ter state.cartoes disponível)
    await migrarParcelasParaRegraOficial();
    await migrarMesAnoParaCompra();
    await migrarMesPagamentoV4();
    // Recalcular faturas automáticas para todos os cartões
    for(const c of state.cartoes) await atualizarFaturaFixa(c.id);
    await loadData(); // recarregar com as faturas atualizadas
    gotoScreen('screen-home',false);

    // ── Scroll hide/show header + filtros+totais estilo Safari ──
    (function() {
      const scrollEl = document.getElementById('lanc-scroll');
      const stickyEl = document.getElementById('lanc-sticky-header');
      const mainEl   = document.getElementById('lanc-main-header');
      let lastY = 0;
      let hidden = false;
      let ticking = false;

      scrollEl.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const y = scrollEl.scrollTop;
          const delta = y - lastY;

          if (delta > 4 && y > 40 && !hidden) {
            stickyEl.style.maxHeight = '0px';
            stickyEl.style.opacity = '0';
            mainEl.style.maxHeight = '0px';
            mainEl.style.opacity = '0';
            hidden = true;
          } else if (delta < -4 && hidden) {
            stickyEl.style.maxHeight = '300px';
            stickyEl.style.opacity = '1';
            mainEl.style.maxHeight = '200px';
            mainEl.style.opacity = '1';
            hidden = false;
          }
          lastY = y;
          ticking = false;
        });
      }, { passive: true });
    })();
  }

  /* ══════════════════════════════════════
     PARCELAMENTOS
  ══════════════════════════════════════ */
  async function renderParcelamentos(externalEl) {
    const todos = await DB.getAllLancamentos();
    const creditos = todos.filter(l => l.tipo === 'credito' && l.totalParcelas > 1 && l.grupoId);

    // Montar set de faturas pagas: chave = "cartaoId|mesAnoPagamento"
    _faturasPagas = new Set();
    todos.filter(l => l.autoFatura && l.faturaCartaoId && l.pago && l.mesAno)
         .forEach(l => _faturasPagas.add(l.faturaCartaoId + '|' + l.mesAno));

    // Agrupar por grupoId
    const grupos = {};
    creditos.forEach(l => {
      if (!grupos[l.grupoId]) grupos[l.grupoId] = [];
      grupos[l.grupoId].push(l);
    });

    const hoje = new Date();
    const mesHojeKey = mesAnoStr(hoje.getMonth(), hoje.getFullYear());

    const compras = Object.values(grupos).map(parcelas => {
      parcelas.sort((a,b) => a.parcela - b.parcela);
      const primeira = parcelas[0];
      const cartao = getCartaoById(primeira.cartaoId);
      const cat = getCatById(primeira.categoriaId);
      const valorParcela = primeira.valorParcela || 0;
      const n = primeira.totalParcelas || parcelas.length;
      const totalCompra = primeira.valorTotal || (valorParcela * n);

      const isEffetivamentePaga = (p) =>
        isParcelaPaga(p.mesPagamento || p.mesAno, cartao);

      const pagas = parcelas.filter(p => isEffetivamentePaga(p)).length;
      const restantes = n - pagas;
      const totalPago = pagas * valorParcela;
      const totalFalta = restantes * valorParcela;

      const proxima = parcelas.find(p => !isEffetivamentePaga(p));

      const ultima = parcelas[parcelas.length - 1];
      const [ulMm, ulYy] = ultima.mesAno.split('-').map(Number);

      return {
        grupoId: primeira.grupoId,
        descricao: primeira.descricao || cat?.nome || 'Compra parcelada',
        cartao, cat,
        totalCompra, valorParcela, n, pagas, restantes, totalPago, totalFalta,
        proxima, ultimaMes: ulMm-1, ultimaAno: ulYy,
        parcelas,
        concluida: restantes === 0,
        cartaoId: primeira.cartaoId,
        categoriaId: primeira.categoriaId,
      };
    });

    // Filtros
    const filtCartao = state.parcFiltroCartao;
    const filtCat = state.parcCatFilter;
    const comprasFiltradas = compras.filter(c => {
      if (filtCartao && c.cartaoId !== filtCartao) return false;
      if (filtCat.length) {
        const primeira2 = Object.values(grupos).find(g=>g[0]?.grupoId===c.grupoId)?.[0]
                        || creditos.find(l=>l.grupoId===c.grupoId);
        const subcat = primeira2?.subcat || null;
        const hasCat  = filtCat.some(f=>f.type==='cat'&&f.id===c.categoriaId);
        const hasSub  = filtCat.some(f=>f.type==='subcat'&&f.catId===c.categoriaId&&f.nome===subcat);
        if (!hasCat && !hasSub) return false;
      }
      return true;
    });

    const abertas = comprasFiltradas.filter(c => !c.concluida);
    const concluidas = comprasFiltradas.filter(c => c.concluida);

    // ── Chips cartão ─────────────────────
    const cartoesComParc = [...new Set(compras.map(c=>c.cartaoId))]
      .map(id => state.cartoes.find(c=>c.id===id)).filter(Boolean);
    const chipsCartaoHtml = [
      `<div class="parc-chip-filtro ${!filtCartao?'ativo':''}" onclick="App._parcFiltroCartao(null)">Todos</div>`,
      ...cartoesComParc.map(c => {
        const icon = getBancoIconHtml(c.nome, 16);
        const ativo = filtCartao === c.id;
        return `<div class="parc-chip-filtro ${ativo?'ativo':''}" onclick="App._parcFiltroCartao(${c.id})" style="${ativo?`border-color:${c.cor};color:${c.cor};background:${c.cor}18`:''}">
          ${icon||`<span style="width:8px;height:8px;border-radius:50%;background:${c.cor};display:inline-block;flex-shrink:0"></span>`}
          ${c.nome}
        </div>`;
      })
    ].join('');

    // ── Chips categoria ──────────────────
    const filtCatAtivo = state.parcCatFilter.length > 0;
    const filtCatLabels = state.parcCatFilter.map(f=>f.label).join(', ');
    const chipsCatHtml = `<div style="display:flex;align-items:center;gap:8px">
      <div class="parc-chip-filtro ${filtCatAtivo?'ativo':''}" onclick="App._abrirFiltroCatParc()" style="${filtCatAtivo?'border-color:var(--accent);color:var(--accent);background:var(--accent)12':''}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
        ${filtCatAtivo ? filtCatLabels : 'Categoria'}
      </div>
      ${filtCatAtivo?`<div class="parc-chip-filtro" onclick="App._limparFiltCatParc()" style="padding:4px 8px;font-size:11px;color:var(--text3)">✕ limpar</div>`:''}
    </div>`;

    // ── Cards resumo ─────────────────────
    const totalComprometido = abertas.reduce((s,c)=>s+c.totalCompra,0);
    const totalPagoGeral = abertas.reduce((s,c)=>s+c.totalPago,0);
    const totalFaltaGeral = abertas.reduce((s,c)=>s+c.totalFalta,0);
    const resumoHtml = [
      {label:'Comprometido', val:totalComprometido, cor:'var(--text)'},
      {label:'Já pago',      val:totalPagoGeral,    cor:'var(--green)'},
      {label:'Ainda falta',  val:totalFaltaGeral,   cor:'var(--red)'},
    ].map(({label,val,cor})=>`
      <div class="parc-resumo-card">
        <div class="parc-resumo-label">${label}</div>
        <div class="parc-resumo-val" style="color:${cor}">${fmtMoney(val)}</div>
      </div>`).join('');

    // ── Impacto mensal ───────────────────
    const toggleLabel = state.parcImpactoVisible ? 'ocultar' : 'mostrar';
    let impactoHtml = '';
    if (state.parcImpactoVisible) {
      const impactoMap = {};
      abertas.forEach(c => c.parcelas.forEach(p => {
        const key = p.mesPagamento || p.mesAno;
        if (mesAnoNum(key) < mesAnoNum(mesHojeKey)) return;
        if (!isParcelaPaga(key, c.cartao)) impactoMap[key] = (impactoMap[key]||0) + (p.valorParcela||0);
      }));
      const meses = Object.keys(impactoMap).sort((a,b) => mesAnoNum(a) - mesAnoNum(b)).slice(0,12);
      const maxVal = Math.max(...meses.map(k=>impactoMap[k]), 1);
      impactoHtml = meses.length ? meses.map(k => {
        const [mmStr, yyStr] = k.split('-');
        const label = MONTHS_SHORT[parseInt(mmStr)-1]+'/'+yyStr.slice(2);
        const pct = Math.round((impactoMap[k]/maxVal)*100);
        return `<div class="parc-impacto-item">
          <div class="parc-impacto-mes">${label}</div>
          <div class="parc-impacto-bar-wrap"><div class="parc-impacto-bar" style="width:${pct}%"></div></div>
          <div class="parc-impacto-val">${fmtMoney(impactoMap[k])}</div>
        </div>`;
      }).join('') : `<div style="text-align:center;color:var(--text3);font-size:13px;padding:8px 0">Sem parcelas futuras</div>`;
    }

    // ── Items da lista ───────────────────
    function renderItem(c, isConcluida) {
      const cor = c.cartao?.cor || 'var(--accent)';
      const iconCartao = c.cartao ? (getBancoIconHtml(c.cartao.nome, 16)||'') : '';
      const iconCat = c.cat?.emoji || '📦';
      const pct = Math.round((c.pagas/c.n)*100);
      const mesFim = MONTHS_SHORT[c.ultimaMes]+'/'+String(c.ultimaAno).slice(2);
      const aberto = state.parcAbertos.has(c.grupoId);

      if (isConcluida) {
        return `<div class="parc-item" style="opacity:0.45;cursor:default">
          <div class="parc-item-header">
            <div class="parc-item-icon" style="background:${cor}18"><span style="font-size:18px">${iconCat}</span></div>
            <div style="flex:1;min-width:0">
              <div class="parc-item-title">${c.descricao}</div>
              <div class="parc-item-cartao">${iconCartao}<span>${c.cartao?.nome||'Cartão'} · quitado em ${mesFim}</span></div>
            </div>
            <span class="parc-badge" style="background:var(--green-dim);color:var(--green);align-self:flex-start">quitado</span>
          </div>
          <div class="parc-prog-wrap" style="margin-top:4px">
            <div class="parc-prog-bar"><div class="parc-prog-fill" style="width:100%;background:var(--green)"></div></div>
            <span class="parc-prog-label" style="color:var(--green)">100%</span>
          </div>
        </div>`;
      }

      const detalheRows = c.parcelas.map(p => {
        const key = p.mesPagamento || p.mesAno;
        const pago = isParcelaPaga(key, c.cartao);
        const proxKey = c.proxima ? (c.proxima.mesPagamento || c.proxima.mesAno) : null;
        const isProx = !pago && key === proxKey;
        const [mmStr2, yyStr2] = key.split('-').map(Number);
        const mesLabel = MONTHS_SHORT[mmStr2-1]+'/'+String(yyStr2).slice(2);
        return `<div class="parc-detalhe-row">
          <span style="font-size:12px;color:${pago?'var(--text3)':isProx?cor:'var(--text2)'}">
            ${pago?'✓':isProx?'→':'·'} ${p.parcela}/${c.n} · ${mesLabel}${isProx?' <span style="font-size:9px;padding:1px 5px;border-radius:4px;background:'+cor+'22;color:'+cor+'">próxima</span>':''}
          </span>
          <span style="font-size:12px;font-family:'DM Mono',monospace;color:${pago?'var(--text3)':isProx?cor:'var(--text2)'}${pago?';text-decoration:line-through':''}">
            ${fmtMoney(p.valorParcela||0)}
          </span>
        </div>`;
      }).join('');

      return `<div class="parc-item" onclick="App._parcToggleItem(${c.grupoId},event)">
        <div class="parc-item-header">
          <div class="parc-item-icon" style="background:${cor}18"><span style="font-size:18px">${iconCat}</span></div>
          <div style="flex:1;min-width:0">
            <div class="parc-item-title">${c.descricao}</div>
            <div class="parc-item-cartao">${iconCartao}<span>${c.cartao?.nome||'Cartão'} · termina ${mesFim}</span></div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:13px;font-weight:600;font-family:'DM Mono',monospace;color:${cor}">${fmtMoney(c.valorParcela)}<span style="font-size:10px;color:var(--text3);font-weight:400">/mês</span></div>
            <div style="font-size:10px;color:var(--text3)">${c.pagas}/${c.n} pagas</div>
          </div>
        </div>
        <div class="parc-item-vals">
          <span class="parc-item-parcela">Falta <strong style="color:var(--red)">${fmtMoney(c.totalFalta)}</strong></span>
          <span class="parc-item-total">Total ${fmtMoney(c.totalCompra)}</span>
        </div>
        <div class="parc-prog-wrap">
          <div class="parc-prog-bar"><div class="parc-prog-fill" style="width:${pct}%;background:${cor}"></div></div>
          <span class="parc-prog-label">${pct}%</span>
        </div>
        <div class="parc-item-detail ${aberto?'open':''}" id="parc-det-${c.grupoId}">
          <div style="margin-top:12px;padding-top:8px;border-top:0.5px solid var(--border)">
            ${detalheRows}
            <div style="display:flex;justify-content:space-between;padding-top:8px;margin-top:4px;border-top:0.5px solid var(--border)">
              <span style="font-size:11px;color:var(--text3)">Total pago</span>
              <span style="font-size:11px;font-family:'DM Mono',monospace;color:var(--green)">${fmtMoney(c.totalPago)}</span>
            </div>
          </div>
        </div>
        ${aberto?`<div style="text-align:center;margin-top:6px"><span style="font-size:10px;color:var(--text3)">▲ fechar</span></div>`:`<div style="text-align:center;margin-top:6px"><span style="font-size:10px;color:var(--text3)">▼ ver parcelas</span></div>`}
      </div>`;
    }

    let listaHtml = abertas.map(c=>renderItem(c,false)).join('');
    if (concluidas.length) {
      listaHtml += `<div style="margin:16px 0 10px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text3)">Concluídas (${concluidas.length})</div>`;
      listaHtml += concluidas.map(c=>renderItem(c,true)).join('');
    }
    if (!listaHtml) listaHtml = `<div style="text-align:center;padding:40px 0;color:var(--text3)">
      <div style="font-size:40px;margin-bottom:12px">🎉</div>
      <div style="font-size:14px">Nenhum parcelamento encontrado</div>
    </div>`;

    // ── Montar HTML completo e injetar ───
    const fullHtml = `
      <div style="padding:0 16px 8px;display:flex;gap:8px;overflow-x:auto;scrollbar-width:none">${chipsCartaoHtml}</div>
      <div style="padding:0 16px 12px;display:flex;gap:8px;overflow-x:auto;scrollbar-width:none">${chipsCatHtml}</div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 16px 16px">${resumoHtml}</div>
      <div style="padding:0 16px 16px">
        <div class="section-label" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
          <span>Impacto mensal futuro</span>
          <span id="parc-toggle-impacto" style="font-size:11px;color:var(--accent2);cursor:pointer" onclick="App._parcToggleImpacto()">${toggleLabel}</span>
        </div>
        <div id="parc-impacto">${impactoHtml}</div>
      </div>
      <div class="divider-line" style="margin:0 0 12px"></div>
      <div style="padding:0 16px">
        <div class="section-label" style="margin-bottom:10px" id="parc-lista-label">Compras em aberto (${abertas.length})</div>
        <div id="parc-lista">${listaHtml}</div>
      </div>
      <div style="height:20px"></div>`;

    if (externalEl) {
      externalEl.innerHTML = fullHtml;
    } else {
      document.getElementById('parc-scroll').innerHTML = fullHtml;
    }
  }

  function _reRenderParc() {
    if (state.relTab === 'parcelamentos' && state.currentScreen === 'screen-relatorios') {
      renderParcelamentos(document.getElementById('rel-content'));
    } else {
      renderParcelamentos();
    }
  }
  function _parcFiltroCartao(id) { state.parcFiltroCartao = id; _reRenderParc(); }

  function _abrirFiltroCatParc() {
    // Coletar todas as compras parceladas para saber quais cats/subcats existem
    DB.getAllLancamentos().then(todos => {
      const creditos = todos.filter(l => l.tipo === 'credito' && l.totalParcelas > 1 && l.grupoId);
      // Map grupoId -> primeira ocorrência (para pegar subcat)
      const primeiras = {};
      creditos.forEach(l => { if (!primeiras[l.grupoId]) primeiras[l.grupoId] = l; });
      const items = Object.values(primeiras);
      // Cats com parcelas
      const catIds = new Set(items.map(l=>l.categoriaId));
      // Subcats com parcelas: {catId: Set<subcatNome>}
      const subcatsByCat = {};
      items.forEach(l => {
        if (l.subcat) {
          if (!subcatsByCat[l.categoriaId]) subcatsByCat[l.categoriaId] = new Set();
          subcatsByCat[l.categoriaId].add(l.subcat);
        }
      });

      const content = document.getElementById('modal-content');
      const renderModal = () => {
        let html = `<div class="modal-title">Filtrar por categoria</div>`;
        for (const cat of state.categorias) {
          if (!catIds.has(cat.id)) continue;
          const catSel = state.parcCatFilter.some(f=>f.type==='cat'&&f.id===cat.id);
          html += `<div style="margin-bottom:4px">
            <div style="padding:10px 0;display:flex;align-items:center;gap:10px;cursor:pointer" onclick="App._toggleFiltCatParc('cat',${cat.id},null,'${cat.nome}')">
              <div style="width:18px;height:18px;border-radius:4px;border:1.5px solid ${catSel?'var(--accent)':'var(--border2)'};background:${catSel?'var(--accent)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                ${catSel?'<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>':''}
              </div>
              <span style="font-size:16px">${cat.emoji}</span>
              <span style="flex:1;font-size:14px;font-weight:500">${cat.nome}</span>
            </div>`;
          // Subcats que têm parcelas nessa cat
          const subcatsComParc = subcatsByCat[cat.id] || new Set();
          (cat.subcats||[]).filter(s=>typeof s==='object' && subcatsComParc.has(s.nome)).forEach(s => {
            const subSel = state.parcCatFilter.some(f=>f.type==='subcat'&&f.catId===cat.id&&f.nome===s.nome);
            html += `<div style="padding:6px 0 6px 28px;display:flex;align-items:center;gap:10px;cursor:pointer" onclick="App._toggleFiltCatParc('subcat',${cat.id},'${s.nome}','${s.nome}')">
              <div style="width:16px;height:16px;border-radius:4px;border:1.5px solid ${subSel?'var(--accent)':'var(--border2)'};background:${subSel?'var(--accent)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                ${subSel?'<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>':''}
              </div>
              <span style="font-size:14px">${s.emoji||'•'}</span>
              <span style="font-size:13px;color:var(--text2)">${s.nome}</span>
            </div>`;
          });
          html += `</div>`;
        }
        content.innerHTML = html;
      };
      // Expor renderModal para o toggle re-abrir
      App._renderModalCatParc = renderModal;
      renderModal();
      document.getElementById('modal-overlay').classList.add('open');
    });
  }

  function _toggleFiltCatParc(type, catId, subcatNome, label) {
    if (type === 'cat') {
      const idx = state.parcCatFilter.findIndex(f=>f.type==='cat'&&f.id===catId);
      if (idx >= 0) state.parcCatFilter.splice(idx, 1);
      else state.parcCatFilter.push({type:'cat', id:catId, label});
    } else {
      const idx = state.parcCatFilter.findIndex(f=>f.type==='subcat'&&f.catId===catId&&f.nome===subcatNome);
      if (idx >= 0) state.parcCatFilter.splice(idx, 1);
      else state.parcCatFilter.push({type:'subcat', catId, nome:subcatNome, label});
    }
    if (App._renderModalCatParc) App._renderModalCatParc();
    _reRenderParc();
  }

  function _limparFiltCatParc() { state.parcCatFilter = []; _reRenderParc(); }
  function _parcToggleItem(grupoId) {
    if (state.parcAbertos.has(grupoId)) state.parcAbertos.delete(grupoId);
    else state.parcAbertos.add(grupoId);
    _reRenderParc();
  }
  function _parcToggleImpacto() { state.parcImpactoVisible = !state.parcImpactoVisible; _reRenderParc(); }

  return {
    gotoScreen,goBack,novoLancamento,changeMonth,
    renderHome,renderLancamentos,renderRelatorios,renderPerfil,
    renderParcelamentos,_parcFiltroCartao,_abrirFiltroCatParc,_toggleFiltCatParc,_limparFiltCatParc,_parcToggleItem,_parcToggleImpacto,
    setLancTab,setLancSubTab,editLancamento,toggleFixoPago,
    abrirCartao,abrirFiltroCategoria,_toggleFiltroItem,limparFiltroCategoria,
    setTipoLanc,_maskMoney,_selCat,_selSubcat,_selPay,_selCartao,_updateParcelas,
    _salvar,_deletar,_deletarTodasParcelas,_deletarUmaParcela,_deletarFixoTemplate,_deletarUmFixo,
    _editarSoEste,_editarTodosSeguintes,_onFixoDiaChange,
    setRelTab,_setRelPeriodo,
    setCfgTab,_toggleCatRow,
    _openAddCat,_openEditCat,_deleteCategoria,_openAddSubcat,_openEditSubcat,_deleteSubcat,
    _openAddCartao,_editCartao,_deleteCartao,_updateCartao,
    _openCartaoBS,_closeCartaoBS,_setCartaoBSPeriodo,_setCartaoBSFatura,
    _exportar,_importar,_limpar,_setTema,
    openModal,closeModal,_selColor,_onCustomColor,
    _saveCategoria,_saveSubcat,_saveCartao,
    init,
  };
})();
App.init();
