type RelayInfoResponse = {
  sessionId: string;
  token: string;
  serverUrl: string;
};

function toHttpUrl(websocketUrl: string): URL {
  const url = new URL(websocketUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url;
}

function toWebSocketUrl(httpUrl: URL): URL {
  const url = new URL(httpUrl.toString());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

export function buildRelayHostUrl(websocketUrl: string, token: string): string {
  const url = new URL(websocketUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function resolveRelayHostUrlCandidate(
  websocketUrl: string | null | undefined,
  codexBaseUrl?: string | null,
  fallbackRelayHostUrl = "",
): string {
  const explicit = websocketUrl?.trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      if (url.pathname === "/v1/api/ladonxrelay/client") {
        url.pathname = "/v1/api/ladonxrelay/host";
        url.search = "";
        return url.toString();
      }
      return explicit;
    } catch {
      return explicit;
    }
  }

  const base = codexBaseUrl?.trim();
  if (base) {
    try {
      const url = new URL(base);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/v1/api/ladonxrelay/host";
      url.search = "";
      return url.toString();
    } catch {
      // Fall back to localhost default when the configured base URL is invalid.
    }
  }

  return fallbackRelayHostUrl;
}

export async function resolveRelayClientUrl(
  relayHostUrl: string,
  token: string,
): Promise<string> {
  const infoUrl = toHttpUrl(relayHostUrl);
  infoUrl.pathname = "/v1/api/ladonxrelay/info";
  infoUrl.search = "";
  infoUrl.searchParams.set("token", token);

  const response = await fetch(infoUrl.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Relay info request failed: ${response.status}`);
  }

  const data = (await response.json()) as RelayInfoResponse;
  if (!data.serverUrl) {
    throw new Error("Relay info response missing client serverUrl.");
  }

  const clientUrl = new URL(data.serverUrl, infoUrl.origin);
  return toWebSocketUrl(clientUrl).toString();
}
