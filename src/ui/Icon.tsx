import type { ReactNode } from "react";

const paths = {
  logo: <><path d="M3 5h8v14H3zM14 5h7v14h-7z" /><path d="M5.5 12h3m7.5 0h3m-1.5-1.5v3" /></>,
  sheet: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 0v6h6" /><path d="M8 12h8v6H8zm0 3h8m-4-3v6" /></>,
  code: <><path d="M8 6 2 12l6 6m8-12 6 6-6 6m-3-15-2 18" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3" /></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  swap: <path d="M3 8h17m-4-4 4 4-4 4m5 4H4m4-4-4 4 4 4" />,
  edit: <path d="m4 16-1 5 5-1L20 8l-4-4zM14 6l4 4" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  up: <path d="m6 14 6-6 6 6" />,
  down: <path d="m6 10 6 6 6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
} satisfies Record<string, ReactNode>;

export function Icon({ name, size = 18, ...props }: { name: keyof typeof paths; size?: number; "data-icon"?: "inline-start" | "inline-end" }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" {...props}>
      {paths[name]}
    </svg>
  );
}
