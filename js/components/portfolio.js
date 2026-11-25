// ═══════════════════════════════════════════════════════════
// SPARK & SMIRK — Enterprise Portfolio & Lightbox Component
// ═══════════════════════════════════════════════════════════

export function initPortfolio() {
  const menuItems = document.querySelectorAll('.portfolio__menu-item');
  const panels = document.querySelectorAll('.portfolio__panel');

  if (!menuItems.length || !panels.length) return;

  menuItems.forEach((item) => {
    item.addEventListener('click', () => {
      const category = item.dataset.category;

      menuItems.forEach((mi) => {
        mi.classList.remove('active');
        mi.setAttribute('aria-selected', 'false');
      });

      item.classList.add('active');
      item.setAttribute('aria-selected', 'true');
      item.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

      panels.forEach((panel) => {
        panel.classList.remove('active');
      });

      const targetPanel = document.querySelector(`[data-panel="${category}"]`);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });

  // ── Enterprise Lightbox para visualização integral ──
  const lightbox = document.getElementById('portfolioLightbox');
  if (!lightbox) return;

  const lbImage = document.getElementById('lightboxImage');
  const lbCategory = document.getElementById('lightboxCategory');
  const lbCounter = document.getElementById('lightboxCounter');
  const lbCaption = document.getElementById('lightboxCaption');
  const lbPrev = document.getElementById('lightboxPrev');
  const lbNext = document.getElementById('lightboxNext');
  const lbClose = document.getElementById('lightboxClose');

  let activeCards = [];
  let activeIndex = 0;
  let activeCategoryName = '';
  let touchStartX = 0;

  const renderSlide = () => {
    const card = activeCards[activeIndex];
    if (!card) return;
    const img = card.querySelector('.portfolio__media img');
    const captionEl = card.querySelector('.portfolio__caption');
    if (!img) return;

    lbImage.src = img.currentSrc || img.src;
    lbImage.alt = img.alt || activeCategoryName;
    lbCategory.textContent = activeCategoryName;
    lbCounter.textContent = `Foto ${activeIndex + 1} de ${activeCards.length}`;
    lbCaption.textContent = captionEl?.textContent?.trim() || img.alt || '';

    const hasMultiple = activeCards.length > 1;
    if (lbPrev) lbPrev.hidden = !hasMultiple;
    if (lbNext) lbNext.hidden = !hasMultiple;
  };

  const openLightbox = (panel, card) => {
    activeCards = Array.from(panel.querySelectorAll('.portfolio__card'));
    activeIndex = Math.max(0, activeCards.indexOf(card));
    activeCategoryName = panel.querySelector('.portfolio__info h3')?.textContent?.trim() || 'Portfólio';
    renderSlide();
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  };

  const closeLightbox = () => {
    lightbox.hidden = true;
    lbImage.src = '';
    document.body.style.overflow = '';
  };

  const stepSlide = (delta) => {
    if (activeCards.length <= 1) return;
    activeIndex = (activeIndex + delta + activeCards.length) % activeCards.length;
    renderSlide();
  };

  panels.forEach((panel) => {
    panel.querySelectorAll('.portfolio__card').forEach((card) => {
      card.addEventListener('click', () => openLightbox(panel, card));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openLightbox(panel, card);
        }
      });
    });
  });

  lbPrev?.addEventListener('click', () => stepSlide(-1));
  lbNext?.addEventListener('click', () => stepSlide(1));
  lbClose?.addEventListener('click', closeLightbox);
  lightbox.querySelectorAll('[data-lightbox-close]').forEach((el) => {
    el.addEventListener('click', closeLightbox);
  });

  document.addEventListener('keydown', (e) => {
    if (lightbox.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') stepSlide(-1);
    if (e.key === 'ArrowRight') stepSlide(1);
  });

  lightbox.addEventListener(
    'touchstart',
    (e) => {
      touchStartX = e.changedTouches?.[0]?.clientX || 0;
    },
    { passive: true }
  );

  lightbox.addEventListener(
    'touchend',
    (e) => {
      const touchEndX = e.changedTouches?.[0]?.clientX || 0;
      const diff = touchEndX - touchStartX;
      if (Math.abs(diff) > 45) {
        stepSlide(diff < 0 ? 1 : -1);
      }
    },
    { passive: true }
  );
}
