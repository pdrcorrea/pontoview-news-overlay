(() => {
  'use strict';

  const STOP_WORDS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
  const stageCity = new Map();
  const cardCity = new WeakMap();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function cleanName(value = '') {
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function significantWords(name) {
    return cleanName(name)
      .split(' ')
      .filter(Boolean)
      .filter((word) => !STOP_WORDS.has(word.toLocaleUpperCase('pt-BR')));
  }

  function abbreviateCity(name) {
    const original = cleanName(name).toLocaleUpperCase('pt-BR');
    if (original.length <= 15) return original;

    const words = significantWords(original);
    if (words.length <= 1) return original;
    if (words.length === 2 && original.length <= 19) return original;

    const last = words.at(-1);
    const initials = words.slice(0, -1)
      .map((word) => `${Array.from(word)[0]}.`)
      .join(' ');

    return `${initials} ${last}`.trim();
  }

  function isStandaloneCompact(cityEl) {
    const card = cityEl.closest('.weather-card');
    return !!(card?.classList.contains('template-compact') && !card.closest('.weather-panel'));
  }

  function setupMarquee(cityEl, original) {
    cityEl.textContent = '';
    const track = document.createElement('span');
    track.className = 'weather-city-marquee';
    track.textContent = original.toLocaleUpperCase('pt-BR');
    cityEl.appendChild(track);

    requestAnimationFrame(() => {
      const distance = Math.max(0, Math.ceil(track.scrollWidth - cityEl.clientWidth));
      cityEl.classList.toggle('is-marquee', distance > 3);
      cityEl.style.setProperty('--city-shift', `${distance}px`);
      cityEl.style.setProperty('--marquee-duration', `${Math.max(7, Math.min(14, 6.5 + distance / 24))}s`);
    });
  }

  function processCity(cityEl) {
    if (!(cityEl instanceof HTMLElement)) return;
    const original = cleanName(cityEl.dataset.cityOriginal || cityEl.textContent);
    if (!original) return;

    const mode = isStandaloneCompact(cityEl) ? 'marquee' : 'short';
    if (cityEl.dataset.weatherNameMode === mode && cityEl.dataset.cityOriginal === original) return;

    cityEl.dataset.cityOriginal = original;
    cityEl.dataset.weatherNameMode = mode;
    cityEl.setAttribute('aria-label', original);
    cityEl.title = original;

    if (mode === 'marquee') setupMarquee(cityEl, original);
    else cityEl.textContent = abbreviateCity(original);
  }

  function markDetailSegments(card) {
    card.querySelectorAll('.weather-minmax span').forEach((span) => {
      const text = cleanName(span.textContent);
      span.classList.toggle('wx-min', text.startsWith('↓'));
      span.classList.toggle('wx-max', text.startsWith('↑'));
      span.classList.toggle('wx-meta', !text.startsWith('↓') && !text.startsWith('↑'));
    });
  }

  function ensureFlash(card) {
    let flash = card.querySelector(':scope > .weather-flash');
    if (!flash) {
      flash = document.createElement('div');
      flash.className = 'weather-flash';
      flash.setAttribute('aria-hidden', 'true');
      card.appendChild(flash);
    }
    return flash;
  }

  function flashCard(card) {
    if (!(card instanceof HTMLElement) || reduceMotion?.matches) return;
    const flash = ensureFlash(card);

    if (window.gsap) {
      window.gsap.killTweensOf(flash);
      window.gsap.set(flash, {
        opacity: 0,
        scaleX: 0,
        transformOrigin: 'left center',
        xPercent: -10
      });
      window.gsap.timeline()
        .to(flash, { opacity: .92, scaleX: 1.08, xPercent: 0, duration: .105, ease: 'power2.out' })
        .to(flash, { opacity: 0, scaleX: 1.18, duration: .15, ease: 'power2.in' });
      return;
    }

    flash.animate([
      { opacity: 0, transform: 'translateX(-10%) scaleX(0)' },
      { opacity: .92, transform: 'translateX(0) scaleX(1.08)', offset: .42 },
      { opacity: 0, transform: 'translateX(0) scaleX(1.18)' }
    ], { duration: 260, easing: 'cubic-bezier(.2,.76,.2,1)' });
  }

  function wipeStageContent(card) {
    if (!(card instanceof HTMLElement) || reduceMotion?.matches) return;
    const content = card.querySelector('.weather-city-content');
    if (!content) return;

    if (window.gsap) {
      window.gsap.killTweensOf(content);
      window.gsap.fromTo(content,
        { clipPath: 'inset(0 100% 0 0)', opacity: .15, x: -7 },
        { clipPath: 'inset(0 0% 0 0)', opacity: 1, x: 0, duration: .34, ease: 'power3.out' }
      );
      return;
    }

    content.animate([
      { clipPath: 'inset(0 100% 0 0)', opacity: .15, transform: 'translateX(-7px)' },
      { clipPath: 'inset(0 0% 0 0)', opacity: 1, transform: 'translateX(0)' }
    ], { duration: 340, easing: 'cubic-bezier(.2,.76,.2,1)' });
  }

  function processCard(card) {
    if (!(card instanceof HTMLElement)) return;
    const cities = [...card.querySelectorAll('.weather-city')];
    cities.forEach(processCity);
    markDetailSegments(card);

    const primary = cities[0]?.dataset.cityOriginal || '';
    const previous = cardCity.get(card);
    if (previous && primary && previous !== primary) flashCard(card);
    if (primary) cardCity.set(card, primary);

    ensureFlash(card);
  }

  function processStage(stage) {
    if (!(stage instanceof HTMLElement)) return;
    const cards = [...stage.querySelectorAll('.weather-card')];
    cards.forEach(processCard);

    const city = stage.querySelector('.weather-city')?.dataset.cityOriginal || '';
    if (!city) return;

    const previous = stageCity.get(stage.id);
    if (previous && previous !== city) {
      const card = stage.querySelector('.weather-card');
      if (card) {
        flashCard(card);
        wipeStageContent(card);
      }
    }
    stageCity.set(stage.id, city);
  }

  function processWeatherRoot(root) {
    if (!(root instanceof HTMLElement)) return;
    root.querySelectorAll('.weather-card').forEach(processCard);
  }

  function relabelStudio() {
    const labels = {
      informative: 'Card',
      complete: 'Detalhado'
    };

    Object.entries(labels).forEach(([key, label]) => {
      const button = document.querySelector(`.layout-btn[data-preset="${key}"]`);
      if (button) button.textContent = label;

      const option = document.querySelector(`#template-select option[value="${key}"]`);
      if (option) {
        option.textContent = key === 'informative'
          ? 'Card · ícone + temperatura + cidade + condição'
          : 'Detalhado · cidade + condição + atual + mínima/máxima';
      }
    });

    const compactOption = document.querySelector('#template-select option[value="compact"]');
    if (compactOption) compactOption.textContent = 'Compacto · faixa horizontal com nome completo';

    const sizeNote = document.querySelector('.fixed-size-note');
    if (sizeNote) {
      const strong = sizeNote.querySelector('strong');
      const small = sizeNote.querySelector('small');
      if (strong) strong.textContent = 'Proporção automática por layout';
      if (small) small.textContent = 'Compacto, Card e Detalhado usam tamanhos próprios e consistentes.';
    }

    const quickTitle = document.querySelector('.quick-bank h3');
    if (quickTitle) quickTitle.textContent = 'Layouts Weather';
  }

  function processAll() {
    document.querySelectorAll('.weather-stage').forEach(processStage);
    const root = document.getElementById('weather-root');
    if (root) processWeatherRoot(root);
  }

  function init() {
    relabelStudio();
    processAll();

    const observer = new MutationObserver(() => {
      queueMicrotask(processAll);
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true
    });

    window.addEventListener('resize', () => {
      document.querySelectorAll('.weather-city[data-weather-name-mode="marquee"]').forEach((cityEl) => {
        cityEl.dataset.weatherNameMode = '';
        processCity(cityEl);
      });
    }, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
