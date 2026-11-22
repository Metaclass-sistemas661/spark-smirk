/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — Navbar Component
   ═══════════════════════════════════════════════════════════ */

export class Navbar {
  constructor() {
    this.navbar = document.querySelector('.navbar');
    this.toggle = document.querySelector('.navbar__toggle');
    this.mobileMenu = document.querySelector('.navbar__mobile-menu');
    this.mobileLinks = document.querySelectorAll('.navbar__mobile-link');
    this.links = document.querySelectorAll('.navbar__link');
    this.isOpen = false;
    this.scrollThreshold = 50;
  }

  init() {
    if (!this.navbar) return;

    this._handleScroll();
    this._handleToggle();
    this._handleMobileLinks();
    this._handleActiveLink();
  }

  _handleScroll() {
    // Initial check
    this._checkScroll();

    // Listen for scroll via Lenis or native
    window.addEventListener('scroll', () => this._checkScroll(), { passive: true });
  }

  _checkScroll() {
    const scrollY = window.scrollY || window.pageYOffset;

    if (scrollY > this.scrollThreshold) {
      this.navbar.classList.add('is-scrolled');
    } else {
      this.navbar.classList.remove('is-scrolled');
    }
  }

  _handleToggle() {
    if (!this.toggle) return;

    this.toggle.addEventListener('click', () => {
      this.isOpen = !this.isOpen;
      this.toggle.classList.toggle('is-active', this.isOpen);
      this.mobileMenu.classList.toggle('is-active', this.isOpen);

      // Stagger mobile links
      if (this.isOpen) {
        this.mobileLinks.forEach((link, i) => {
          link.style.transitionDelay = `${0.1 + i * 0.05}s`;
        });
        document.body.style.overflow = 'hidden';
      } else {
        this.mobileLinks.forEach((link) => {
          link.style.transitionDelay = '0s';
        });
        document.body.style.overflow = '';
      }
    });
  }

  _handleMobileLinks() {
    this.mobileLinks.forEach((link) => {
      link.addEventListener('click', () => {
        this.isOpen = false;
        this.toggle.classList.remove('is-active');
        this.mobileMenu.classList.remove('is-active');
        document.body.style.overflow = '';
      });
    });
  }

  _handleActiveLink() {
    const sections = document.querySelectorAll('section[id]');

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          
          this.links.forEach(link => link.classList.remove('active'));
          this.mobileLinks.forEach(link => link.classList.remove('active'));
          
          const activeLink = document.querySelector(`.navbar__link[href="#${id}"]`);
          const activeMobileLink = document.querySelector(`.navbar__mobile-link[href="#${id}"]`);
          
          if (activeLink) activeLink.classList.add('active');
          if (activeMobileLink) activeMobileLink.classList.add('active');
        }
      });
    }, {
      threshold: 0.3,
      rootMargin: '-80px 0px -50% 0px',
    });

    sections.forEach(section => observer.observe(section));
  }
}
