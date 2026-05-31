// OpenCode SDK compatibility helpers

type RequestAttempt = () => Promise<any>

interface RoutingParams {
  directory?: string
  workspace?: string
}

function isFailedResponse(response: any): boolean {
  return response === undefined || (!!response && typeof response === "object" && "error" in response && response.error !== undefined)
}

async function firstSuccessful(attempts: RequestAttempt[]): Promise<any> {
  let lastError: unknown

  for (const attempt of attempts) {
    try {
      const response = await attempt()
      if (isFailedResponse(response)) {
        lastError = response?.error ?? new Error("OpenCode API returned no data")
        continue
      }

      return response
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

export async function fetchSessionMessages(client: any, sessionID: string): Promise<any> {
  const messages = client?.session?.messages
  if (typeof messages !== "function") {
    throw new Error("OpenCode session.messages API is unavailable")
  }

  return firstSuccessful([
    () => messages.call(client.session, { path: { id: sessionID }, throwOnError: true }),
    () => messages.call(client.session, { path: { sessionID }, throwOnError: true }),
    () => messages.call(client.session, { sessionID }, { throwOnError: true }),
  ])
}

export async function fetchSessionChildren(client: any, sessionID: string): Promise<any> {
  const children = client?.session?.children
  if (typeof children !== "function") {
    throw new Error("OpenCode session.children API is unavailable")
  }

  return firstSuccessful([
    () => children.call(client.session, { path: { id: sessionID }, throwOnError: true }),
    () => children.call(client.session, { path: { sessionID }, throwOnError: true }),
    () => children.call(client.session, { sessionID }, { throwOnError: true }),
  ])
}

export async function fetchToolList(
  client: any,
  providerID: string,
  modelID: string,
  routing: RoutingParams = {}
): Promise<any> {
  const list = client?.tool?.list
  if (typeof list !== "function") {
    throw new Error("OpenCode tool.list API is unavailable")
  }

  return firstSuccessful([
    () => list.call(client.tool, { query: { ...routing, provider: providerID, model: modelID }, throwOnError: true }),
    () => list.call(client.tool, { ...routing, provider: providerID, model: modelID }, { throwOnError: true }),
  ])
}

export function unwrapResponseData<T>(response: any): T {
  return ((response as any)?.data ?? response) as T
}
