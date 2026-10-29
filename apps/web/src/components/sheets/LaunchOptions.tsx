import type { Effort, Model } from "@mojito/shared";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EFFORT_LABELS, MODEL_LABELS } from "@/lib/launch";

interface Props {
  idPrefix: string;
  model: Model;
  effort: Effort;
  onModel: (model: Model) => void;
  onEffort: (effort: Effort) => void;
}

/** The Model / Effort pair shared by the ticket launch and the new-session sheets. */
export function LaunchOptions({ idPrefix, model, effort, onModel, onEffort }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-model`}>Model</Label>
        <Select value={model} onValueChange={(v) => onModel(v as Model)}>
          <SelectTrigger id={`${idPrefix}-model`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MODEL_LABELS) as Model[]).map((m) => (
              <SelectItem key={m} value={m}>
                {MODEL_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-effort`}>Effort</Label>
        <Select value={effort} onValueChange={(v) => onEffort(v as Effort)}>
          <SelectTrigger id={`${idPrefix}-effort`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(EFFORT_LABELS) as Effort[]).map((e) => (
              <SelectItem key={e} value={e}>
                {EFFORT_LABELS[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
