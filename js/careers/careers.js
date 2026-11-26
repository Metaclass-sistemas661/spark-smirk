/* ═══════════════════════════════════════════════════════════
   SPARK & SMIRK — Página Dedicada "Trabalhe Connosco"
   ═══════════════════════════════════════════════════════════ */

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { SmoothScroll } from '../core/smooth-scroll.js';
import { Navbar } from '../components/navbar.js';
import { WhatsApp } from '../components/whatsapp.js';

gsap.registerPlugin(ScrollTrigger);
window.gsap = gsap;
window.ScrollTrigger = ScrollTrigger;
window.Lenis = Lenis;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler o ficheiro selecionado.'));
    reader.readAsDataURL(file);
  });
}

function initCareersPage() {
  const smoothScroll = new SmoothScroll();
  smoothScroll.init();

  const navbar = new Navbar();
  navbar.init();

  const whatsapp = new WhatsApp({
    phoneNumber: '351965834197',
    message: 'Olá! Gostaria de obter informações sobre oportunidades na Spark & Smirk.',
    showDelay: 2500,
  });
  whatsapp.init();

  const form = document.getElementById('careersForm');
  const formContainer = document.getElementById('careersFormContainer');
  const successCard = document.getElementById('careersSuccessCard');
  const successText = document.getElementById('careersSuccessText');
  const refCodeEl = document.getElementById('careersRefCode');
  const alertEl = document.getElementById('careersAlert');
  const submitBtn = document.getElementById('btnSubmitCareers');
  const newAppBtn = document.getElementById('btnNewApplication');

  const dropzone = document.getElementById('cvDropzone');
  const fileInput = document.getElementById('cvFileInput');
  const dropTitle = document.getElementById('cvDropTitle');
  const dropHint = document.getElementById('cvDropHint');

  if (!form || !dropzone || !fileInput) return;

  let chosenCvFile = null;
  let isSubmitting = false;

  const showAlert = (message) => {
    if (!alertEl) return;
    alertEl.textContent = message;
    alertEl.hidden = !message;
  };

  const setChosenFile = (file) => {
    showAlert('');
    if (!file) {
      chosenCvFile = null;
      dropzone.classList.remove('has-file');
      if (dropTitle) dropTitle.textContent = 'Clique ou arraste o seu currículo para aqui';
      if (dropHint) dropHint.textContent = 'Formatos aceites: PDF, DOC, DOCX, PNG ou JPG (máx. 10 MB)';
      return;
    }

    const allowedExt = /\.(pdf|docx?|png|jpe?g)$/i.test(file.name || '');
    const allowedMime =
      file.type === 'application/pdf' ||
      file.type === 'application/msword' ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.type.startsWith('image/');

    if (!allowedExt && !allowedMime) {
      showAlert('Formato não suportado. Selecione o seu currículo em PDF, DOC, DOCX, PNG ou JPG.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showAlert('O ficheiro do currículo excede o limite máximo de 10 MB.');
      return;
    }

    chosenCvFile = file;
    dropzone.classList.add('has-file');
    if (dropTitle) {
      dropTitle.textContent = `Currículo anexado: ${file.name}`;
    }
    if (dropHint) {
      dropHint.textContent = `Tamanho: ${Math.max(1, Math.round(file.size / 1024))} KB · Clique para substituir o ficheiro`;
    }
  };

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      setChosenFile(fileInput.files[0]);
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('is-dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      setChosenFile(file);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    showAlert('');

    const fd = new window.FormData(form);
    const fullName = String(fd.get('fullName') || '').trim();
    const email = String(fd.get('email') || '').trim().toLowerCase();
    const phone = String(fd.get('phone') || '').trim();
    const district = String(fd.get('district') || 'Porto').trim();
    const specialty = String(fd.get('specialty') || '').trim();
    const experience = String(fd.get('experience') || '1 a 3 anos').trim();
    const availability = String(fd.get('availability') || 'Imediata').trim();
    const drivingLicense = String(fd.get('drivingLicense') || 'Não indicada').trim();
    const certifications = String(fd.get('certifications') || '').trim();
    const message = String(fd.get('message') || '').trim();
    const website = String(fd.get('website') || '').trim();
    const rgpdConsent = Boolean(document.getElementById('candConsent')?.checked);

    if (fullName.length < 2) {
      showAlert('Por favor, indique o seu nome completo.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showAlert('Por favor, introduza um endereço de email válido.');
      return;
    }
    if (phone.replace(/\D/g, '').length < 9) {
      showAlert('Por favor, introduza um número de telemóvel ou telefone válido.');
      return;
    }
    if (!specialty) {
      showAlert('Por favor, selecione a área ou função pretendida.');
      return;
    }
    if (!chosenCvFile) {
      showAlert('Por favor, anexe o seu currículo (PDF, Word ou imagem) antes de submeter.');
      return;
    }
    if (!rgpdConsent) {
      showAlert('Para enviar a sua candidatura, confirme a autorização de tratamento de dados (RGPD).');
      return;
    }

    isSubmitting = true;
    const btnSpan = submitBtn?.querySelector('span');
    if (submitBtn) submitBtn.disabled = true;
    if (btnSpan) btnSpan.textContent = 'A enviar candidatura e currículo...';

    try {
      const cvBase64 = await fileToBase64(chosenCvFile);

      const response = await window.fetch('/api/public/careers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          district,
          specialty,
          experience,
          availability,
          drivingLicense,
          certifications,
          message,
          rgpdConsent,
          website,
          cvFileName: chosenCvFile.name,
          cvFileType: chosenCvFile.type || 'application/pdf',
          cvFileSize: chosenCvFile.size,
          cvBase64,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(
          data?.message ||
            'Não foi possível submeter a candidatura neste momento. Tente novamente dentro de instantes.'
        );
      }

      if (refCodeEl) refCodeEl.textContent = data.code || 'Registada';
      if (successText && data.message) successText.textContent = data.message;
      if (formContainer) formContainer.hidden = true;
      if (successCard) successCard.hidden = false;
      successCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      showAlert(err?.message || 'Ocorreu um erro ao submeter a sua candidatura. Tente novamente.');
    } finally {
      isSubmitting = false;
      if (submitBtn) submitBtn.disabled = false;
      if (btnSpan) btnSpan.textContent = 'Submeter Candidatura e Currículo';
    }
  });

  newAppBtn?.addEventListener('click', () => {
    form.reset();
    setChosenFile(null);
    showAlert('');
    if (successCard) successCard.hidden = true;
    if (formContainer) formContainer.hidden = false;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCareersPage);
} else {
  initCareersPage();
}
