import { animate, inView, stagger, scroll } from 'motion';

const tabs = [...document.querySelectorAll('[role="tab"]')];
const panel = document.querySelector('#workspace-panel');
const content = document.querySelector('#workspace-content');
const description = document.querySelector('#preview-description');
const chairMarkup = content.innerHTML;
const previews = {
  chair: { html: chairMarkup, caption: 'Take attendance, guide debate and track participation in one chair workspace.' },
  resolutions: {
    html: `<div class="mock-sidebar" aria-hidden="true"><span class="mini-mark">M<span>O</span></span><span>◫</span><span>☷</span><span class="sidebar-selected">▤</span><span>⚙</span></div><div class="mock-main"><div class="mock-heading"><div><p class="mock-kicker">APPROVAL PANEL · DEMO</p><h3>From draft to decision.</h3></div><span class="mock-avatar">AP</span></div><div class="mock-tabs"><span class="selected">Resolutions</span><span>Review</span><span>History</span></div><div class="mock-summary"><span>Resolution workflow</span><span class="mock-chip">Illustrative data</span></div><div class="delegate-row"><span><b class="country-code">01</b>GA1/01 — France</span><span class="attendance">Submitted</span></div><div class="delegate-row"><span><b class="country-code">02</b>GA1/02 — Qatar</span><span class="attendance">In review</span></div><div class="delegate-row"><span><b class="country-code">03</b>GA1/03 — Singapore</span><span class="attendance">Changes requested</span></div><div class="delegate-row"><span><b class="country-code">04</b>GA1/04 — Kenya</span><span class="attendance">Approved</span></div><p class="mock-footer"><span>◉</span> Feedback and next steps, in one place.</p></div>`,
    caption: 'Bring Google Docs submissions, approval feedback and resolution progress into one workflow.',
  },
  printing: {
    html: `<div class="mock-sidebar" aria-hidden="true"><span class="mini-mark">M<span>O</span></span><span>◫</span><span class="sidebar-selected">☷</span><span>▤</span><span>⚙</span></div><div class="mock-main"><div class="mock-heading"><div><p class="mock-kicker">PRINTING TEAM · DEMO</p><h3>Ready for the next step.</h3></div><span class="mock-avatar">PT</span></div><div class="mock-tabs"><span class="selected">Print queue</span><span>Completed</span><span>Overview</span></div><div class="mock-summary"><span>Approved resolutions</span><span class="mock-chip">Illustrative data</span></div><div class="delegate-row"><span><b class="country-code">01</b>GA1/01 — France</span><span class="attendance">Queued</span></div><div class="delegate-row"><span><b class="country-code">02</b>GA1/02 — Qatar</span><span class="attendance">Printing</span></div><div class="delegate-row"><span><b class="country-code">03</b>GA1/03 — Singapore</span><span class="attendance">Printed</span></div><div class="delegate-row"><span><b class="country-code">04</b>GA1/04 — Kenya</span><span class="attendance">Printed</span></div><p class="mock-footer"><span>◉</span> Clear handoffs from approval to paper.</p></div>`,
    caption: 'Give printing teams their own queue and executives a view across the conference.',
  },
};
const cinematicLayout = window.matchMedia('(min-width: 1001px) and (min-height: 760px)');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let tabAnimation;
function selectTab(tab, focus = false) {
  if (tab.getAttribute('aria-selected') === 'true') return;
  tabAnimation?.stop();
  tabs.forEach(item => {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  panel.setAttribute('aria-labelledby', tab.id);
  const preview = previews[tab.dataset.workspace];
  content.innerHTML = preview.html;
  description.textContent = preview.caption;
  if (!motionPreference.matches) {
    tabAnimation = animate(content, { opacity: [0.4, 1], y: [6, 0] }, { duration: 0.28, ease: 'easeOut' });
  }
  if (focus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    // Support both axes: the tab layout changes to horizontal on small screens.
    const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
    let next;
    if (delta) next = (index + delta + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); selectTab(tabs[next], true); }
  });
});
const mobileLayout = window.matchMedia('(max-width: 760px)');
function updateOrientation() {
  document.querySelector('[role="tablist"]').setAttribute('aria-orientation', mobileLayout.matches ? 'horizontal' : 'vertical');
}
mobileLayout.addEventListener('change', updateOrientation);
updateOrientation();

