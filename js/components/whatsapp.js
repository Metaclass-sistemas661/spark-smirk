/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — WhatsApp Floating Button
   ═══════════════════════════════════════════════════════════ */

export class WhatsApp {
  constructor(options = {}) {
    this.phoneNumber = options.phoneNumber || '351965834197';
    this.message = options.message || 'Olá! Gostaria de solicitar um orçamento.';
    this.element = document.querySelector('.whatsapp');
  }

  init() {
    if (!this.element) return;

    this._setLink();
    this.element.classList.remove('is-hidden');
    this.element.classList.add('is-visible');
  }

  _setLink() {
    const btn = this.element.querySelector('.whatsapp__btn');
    if (btn) {
      const encodedMessage = encodeURIComponent(this.message);
      btn.setAttribute('href', `https://wa.me/${this.phoneNumber}?text=${encodedMessage}`);
      btn.setAttribute('target', '_blank');
      btn.setAttribute('rel', 'noopener noreferrer');
    }
  }
}
