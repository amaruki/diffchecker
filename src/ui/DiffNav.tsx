import { Button } from "@/components/ui/button";
import { Icon } from "./Icon";

interface DiffNavProps {
  onPrev: () => void;
  onNext: () => void;
  /** Number of navigation stops. */
  total: number;
  /** Index of the current stop, or -1 when the selection is not on one. */
  current: number;
  /** Singular noun for one stop: "Difference", "Change". */
  noun: string;
  emptyText: string;
}

/** Previous / Next buttons with the position counter. Shared by both modes. */
export function DiffNav({ onPrev, onNext, total, current, noun, emptyText }: DiffNavProps) {
  const lower = noun.toLowerCase();
  return (
    <div className="flex items-center gap-2" role="group" aria-label={`${noun} navigation`}>
      <div className="inline-flex items-center">
        <Button
          variant="outline"
          size="icon-xs"
          className="rounded-r-none border-r-0 shadow-none"
          onClick={onPrev}
          disabled={total === 0}
          aria-label={`Previous ${lower}`}
          title={`Previous ${lower} (p or k)`}
          aria-keyshortcuts="p k Shift+F8"
        >
          <Icon name="up" size={14} />
        </Button>
        <Button
          variant="outline"
          size="icon-xs"
          className="rounded-l-none shadow-none"
          onClick={onNext}
          disabled={total === 0}
          aria-label={`Next ${lower}`}
          title={`Next ${lower} (n or j)`}
          aria-keyshortcuts="n j F8"
        >
          <Icon name="down" size={14} />
        </Button>
      </div>
      <span className="whitespace-nowrap font-mono text-xs tabular-nums" aria-live="polite">
        {total === 0 ? (
          <span className="font-sans text-muted-foreground">{emptyText}</span>
        ) : current < 0 ? (
          <span className="font-sans text-muted-foreground">
            0 / {total.toLocaleString()}
          </span>
        ) : (
          <>
            <strong className="font-semibold text-foreground">{(current + 1).toLocaleString()}</strong>
            <span className="text-muted-foreground"> / {total.toLocaleString()}</span>
          </>
        )}
      </span>
    </div>
  );
}
