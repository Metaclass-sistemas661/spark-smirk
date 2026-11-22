// ═══════════════════════════════════════════════════════════
// SPARK & SMIRK — Portfolio Component
// ═══════════════════════════════════════════════════════════

export function initPortfolio() {
  const menuItems = document.querySelectorAll('.portfolio__menu-item');
  const panels = document.querySelectorAll('.portfolio__panel');

  if (!menuItems.length || !panels.length) return;

  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      const category = item.dataset.category;

      // Remove active from all menu items
      menuItems.forEach(mi => mi.classList.remove('active'));
      
      // Add active to clicked item
      item.classList.add('active');

      // Hide all panels
      panels.forEach(panel => panel.classList.remove('active'));

      // Show selected panel
      const targetPanel = document.querySelector(`[data-panel="${category}"]`);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });

  // Auto-scroll carousels
  const carousels = document.querySelectorAll('.portfolio__slides');
  carousels.forEach(carousel => {
    let scrollInterval;
    
    const startAutoScroll = () => {
      scrollInterval = setInterval(() => {
        if (carousel.scrollLeft >= carousel.scrollWidth - carousel.clientWidth) {
          carousel.scrollLeft = 0;
        } else {
          carousel.scrollLeft += 1;
        }
      }, 30);
    };

    const stopAutoScroll = () => {
      clearInterval(scrollInterval);
    };

    // Start auto-scroll
    startAutoScroll();

    // Pause on hover
    carousel.addEventListener('mouseenter', stopAutoScroll);
    carousel.addEventListener('mouseleave', startAutoScroll);
  });
}