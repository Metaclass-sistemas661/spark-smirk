/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — Advanced Parallax Effects
   Powered by GSAP ScrollTrigger
   ═══════════════════════════════════════════════════════════ */

export class Parallax {
  constructor() {
    this.elements = [];
  }

  init() {
    gsap.registerPlugin(ScrollTrigger);

    this._parallaxBackgrounds();
    this._parallaxElements();
    this._parallaxFloating();
    this._parallaxPortfolio();
  }

  /* ── Parallax Background Images ── */
  _parallaxBackgrounds() {
    const bgs = document.querySelectorAll('.parallax-bg');

    bgs.forEach((bg) => {
      const speed = parseFloat(bg.getAttribute('data-speed')) || 0.3;

      gsap.to(bg, {
        yPercent: speed * 100,
        ease: 'none',
        scrollTrigger: {
          trigger: bg.closest('.parallax-container') || bg.parentElement,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.6,
        }
      });
    });
  }

  /* ── Parallax Elements (data-speed) ── */
  _parallaxElements() {
    const elements = document.querySelectorAll('[data-speed]');

    elements.forEach((el) => {
      const speed = parseFloat(el.getAttribute('data-speed')) || 0.1;
      const direction = el.getAttribute('data-direction') || 'vertical';

      const props = {
        ease: 'none',
        scrollTrigger: {
          trigger: el.closest('section') || el.parentElement,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.5,
        }
      };

      if (direction === 'horizontal') {
        props.xPercent = speed * 50;
      } else {
        props.yPercent = speed * 50;
      }

      gsap.to(el, props);
    });
  }

  /* ── Floating Elements (decorative shapes) ── */
  _parallaxFloating() {
    const shapes = document.querySelectorAll('.hero__shape');

    shapes.forEach((shape, i) => {
      const speed = 0.1 + (i * 0.05);
      const direction = i % 2 === 0 ? 1 : -1;

      gsap.to(shape, {
        y: direction * 80 * speed,
        x: direction * 30 * speed,
        rotation: direction * 10,
        ease: 'none',
        scrollTrigger: {
          trigger: '.hero',
          start: 'top top',
          end: 'bottom top',
          scrub: 0.8,
        }
      });
    });
  }

  /* ── Portfolio Items Parallax ── */
  _parallaxPortfolio() {
    const items = document.querySelectorAll('.portfolio__item');

    items.forEach((item) => {
      const img = item.querySelector('.portfolio__image');
      if (!img) return;

      gsap.to(img, {
        yPercent: -15,
        ease: 'none',
        scrollTrigger: {
          trigger: item,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.5,
        }
      });
    });
  }

  destroy() {
    ScrollTrigger.getAll().forEach(st => st.kill());
  }
}
