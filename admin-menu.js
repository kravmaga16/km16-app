(() => {
  'use strict';
  if(new URLSearchParams(location.search).get('embed')==='1'&&window.parent!==window)return;
  const panel = document.querySelector('#admin, #workspace');
  if (!panel) return;
  const courseAdmin = 'https://script.google.com/macros/s/AKfycbyY2dS_sWLYF7KFSFLxRY4-KPLYSRQuxNm38zXS60XZ16Ek3S-QTtfSpkkxc10TXoDk_Q/exec';
  const sections = [
    ['', [['Accueil du club', './', 'M3 10l9-7 9 7v10H3z M9 20v-7h6v7']]],
    ['Gestion du club', [
      ['Actualités du club', './news-admin.html#workspace', 'M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h5'],
      ['Finances et encaissements', './clients.html#money-summary', 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z'],
      ['Inscriptions aux cours', courseAdmin, 'M9 4H5v17h14V4h-4 M9 3h6v4H9z M8 12l2 2 5-5 M8 18h8'],
      ['Horaires des cours', './#planning', 'M3 5h18v16H3z M7 2v6 M17 2v6 M3 10h18'],
      ['Ventes de stages', './clients.html#stages-panel', 'M8 3h8v6a4 4 0 01-8 0z M8 5H4v3a4 4 0 004 4 M16 5h4v3a4 4 0 01-4 4 M12 13v7 M8 21h8'],
    ]],
    ['Adhérents et paiements', [
      ['Équipe du club', './#equipe', 'M16 21v-3a4 4 0 00-4-4H7a4 4 0 00-4 4v3 M21 21v-3a4 4 0 00-3-4 M9.5 11a4 4 0 100-8 4 4 0 000 8z M17 3a4 4 0 010 8'],
      ['Fichier des adhérents', './clients.html#workspace', 'M3 3h18v18H3z M7 17v-2a5 5 0 0110 0v2 M12 11a3 3 0 100-6 3 3 0 000 6z'],
      ['Essais et relances', './trials.html#workspace', 'M4 5h16v16H4z M8 2v6 M16 2v6 M4 11h16 M8 15l3 3 5-5'],
      ['Adhésions et paiements', './adhesion.html#admin', 'M2 5h20v14H2z M2 10h20'],
      ['Créer un lien de paiement', './adhesion.html#link-form', 'M10 13a4 4 0 006 0l4-4a4 4 0 00-6-6l-2 2 M14 11a4 4 0 00-6 0l-4 4a4 4 0 006 6l2-2'],
    ]],
  ];
  const node = (tag, label) => {
    const el = document.createElement(tag);
    if (label) el.textContent = label;
    return el;
  };
  const icon = d => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(s.namespaceURI, 'path');
    p.setAttribute('d', d); s.append(p); return s;
  };
  const shell = node('aside');
  shell.className = 'km16-admin-menu';
  shell.hidden = true;
  const toggle = node('button', '☰ Menu KM16');
  toggle.type = 'button';
  toggle.className = 'km16-menu-toggle';
  const nav = node('nav');
  nav.id = 'km16-admin-navigation';
  nav.setAttribute('aria-label', 'Administration KM16');
  toggle.setAttribute('aria-controls', nav.id);
  const brand = node('div');
  brand.className = 'km16-menu-brand';
  const logo = node('img');
  logo.src = './logo-km16.png';
  logo.alt = '';
  const brandText=node('div');brandText.className='km16-menu-brand-text';brandText.append(node('strong','KM16'),node('small','Administration'));brand.append(logo,brandText);
  const collapse = node('button', '«');
  collapse.type = 'button'; collapse.className = 'km16-menu-collapse';
  collapse.setAttribute('aria-controls', nav.id);
  brand.append(collapse);
  const links = [];
  for (const [title, items] of sections) {
    const group = node('div'); group.className = 'km16-menu-group';
    if (title) group.append(node('p', title));
    for (const [label, href, glyph] of items) {
      const a = node('a'); a.href = href; a.title = label;
      a.append(icon(glyph), node('span', label));
      if (href === courseAdmin) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      group.append(a); links.push(a);
    }
    nav.append(group);
  }
  shell.append(toggle, brand, nav);
  document.body.prepend(shell);
  const mobile = matchMedia('(max-width: 800px)');
  let compact = false, opened = false;
  try { compact = localStorage.getItem('km16-admin-menu-size-v2') === '1'; } catch {}
  function paint() {
    shell.classList.toggle('is-compact', compact && !mobile.matches);
    shell.classList.toggle('is-open', opened && mobile.matches);
    document.body.classList.toggle('km16-menu-compact', compact && !mobile.matches && !shell.hidden);
    nav.hidden = mobile.matches && !opened;
    toggle.setAttribute('aria-expanded', String(opened && mobile.matches));
    collapse.textContent = mobile.matches ? 'Fermer' : compact ? 'Agrandir' : 'Réduire';
    collapse.setAttribute('aria-label', mobile.matches ? 'Fermer le menu' : compact ? 'Agrandir le menu' : 'Réduire la largeur du menu');
    collapse.setAttribute('aria-expanded', String(mobile.matches ? opened : !compact));
  }
  function mark() {
    const hash = location.hash || (panel.id === 'admin' ? '#admin' : '#workspace');
    for (const a of links) {
      const url = new URL(a.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.hash === hash) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
  }
  function revealTarget() {
    const id = location.hash.slice(1);
    if (['admin','link-form','workspace','money-summary','stages-panel'].includes(id)) document.getElementById(id)?.scrollIntoView({block:'start'});
  }
  function sync() {
    const wasHidden = shell.hidden;
    shell.hidden = panel.hidden;
    document.body.classList.toggle('km16-menu-visible', !shell.hidden);
    if (shell.hidden) opened = false;
    paint();
    if (wasHidden && !shell.hidden) requestAnimationFrame(revealTarget);
  }
  toggle.onclick = () => { opened = !opened; paint(); };
  collapse.onclick = () => {
    if (mobile.matches) { opened = false; paint(); toggle.focus(); return; }
    compact = !compact;
    try { localStorage.setItem('km16-admin-menu-size-v2', compact ? '1' : '0'); } catch {}
    paint();
  };
  nav.addEventListener('click', event => {
    if (event.target.closest('a') && mobile.matches) { opened = false; paint(); toggle.focus({preventScroll:true}); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobile.matches && opened) { opened = false; paint(); toggle.focus(); }
  });
  mobile.addEventListener('change', () => { opened = false; paint(); });
  addEventListener('hashchange', mark);
  new MutationObserver(sync).observe(panel, {attributes:true, attributeFilter:['hidden']});
  mark(); sync();
})();
