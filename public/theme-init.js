(() => {
  let theme = "system";
  try {
    const saved = localStorage.getItem("diffcheck-theme");
    if (saved === "dark" || saved === "light") theme = saved;
  } catch {
    // Storage can be unavailable in private or restricted contexts.
  }
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches));
})();
