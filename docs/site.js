(() => {
  const NUMBER = "+16504444331";
  const DISPLAY = "+1 (650) 444-4331";
  const LINE_NAME = "Argo";
  const DEFAULT_INVITE = "join BL2LTM";

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

  const normalize = (raw) => String(raw || "").replace(/\s+/g, " ").trim();
  const isReady = (t) => t.length >= 4 && !/^0+$/.test(t.replace(/\s/g, ""));

  function applyInvite(raw) {
    const INVITE = normalize(raw) || DEFAULT_INVITE;
    const ready = isReady(INVITE);

    if (codeEl) {
      codeEl.textContent = ready ? INVITE : "——————";
      codeEl.classList.toggle("is-placeholder", !ready);
      codeEl.setAttribute("aria-label", `Invite text: ${INVITE}`);
    }

    if (textCode) {
      textCode.href = `sms:${NUMBER}&body=${encodeURIComponent(INVITE)}`;
      textCode.classList.remove("is-disabled");
      textCode.setAttribute("aria-disabled", "false");
    }

    if (codeHint) {
      codeHint.textContent =
        "iMessage only — from your own iPhone. Then FaceTime the same number.";
    }

    if (copyCodeBtn) {
      copyCodeBtn.hidden = !ready;
      copyCodeBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(INVITE);
          if (status) status.textContent = "Invite copied. Paste it in iMessage to Argo’s number.";
        } catch {
          if (status) status.textContent = `Text “${INVITE}” to ${DISPLAY} over iMessage.`;
        }
      };
    }
  }

  const params = new URLSearchParams(window.location.search);
  const fromUrl = normalize(params.get("invite") || params.get("code"));
  if (isReady(fromUrl)) {
    applyInvite(fromUrl);
  } else {
    applyInvite(DEFAULT_INVITE);
    Promise.all([
      fetch("invite.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("verify-code.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([invite, legacy]) => {
      const next = normalize(
        (invite && (invite.text || invite.code)) ||
          (legacy && (legacy.text || legacy.code)),
      );
      if (isReady(next)) applyInvite(next);
    });
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
