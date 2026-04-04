// OpenCode SDK compatibility helpers

export async function fetchSessionMessages(client: any, sessionID: string): Promise<any> {
  try {
    return await client.session.messages({ path: { id: sessionID } })
  } catch (error) {
    if (!client?.session?.messages) throw error
    return await client.session.messages({ path: { sessionID } })
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
