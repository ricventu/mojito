import { useSearchParams } from "react-router";
import { resolveHost, type HostResolution } from "@/lib/host";
import { usePeers } from "@/hooks/usePeers";

/** Which instance the current url addresses (`?host=`). */
export function useHost(): HostResolution {
  const [params] = useSearchParams();
  const { data } = usePeers();
  return resolveHost(params.get("host"), data);
}
