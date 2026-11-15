(() => {
  const NUMBER = "+16504444331";
  const DISPLAY = "+1 (650) 444-4331";
  const LINE_NAME = "Silas Thorne";
  const DEFAULT_VERIFY_CODE = "000000";

  const facetime = document.getElementById("facetime-link");
  const textCode = document.getElementById("text-code-link");
  const copyBtn = document.getElementById("copy-number");
  const copyCodeBtn = document.getElementById("copy-code");
  const status = document.getElementById("copy-status");
  const numberLabel = document.getElementById("number-label");
  const codeEl = document.getElementById("verify-code");
  const codeHint = document.getElementById("verify-hint");

  if (facetime) facetime.href = `facetime://${NUMBER}`;
  if (copyBtn) copyBtn.dataset.number = NUMBER;
  if (numberLabel) numberLabel.textContent = `${DISPLAY} · ${LINE_NAME}`;

  const normalize = (raw) => String(raw || "").replace(/\D/g, "").slice(0, 6);
  const isReady = (c) => /^\d{6}$/.test(c) && c !== "000000";

  function applyCode(raw) {
    const VERIFY_CODE = normalize(raw);
    const codeReady = isReady(VERIFY_CODE);

    if (codeEl) {
      codeEl.textContent = codeReady ? VERIFY_CODE : "——————";
      codeEl.classList.toggle("is-placeholder", !codeReady);
    }

    if (textCode) {
      if (codeReady) {
        textCode.href = `sms:${NUMBER}&body=${encodeURIComponent(VERIFY_CODE)}`;
        textCode.classList.remove("is-disabled");
        textCode.setAttribute("aria-disabled", "false");
      } else {
        textCode.href = "#verify";
        textCode.classList.add("is-disabled");
        textCode.setAttribute("aria-disabled", "true");
      }
    }

    if (codeHint) {
      codeHint.textContent = codeReady
        ? "iMessage only. Wait for “Verified,” then FaceTime."
        : "Ask the Argo team for today’s 6-digit code (or open with ?code=123456).";
    }

    if (copyCodeBtn) {
      copyCodeBtn.hidden = !codeReady;
      copyCodeBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(VERIFY_CODE);
          if (status) status.textContent = "Code copied. Paste it in iMessage to Argo’s number.";
        } catch {
          if (status) status.textContent = `Text ${VERIFY_CODE} to ${DISPLAY} over iMessage.`;
        }
      };
    }
  }

  const params = new URLSearchParams(window.location.search);
  const fromUrl = normalize(params.get("code"));
  if (isReady(fromUrl)) {
    applyCode(fromUrl);
  } else {
    applyCode(DEFAULT_VERIFY_CODE);
    fetch("verify-code.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const fromFile = normalize(data.code);
        if (isReady(fromFile)) applyCode(fromFile);
      })
      .catch(() => {});
  }

  copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(NUMBER);
      if (status) status.textContent = "Number copied.";
    } catch {
      if (status) status.textContent = `FaceTime or iMessage ${DISPLAY}`;
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
