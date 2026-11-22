/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — GSAP ScrollTrigger Animations
   Animações avançadas de scroll com GSAP
   ═══════════════════════════════════════════════════════════ */

export class ScrollAnimations {
  constructor() {
    this.animations = [];
  }

  init() {
    gsap.registerPlugin(ScrollTrigger);

    this._animateDataAttributes();
    this._animateStaggerGroups();
    this._animateScrollProgress();
    this._animateImageReveals();
    this._animateSectionHeaders();
    this._animateHeroSection();
    this._animateProcessTimeline();
    this._animateCounters();
  }

  /* ── Data Attribute Animations ── */
  _animateDataAttributes() {
    const elements = document.querySelectorAll('[data-animate]');

    elements.forEach((el) => {
      const type = el.getAttribute('data-animate');
      const delay = parseFloat(el.getAttribute('data-delay')) || 0;
      const duration = parseFloat(el.getAttribute('data-duration')) || 1;

      const props = {
        opacity: 1,
        duration: duration,
        delay: delay,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          end: 'bottom 15%',
          toggleActions: 'play none none reverse',
        }
      };

      switch (type) {
        case 'fade-up':
          props.y = 0;
          break;
        case 'fade-down':
          props.y = 0;
          break;
        case 'fade-left':
          props.x = 0;
          break;
        case 'fade-right':
          props.x = 0;
          break;
        case 'fade-in':
          break;
        case 'scale-up':
        case 'scale-in':
          props.scale = 1;
          break;
        case 'rotate-in':
          props.rotation = 0;
          props.y = 0;
          break;
        case 'clip-up':
          props.clipPath = 'inset(0% 0 0 0)';
          break;
        case 'clip-left':
          props.clipPath = 'inset(0 0% 0 0)';
          break;
        case 'blur-in':
          props.filter = 'blur(0px)';
          props.y = 0;
          break;
      }

      this.animations.push(gsap.to(el, props));
    });
  }

  /* ── Stagger Group Animations ── */
  _animateStaggerGroups() {
    const groups = document.querySelectorAll('[data-stagger]');

    groups.forEach((group) => {
      const staggerVal = parseFloat(group.getAttribute('data-stagger')) || 0.1;
      const children = group.children;

      this.animations.push(
        gsap.to(children, {
          opacity: 1,
          y: 0,
          duration: 0.8,
          stagger: staggerVal,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: group,
            start: 'top 80%',
            toggleActions: 'play none none reverse',
          }
        })
      );
    });
  }

  /* ── Scroll Progress Bar ── */
  _animateScrollProgress() {
    const progressBar = document.querySelector('.scroll-progress');
    if (!progressBar) return;

    gsap.to(progressBar, {
      width: '100%',
      ease: 'none',
      scrollTrigger: {
        trigger: document.body,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.3,
      }
    });
  }

  /* ── Image Reveals ── */
  _animateImageReveals() {
    const reveals = document.querySelectorAll('.img-reveal');

    reveals.forEach((reveal) => {
      const img = reveal.querySelector('img');
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: reveal,
          start: 'top 80%',
          toggleActions: 'play none none reverse',
        }
      });

      tl.to(reveal.querySelector('::after') || reveal, {
        duration: 0.8,
        ease: 'power3.inOut',
      })
      .to(img, {
        scale: 1,
        duration: 1.2,
        ease: 'power3.out',
      }, '-=0.4');
    });
  }

  /* ── Section Headers ── */
  _animateSectionHeaders() {
    const headers = document.querySelectorAll('.section-header');

    headers.forEach((header) => {
      const label = header.querySelector('.section-label');
      const title = header.querySelector('.section-title');
      const subtitle = header.querySelector('.section-subtitle');
      const divider = header.querySelector('.section-divider');

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: header,
          start: 'top 80%',
          toggleActions: 'play none none reverse',
        }
      });

      if (label) {
        tl.from(label, {
          opacity: 0,
          y: 20,
          duration: 0.6,
          ease: 'power3.out',
        });
      }

      if (title) {
        tl.from(title, {
          opacity: 0,
          y: 30,
          duration: 0.8,
          ease: 'power3.out',
        }, '-=0.3');
      }

      if (divider) {
        tl.from(divider, {
          scaleX: 0,
          duration: 0.6,
          ease: 'power3.out',
        }, '-=0.4');
      }

      if (subtitle) {
        tl.from(subtitle, {
          opacity: 0,
          y: 20,
          duration: 0.6,
          ease: 'power3.out',
        }, '-=0.3');
      }
    });
  }

  /* ── Hero Section ── */
  _animateHeroSection() {
    const hero = document.querySelector('.hero');
    if (!hero) return;

    const tl = gsap.timeline({ delay: 0.3 });

    tl.from('.hero__label', {
      opacity: 0,
      y: 30,
      duration: 0.8,
      ease: 'power3.out',
    })
    .from('.hero__title', {
      opacity: 0,
      y: 50,
      duration: 1,
      ease: 'power3.out',
    }, '-=0.4')
    .from('.hero__subtitle', {
      opacity: 0,
      y: 30,
      duration: 0.8,
      ease: 'power3.out',
    }, '-=0.5')
    .from('.hero__actions .btn', {
      opacity: 0,
      y: 20,
      stagger: 0.15,
      duration: 0.6,
      ease: 'power3.out',
    }, '-=0.4')
    .from('.hero__scroll', {
      opacity: 0,
      y: 20,
      duration: 0.6,
      ease: 'power3.out',
    }, '-=0.2')
    .from('.hero__stat', {
      opacity: 0,
      y: 30,
      stagger: 0.1,
      duration: 0.6,
      ease: 'power3.out',
    }, '-=0.4');

    // Parallax on hero background
    gsap.to('.hero__bg-image', {
      yPercent: 30,
      ease: 'none',
      scrollTrigger: {
        trigger: hero,
        start: 'top top',
        end: 'bottom top',
        scrub: 0.5,
      }
    });

    // Fade out hero on scroll
    gsap.to('.hero__content', {
      opacity: 0,
      y: -80,
      ease: 'none',
      scrollTrigger: {
        trigger: hero,
        start: '60% top',
        end: 'bottom top',
        scrub: 0.5,
      }
    });
  }

  /* ── Process Timeline ── */
  _animateProcessTimeline() {
    const timeline = document.querySelector('.process__line-fill');
    if (!timeline) return;

    gsap.to(timeline, {
      width: '100%',
      duration: 1.5,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: '.process__timeline',
        start: 'top 70%',
        toggleActions: 'play none none reverse',
      }
    });

    // Animate each step
    gsap.utils.toArray('.process__step').forEach((step, i) => {
      gsap.from(step, {
        opacity: 0,
        y: 40,
        duration: 0.8,
        delay: i * 0.2,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: step,
          start: 'top 80%',
          toggleActions: 'play none none reverse',
        }
      });
    });
  }

  /* ── Counter Animations ── */
  _animateCounters() {
    const counters = document.querySelectorAll('[data-counter]');

    counters.forEach((counter) => {
      const target = parseInt(counter.getAttribute('data-counter'), 10);
      const suffix = counter.getAttribute('data-counter-suffix') || '';
      const prefix = counter.getAttribute('data-counter-prefix') || '';

      const obj = { value: 0 };

      gsap.to(obj, {
        value: target,
        duration: 2,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: counter,
          start: 'top 85%',
          toggleActions: 'play none none reset',
        },
        onUpdate: () => {
          counter.textContent = prefix + Math.round(obj.value) + suffix;
        }
      });
    });
  }

  /* ── Cleanup ── */
  destroy() {
    this.animations.forEach(anim => anim.kill());
    ScrollTrigger.getAll().forEach(st => st.kill());
  }
}