// Content is visible without JavaScript. Only animate elements while entering the viewport.
let stops = [];
let animations = [];
function stopMotion() {
  stops.forEach(stop => stop()); stops = [];
  animations.forEach(animation => animation.stop()); animations = [];
  tabAnimation?.stop();
  document.querySelectorAll('[data-motion]').forEach(element => {
    element.style.opacity = ''; element.style.transform = '';
  });
  content.style.opacity = ''; content.style.transform = '';
  document.documentElement.classList.remove('scroll-cinema');
  document.querySelectorAll('.workflow-stages li').forEach(stage => stage.removeAttribute('data-active'));
  document.querySelector('.workflow-progress span').style.transform = '';
}
function startMotion() {
  stopMotion();
  if (motionPreference.matches) return;
  const intro = [...document.querySelectorAll('.hero-content > *')];
  intro.forEach(element => element.setAttribute('data-motion', ''));
  animations.push(animate(intro, { opacity: [0, 1], y: [22, 0] }, { duration: 0.8, delay: stagger(0.085), ease: [0.22, 1, 0.36, 1] }));
  const sections = document.querySelectorAll('.workflow-heading, .oversight-band, .workflow-stages li, .section-heading, .benefit-grid article, .tailored-grid > div, .steps article, .brand-text, .logo-frame, .people-heading, .people-grid article, .contact-section h2');
  sections.forEach(element => {
    element.setAttribute('data-motion', '');
    stops.push(inView(element, () => {
      animations.push(animate(element, { opacity: [0.15, 1], y: [25, 0] }, { duration: 0.75, ease: [0.22, 1, 0.36, 1] }));
    }, { amount: 0.15 }));
  });
  const hero = document.querySelector('.hero');
  const art = document.querySelector('.hero-art');
  if (cinematicLayout.matches) {
    document.documentElement.classList.add('scroll-cinema');
    const scene = document.querySelector('.workflow-scene');
    const stages = [...document.querySelectorAll('.workflow-stages li')];
    const progress = document.querySelector('.workflow-progress span');
    stops.push(scroll(value => {
      const index = Math.min(2, Math.floor(value * 3));
      stages.forEach((stage, i) => stage.setAttribute('data-active', String(i === index)));
      progress.style.transform = `scaleX(${value})`;
    }, { target: scene, offset: ['start 90px', 'end end'] }));
    const parallax = animate(art, { y: [0, 110], opacity: [1, 0.3] }, { autoplay: false, ease: 'linear' });
    art.setAttribute('data-motion', '');
    animations.push(parallax);
    stops.push(scroll(parallax, { target: hero, offset: ['start start', 'end start'] }));
  }

  const floating = [...document.querySelectorAll('.satellite')];
  floating.forEach(element => element.setAttribute('data-motion', ''));
  // Pause ambient animation while the decorative artwork is outside the viewport.
  stops.push(inView(art, () => {
    const loops = floating.map((element, index) => animate(element,
      { y: [0, index ? -10 : 10, 0] },
      { duration: index ? 4 : 3.5, ease: 'easeInOut' }));
    const onVisibility = () => loops.forEach(loop => document.hidden ? loop.pause() : loop.play());
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    animations.push(...loops);
    return () => { loops.forEach(loop => loop.stop()); document.removeEventListener('visibilitychange', onVisibility); };
  }));
}
motionPreference.addEventListener('change', startMotion);
cinematicLayout.addEventListener('change', startMotion);
startMotion();
