import { loadConfig } from "./config.js";
import { Registry } from "./registry.js";
import { EventBus } from "./events.js";
import type { AppConfig } from "./types.js";

let _config: AppConfig | undefined;
let _registry: Registry | undefined;
let _bus: EventBus | undefined;

export function getConfig(): AppConfig {
  return (_config ??= loadConfig());
}
export function getRegistry(): Registry {
  return (_registry ??= new Registry(getConfig().stateDir));
}
export function getBus(): EventBus {
  return (_bus ??= new EventBus());
}
