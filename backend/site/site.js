// Small progressive enhancements for the Nappies website. The page works without this file.
(() => {
  const header = document.querySelector("header");
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Fade sections in as they scroll into view.
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12 },
  );
  items.forEach((el) => io.observe(el));
})();

// Wake the George's Nappies app server in the background while someone is on the
// website, so the app opens instantly when they download it or sign in.
fetch("https://georges-nappies.onrender.com/api/health", { mode: "no-cors", cache: "no-store" }).catch(() => {});
