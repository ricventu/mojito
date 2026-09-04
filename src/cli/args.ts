import type { Effort } from "@/server/types";

export interface CliArgs {
  kind: "custom" | "shell";
  model: string;
  effort: Effort;
  print: boolean;
  help: boolean;
}

/** The New-session sheet's own defaults, so the two ways of opening a session agree. */
export const CLI_DEFAULTS: CliArgs = {
  kind: "custom", model: "opus", effort: "high", print: false, help: false,
};

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

function isEffort(value: string): value is Effort {
  return (EFFORTS as string[]).includes(value);
}

/**
 * Parse the command line, pure. Every rejection is a throw rather than a silent default:
 * the command's whole job is to spawn something, and a mistyped flag that launches an
 * opus session anyway is worse than one that says what it did not understand.
 *
 * `--flag value` and `--flag=value` are both accepted because a shell user writes both.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { ...CLI_DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    const inline = arg.startsWith("--") && eq > 0 ? arg.slice(eq + 1) : null;
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "") throw new Error(`${name} needs a value`);
      return v;
    };
    switch (name) {
      case "--shell": case "-s": args.kind = "shell"; break;
      case "--print": args.print = true; break;
      case "--help": case "-h": args.help = true; break;
      case "--model": args.model = value(); break;
      case "--effort": {
        const effort = value();
        if (!isEffort(effort)) throw new Error(`--effort must be one of ${EFFORTS.join(", ")}`);
        args.effort = effort;
        break;
      }
      default:
        if (name.startsWith("-")) throw new Error(`unknown option: ${name}`);
        throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return args;
}
