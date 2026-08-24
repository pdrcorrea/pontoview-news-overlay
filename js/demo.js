(() => {
  const $ = (selector) => document.querySelector(selector);

  const state = {
    preview: {
      tag: 'ECONOMIA',
      name: 'ANA MARTINS',
      role: 'REPÓRTER',
      headline: 'MERCADO FECHA O DIA EM ALTA',
      detail: 'Principais índices avançaram nesta sessão',
      ticker: 'Mercado acompanha novos dados divulgados nesta tarde.'
    },
    program: {
      tag: 'NOTÍCIAS',
      name: 'PONTO VIEW',
      role: 'STUDIO',
      headline: 'PROGRAMA PERMANECE INDEPENDENTE',
      detail: 'O conteúdo no ar só muda quando o operador executa o TAKE',
      ticker: 'Preview e Program trabalham como estados separados.'
    }
  };

  function readDraft() {
    return {
      tag: $('#demoTag')?.value.trim() || 'NOTÍCIAS',
      name: $('#demoName')?.value.trim() || 'NOME DA PESSOA',
      role: $('#demoRole')?.value.trim() || 'CARGO OU FUNÇÃO',
      headline: $('#demoHeadline')?.value.trim() || 'MANCHETE PRINCIPAL DA NOTÍCIA',
      detail: $('#demoDetail')?.value.trim() || 'Linha de apoio com contexto ou informação complementar',
      ticker: $('#demoTicker')?.value.trim() || 'Informações e notícias da PontoView em tempo real.'
    };
  }

  function render(prefix, value, animate = false) {
    const frame = $(`#${prefix}Frame`);
    const fields = ['Tag', 'Name', 'Role', 'Headline', 'Detail', 'Ticker'];
    for (const key of fields) {
      const el = $(`#${prefix}${key}`);
      if (el) el.textContent = value[key.toLowerCase()];
    }
    if (!frame || !animate) return;
    frame.classList.remove('pvnews-demo-update');
    void frame.offsetWidth;
    frame.classList.add('pvnews-demo-update');
    window.setTimeout(() => frame.classList.remove('pvnews-demo-update'), 720);
  }

  $('#demoPreview')?.addEventListener('click', () => {
    state.preview = readDraft();
    render('preview', state.preview, true);
  });

  $('#demoTake')?.addEventListener('click', () => {
    state.program = { ...state.preview };
    render('program', state.program, true);
  });

  render('preview', state.preview);
  render('program', state.program);
})();
