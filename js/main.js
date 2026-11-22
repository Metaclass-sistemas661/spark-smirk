/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — Main App Entry Point
   Inicializa todos os módulos da landing page
   ═══════════════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════════
// VENDOR IMPORTS (npm packages)
// ══════════════════════════════════════════════════════════════
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

// Register GSAP plugins globally
gsap.registerPlugin(ScrollTrigger);

// Expose to window for modules that need it
window.gsap = gsap;
window.ScrollTrigger = ScrollTrigger;
window.Lenis = Lenis;

// ══════════════════════════════════════════════════════════════
// APP MODULES
// ══════════════════════════════════════════════════════════════
import { SmoothScroll } from './core/smooth-scroll.js';
import { ScrollAnimations } from './core/animations.js';
import { Navbar } from './components/navbar.js';
import { Parallax } from './components/parallax.js';
import { Counter } from './components/counter.js';
import { WhatsApp } from './components/whatsapp.js';
import { initPortfolio } from './components/portfolio.js';

// ══════════════════════════════════════════════════════════════
// MAIN APPLICATION CLASS
// ══════════════════════════════════════════════════════════════
class App {
  constructor() {
    this.modules = {};
    this.isInitialized = false;
  }

  init() {
    // Wait for DOM
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this._boot());
    } else {
      this._boot();
    }
  }

  _boot() {
    console.log('%c⚡ Spark & Smirk — Landing Page Loaded', 
      'color: #E8650A; font-size: 14px; font-weight: bold;');
    console.log('%c🚀 Powered by Vite + GSAP + Lenis', 
      'color: #646CFF; font-size: 11px;');

    // 1. Smooth Scroll (must be first)
    this.modules.smoothScroll = new SmoothScroll();
    this.modules.smoothScroll.init();

    // 2. Navbar
    this.modules.navbar = new Navbar();
    this.modules.navbar.init();

    // 3. Scroll Animations
    this.modules.scrollAnimations = new ScrollAnimations();
    this.modules.scrollAnimations.init();

    // 4. Parallax Effects
    this.modules.parallax = new Parallax();
    this.modules.parallax.init();

    // 5. Counter
    this.modules.counter = new Counter();
    this.modules.counter.init();

    // 6. WhatsApp Button
    this.modules.whatsapp = new WhatsApp({
      phoneNumber: '351965834197',
      message: 'Olá! Gostaria de saber mais sobre os serviços da Spark & Smirk.',
      showDelay: 2500,
    });
    this.modules.whatsapp.init();

    // 7. Portfolio interactivity
    initPortfolio();

    // 8. Form handling
    this._initForm();

    // 8. Preloader removal
    this._removePreloader();

    this.isInitialized = true;
  }

  _initForm() {
    const form = document.querySelector('.contact__form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      console.log('Form submitted:', data);

      // Show success feedback
      const btn = form.querySelector('.contact__submit');
      const originalText = btn.textContent;
      btn.textContent = '✓ Mensagem Enviada!';
      btn.style.background = 'linear-gradient(135deg, #10B981, #059669)';

      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
        form.reset();
      }, 3000);
    });
  }

  _removePreloader() {
    const preloader = document.querySelector('.preloader');
    if (!preloader) return;

    window.addEventListener('load', () => {
      gsap.to(preloader, {
        opacity: 0,
        duration: 0.6,
        ease: 'power2.out',
        onComplete: () => {
          preloader.remove();
        }
      });
    });
  }
}

// ══════════════════════════════════════════════════════════════
// LAUNCH APPLICATION
// ══════════════════════════════════════════════════════════════
const app = new App();
app.init();

// Export for potential external access
export default app;
