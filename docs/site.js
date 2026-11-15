(() => {
  const NUMBER = "+16504444331";
  const DISPLAY = "+1 (650) 444-4331";
  const LINE_NAME = "Silas Thorne";

  const facetime = document.getElementById("facetime-link");
  const copyBtn = document.getElementById("copy-number");
  const status = document.getElementById("copy-status");
  const numberLabel = document.getElementById("number-label");

  if (facetime) facetime.href = `facetime://${NUMBER}`;
  if (copyBtn) copyBtn.dataset.number = NUMBER;
  if (numberLabel) numberLabel.textContent = `${DISPLAY} · ${LINE_NAME}`;

  copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(NUMBER);
      if (status) status.textContent = "Number copied.";
    } catch {
      if (status) status.textContent = `Call or FaceTime ${DISPLAY}`;
    }
  });

  const reveal = document.querySelectorAll(".band, .face, .foot");
  if ("IntersectionObserver" in window) {
    reveal.forEach((el) => el.classList.add("reveal"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    reveal.forEach((el) => io.observe(el));
  }
})();
