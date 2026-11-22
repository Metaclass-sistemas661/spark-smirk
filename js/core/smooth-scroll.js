/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — Lenis Smooth Scroll Init
   A biblioteca de smooth scroll mais avançada do mercado
   ═══════════════════════════════════════════════════════════ */

export class SmoothScroll {
  constructor() {
    this.lenis = null;
    this.isReady = false;
  }

  init() {
    // Initialize Lenis with premium settings
    this.lenis = new Lenis({
      duration: 1.2,                    // Duração do scroll suave
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // Easing exponencial
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 2,
      infinite: false,
      autoResize: true,
    });

    // Connect Lenis to GSAP ScrollTrigger
    this.lenis.on('scroll', ScrollTrigger.update);

    // Use GSAP ticker for Lenis
    gsap.ticker.add((time) => {
      this.lenis.raf(time * 1000);
    });

    gsap.ticker.lagSmoothing(0);

    this.isReady = true;

    // Handle anchor links with smooth scroll
    this._handleAnchorLinks();

    return this.lenis;
  }

  _handleAnchorLinks() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = anchor.getAttribute('href');
        
        if (targetId === '#') return;
        
        const target = document.querySelector(targetId);
        if (target) {
          this.lenis.scrollTo(target, {
            offset: -80, // Offset for fixed navbar
            duration: 1.5,
          });
        }
      });
    });
  }

  scrollTo(target, options = {}) {
    if (this.lenis) {
      this.lenis.scrollTo(target, {
        offset: -80,
        duration: 1.5,
        ...options,
      });
    }
  }

  stop() {
    if (this.lenis) this.lenis.stop();
  }

  start() {
    if (this.lenis) this.lenis.start();
  }

  destroy() {
    if (this.lenis) {
      this.lenis.destroy();
      this.isReady = false;
    }
  }
}
