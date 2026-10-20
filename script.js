(() => {
  /* ---------- Часы: московское время ---------- */
  const clock = document.getElementById("clock");
  const timeFmt = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
  const tick = () => { clock.textContent = `${timeFmt.format(new Date())} МСК`; };
  tick();
  setInterval(tick, 10_000);

  /* ---------- Появление карточек при прокрутке ---------- */
  const reveals = [...document.querySelectorAll(".reveal")];
  if (reveals.length) {
    const show = (el) => el.classList.add("is-in");
    if (!("IntersectionObserver" in window)) {
      reveals.forEach(show);
    } else {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          show(e.target);
          io.unobserve(e.target);
        }
      }, { rootMargin: "0px 0px -8% 0px" });
      // То, что уже видно при загрузке, показываем сразу — не ждём наблюдателя.
      reveals.forEach((el, i) => {
        if (el.getBoundingClientRect().top < window.innerHeight) {
          el.style.animationDelay = `${0.25 + (i % 2) * 0.08}s`;
          show(el);
        } else {
          io.observe(el);
        }
      });
    }
  }

  /* ---------- Уведомление «скоро будет» ---------- */
  // Текст берётся из data-soon-title / data-soon-text ссылки, иначе — из разметки тоста.
  const toast = document.getElementById("toast");
  if (!toast) return;
  const toastTitle = toast.querySelector(".toast__title");
  const toastCode = toast.querySelector(".toast__code");
  const DEFAULT_TITLE = toastTitle.textContent;
  const DEFAULT_CODE = toastCode.textContent;
  const TOAST_MS = 4200;
  let hideTimer;

  function hideToast() {
    clearTimeout(hideTimer);
    toast.classList.remove("is-visible");
  }

  function showToast(title, text) {
    clearTimeout(hideTimer);
    toastTitle.textContent = title;
    toastCode.textContent = text;
    // Перезапускаем анимацию, если уведомление уже на экране.
    toast.classList.remove("is-visible");
    void toast.offsetWidth;
    toast.classList.add("is-visible");
    hideTimer = setTimeout(hideToast, TOAST_MS);
  }

  document.querySelectorAll("[data-soon]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      showToast(link.dataset.soonTitle || DEFAULT_TITLE, link.dataset.soonText || DEFAULT_CODE);
    });
  });
  toast.addEventListener("click", hideToast);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideToast(); });
})();
