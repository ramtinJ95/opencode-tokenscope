// OpenCode SDK compatibility helpers

export async function fetchSessionMessages(client: any, sessionID: string): Promise<any> {
  try {
    return await client.session.messages({ path: { id: sessionID } })
  } catch (error) {
    if (!client?.session?.messages) throw error
    return await client.session.messages({ path: { sessionID } })
  }
}

export async function fetchSessionInfo(client: any, sessionID: string): Promise<any> {
  try {
    return await client.session.get({ path: { id: sessionID } })
  } catch (error) {
    if (!client?.session?.get) throw error
    return await client.session.get({ path: { sessionID } })
  }
}

export async function tryFetchSessionInfo(client: any, sessionID: string): Promise<any | undefined> {
  if (!client?.session?.get) return undefined

  try {
    return await fetchSessionInfo(client, sessionID)
  } catch {
    return undefined
  }
}

export async function fetchSessionChildren(client: any, sessionID: string): Promise<any> {
  try {
    return await client.session.children({ path: { id: sessionID } })
  } catch (error) {
    if (!client?.session?.children) throw error
    return await client.session.children({ path: { sessionID } })
  }
}

export function unwrapResponseData<T>(response: any): T {
  return ((response as any)?.data ?? response) as T
}
