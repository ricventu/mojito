import { COMMAND_ICONS, type CommandIcon } from "@mojito/shared";
import { CommandIconView } from "@/lib/commandIcons";
import { cn } from "@/lib/utils";

interface Props {
  value: CommandIcon;
  onChange: (icon: CommandIcon) => void;
  labelledBy: string;
}

/** Every command icon as a tap target; the picked one is ringed. */
export function IconGrid({ value, onChange, labelledBy }: Props) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-8 gap-1 sm:grid-cols-10">
      {COMMAND_ICONS.map((icon) => (
        <button
          key={icon}
          type="button"
          role="radio"
          aria-checked={icon === value}
          aria-label={icon}
          title={icon}
          onClick={() => onChange(icon)}
          className={cn(
            "flex aspect-square items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            icon === value && "bg-accent text-foreground ring-2 ring-primary",
          )}
        >
          <CommandIconView icon={icon} size={18} />
        </button>
      ))}
    </div>
  );
}
