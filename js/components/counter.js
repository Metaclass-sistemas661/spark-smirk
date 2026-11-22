/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — Counter Component
   Animação de números com contagem progressiva
   ═══════════════════════════════════════════════════════════ */

export class Counter {
  constructor() {
    this.counters = document.querySelectorAll('[data-counter]');
    this.observed = new Set();
  }

  init() {
    if (!this.counters.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !this.observed.has(entry.target)) {
          this.observed.add(entry.target);
          this._animateCounter(entry.target);
        }
      });
    }, {
      threshold: 0.5,
    });

    this.counters.forEach(counter => observer.observe(counter));
  }

  _animateCounter(el) {
    const target = parseInt(el.getAttribute('data-counter'), 10);
    const suffix = el.getAttribute('data-counter-suffix') || '';
    const prefix = el.getAttribute('data-counter-prefix') || '';
    const duration = parseInt(el.getAttribute('data-counter-duration'), 10) || 2000;

    let startTime = null;
    const startValue = 0;

    const step = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);

      // Easing: easeOutQuart
      const eased = 1 - Math.pow(1 - progress, 4);
      const current = Math.round(startValue + (target - startValue) * eased);

      el.textContent = prefix + current + suffix;

      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };

    window.requestAnimationFrame(step);
  }
}
