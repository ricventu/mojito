import { loadConfig } from "./config";
import { Registry } from "./registry";
import { EventBus } from "./events";
import type { AppConfig } from "./types";

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
