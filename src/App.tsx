import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useState } from "react";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { Icon } from "./ui/Icon";
import { SpreadsheetMode } from "./SpreadsheetMode";
import { TextMode } from "./ui/text/TextMode";
import { ThemeSwitcher } from "./ui/ThemeSwitcher";

type Mode = "sheet" | "text";

const MODES: Array<{ id: Mode; label: string; hash: string; icon: "sheet" | "code" }> = [
  { id: "sheet", label: "Spreadsheet", hash: "", icon: "sheet" },
  { id: "text", label: "Text & JSON", hash: "#text", icon: "code" },
];

const modeFromHash = (): Mode => (window.location.hash === "#text" ? "text" : "sheet");

/** Shell: mode switch, kept in the URL hash so a reload stays on the same mode. Both modes stay mounted. */
export function App() {
  const [mode, setMode] = useState<Mode>(modeFromHash);

  useEffect(() => {
    const onHash = () => setMode(modeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Stop the browser from opening a file dropped outside the drop zones.
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const select = (m: (typeof MODES)[number]) => {
    history.replaceState(null, "", m.hash || window.location.pathname + window.location.search);
    setMode(m.id);
  };

  return (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        const next = MODES.find((entry) => entry.id === value);
        if (next) select(next);
      }}
      className="flex min-h-dvh flex-col min-[901px]:[@media(min-height:720px)]:h-dvh"
    >
      <header className="shrink-0 border-b border-border bg-card">
        <div className="mx-auto grid max-w-[112rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2 min-[721px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] min-[721px]:px-[clamp(1rem,2.5vw,2rem)]">
          <div className="flex min-h-8 items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-primary text-primary-foreground" aria-hidden>
              <Icon name="logo" size={14} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-foreground">Diffcheck</span>
          </div>

          <TabsList
            className="col-span-2 row-start-2 w-full min-[721px]:col-span-1 min-[721px]:row-start-auto min-[721px]:w-auto"
            aria-label="Comparison type"
          >
            {MODES.map((m) => (
              <TabsTrigger key={m.id} value={m.id} className="min-[721px]:px-4">
                <Icon name={m.icon} size={14} />
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex min-w-0 items-center gap-3 justify-self-end">
            <p
              className="hidden items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground min-[420px]:flex [&_svg]:shrink-0"
              title="Files stay in your browser — nothing is uploaded"
            >
              <Icon name="lock" size={13} />
              <span className="hidden min-[560px]:inline">Local only</span>
              <span className="min-[560px]:hidden" aria-hidden>Local</span>
              <span className="sr-only">Files stay in your browser</span>
            </p>
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[112rem] min-w-0 flex-1 flex-col px-3 pt-3 pb-4 min-[901px]:min-h-0 min-[721px]:px-[clamp(1rem,2.5vw,2rem)]">
        <TabsContent value="sheet" keepMounted className="flex min-w-0 flex-1 flex-col min-[901px]:min-h-0">
          <ErrorBoundary scope="Spreadsheet mode">
            <SpreadsheetMode active={mode === "sheet"} />
          </ErrorBoundary>
        </TabsContent>
        <TabsContent value="text" keepMounted className="flex min-w-0 flex-1 flex-col min-[901px]:min-h-0">
          <ErrorBoundary scope="Text & JSON mode">
            <TextMode active={mode === "text"} />
          </ErrorBoundary>
        </TabsContent>
      </main>
    </Tabs>
  );
}
