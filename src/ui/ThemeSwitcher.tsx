import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";

const THEME_ORDER = ["system", "light", "dark"] as const;

const THEMES = {
  system: { label: "System theme", short: "System", icon: MonitorIcon },
  light: { label: "Light theme", short: "Light", icon: SunIcon },
  dark: { label: "Dark theme", short: "Dark", icon: MoonIcon },
} as const;

type Theme = (typeof THEME_ORDER)[number];

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && Object.hasOwn(THEMES, value);
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>(() => {
    const initial = document.documentElement.dataset.theme;
    return isTheme(initial) ? initial : "system";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      root.classList.toggle("dark", theme === "dark" || (theme === "system" && system.matches));
    };
    apply();
    if (theme === "system") {
      system.addEventListener("change", apply);
      return () => system.removeEventListener("change", apply);
    }
  }, [theme]);

  const selectTheme = (value: Theme) => {
    setTheme(value);
    try {
      localStorage.setItem("diffcheck-theme", value);
    } catch {
      // Keep the choice for this page when the browser blocks storage.
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = THEME_ORDER.indexOf(theme);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % THEME_ORDER.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + THEME_ORDER.length) % THEME_ORDER.length;
    if (next === null) return;
    e.preventDefault();
    const targetTheme = THEME_ORDER[next]!;
    selectTheme(targetTheme);
    const btn = e.currentTarget.querySelector<HTMLButtonElement>(`[data-theme-option="${targetTheme}"]`);
    btn?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={onKeyDown}
      className="inline-flex shrink-0 items-center rounded-lg border border-border/70 bg-muted p-0.5"
    >
      {THEME_ORDER.map((value) => {
        const { label, short, icon: ThemeIcon } = THEMES[value];
        const checked = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            tabIndex={checked ? 0 : -1}
            data-theme-option={value}
            onClick={() => selectTheme(value)}
            className="inline-flex size-7 items-center justify-center rounded-[5px] text-muted-foreground outline-none motion-safe:transition-[color,background-color,box-shadow] motion-safe:duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45 aria-checked:bg-card aria-checked:text-foreground aria-checked:shadow-2xs pointer-coarse:size-11"
          >
            <ThemeIcon className="size-3.5" aria-hidden />
            <span className="sr-only">{short}</span>
          </button>
        );
      })}
    </div>
  );
}
