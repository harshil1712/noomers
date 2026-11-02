// Crew interactions. Vanilla JS; all movement is transform-only, driven by CSS custom
// properties (--crew-x on the hero scene, --crew-eye-x/-y on each sprite, --escort-y on
// the escort). The rAF loop only runs while the lane is settling and the hero is on screen.
// Sprites are aria-hidden. Reduced motion = static poses; touch = no pointer follow.
// Links are never intercepted: the CTA cheer runs on hover/focus and clicks navigate.

const CHEER_STAGGER_MS = 120;
const CHEER_COOLDOWN_MS = 1200;
const IDLE_MS = 3000;
const FOLLOW_CAP_PX = 14;

function jump(s: HTMLElement) {
  s.classList.add("sp-jump");
}

export function initCrew() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const TOUCH = matchMedia("(pointer: coarse)").matches;
  const sps = [...document.querySelectorAll<HTMLElement>(".sp")];
  if (!sps.length) return;
  const scene = document.querySelector<HTMLElement>(".scene");
  const lane = scene ? [...scene.querySelectorAll<HTMLElement>(".sp")] : [];
  const crew = lane.length ? lane : sps;

  // hop on hover; the class clears itself when the hop keyframes finish
  for (const s of sps) {
    s.addEventListener("mouseenter", () => jump(s));
    const clear = (e: AnimationEvent) => {
      if (e.animationName === "sp-hop") s.classList.remove("sp-jump");
    };
    s.addEventListener("animationend", clear);
    s.addEventListener("animationcancel", clear);
  }

  // hover a what-ships row → matching lane sprite hops
  document.querySelectorAll(".row").forEach((r, i) =>
    r.addEventListener("mouseenter", () => {
      const s = crew[Math.min(i, crew.length - 1)];
      if (s) jump(s);
    }),
  );

  // Get noomers: the crew cheers when you aim at it (hover or keyboard focus).
  // No click handler, so the link always navigates.
  let lastCheer = 0;
  const cheer = () => {
    const now = performance.now();
    if (now - lastCheer < CHEER_COOLDOWN_MS) return;
    lastCheer = now;
    crew.forEach((s, i) => setTimeout(() => jump(s), i * CHEER_STAGGER_MS));
  };
  document.querySelectorAll<HTMLElement>("[data-cta]").forEach((b) => {
    b.addEventListener("pointerenter", cheer);
    b.addEventListener("focus", cheer);
  });

  // pointer follow (lerped, ±14px cap); idle 3s → back to work
  if (!TOUCH && scene && lane.length) {
    let target = 0;
    let current = 0;
    let frame = 0;
    let visible = false;
    let eyes = "";
    let idle: ReturnType<typeof setTimeout> | undefined;

    const setEyes = (x: number, y: number) => {
      const key = `${x},${y}`;
      if (key === eyes) return; // only touch styles when the look direction changes
      eyes = key;
      for (const s of sps) {
        s.style.setProperty("--crew-eye-x", `${x}px`);
        s.style.setProperty("--crew-eye-y", `${y}px`);
      }
    };
    const tick = () => {
      current += (target - current) * 0.12;
      if (Math.abs(target - current) < 0.1) current = target;
      scene.style.setProperty("--crew-x", `${current.toFixed(2)}px`);
      frame = current === target ? 0 : requestAnimationFrame(tick);
    };
    const start = () => {
      if (!frame && visible && current !== target) frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    }).observe(scene);

    addEventListener(
      "pointermove",
      (e) => {
        if (!visible) return;
        const dx = e.clientX - innerWidth / 2;
        const dy = e.clientY - innerHeight / 2;
        target = Math.max(-FOLLOW_CAP_PX, Math.min(FOLLOW_CAP_PX, dx / 40));
        setEyes(Math.sign(dx) * 2, Math.sign(dy) * 1.5);
        start();
        clearTimeout(idle);
        idle = setTimeout(() => {
          target = 0;
          setEyes(0, 0);
          start();
        }, IDLE_MS);
      },
      { passive: true },
    );
  }

  // scroll escort: one sprite rides the right gutter (≥1400px only)
  const host = document.getElementById("escort");
  const esc = host?.querySelector<HTMLElement>(".sp");
  if (host && esc && innerWidth >= 1400) {
    const io = new IntersectionObserver((entries) => {
      for (const x of entries) {
        if (!x.isIntersecting) continue;
        host.classList.add("on");
        jump(esc);
        const y = Math.min(innerHeight * 0.7, Math.max(160, x.boundingClientRect.top + 40));
        host.style.setProperty("--escort-y", `${Math.round(y)}px`);
        const carry = esc.querySelector(".carry");
        if (carry) carry.textContent = x.target.id === "agents" ? "WIP" : "AUTH";
      }
    });
    for (const id of ["ships", "agents"]) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
  }
}
initCrew();
