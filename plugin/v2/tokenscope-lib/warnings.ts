// Warning collection helpers for non-fatal analysis issues

export class WarningCollector {
  private readonly warnings: string[] = []
  private readonly seen = new Set<string>()

  add(message: string, key?: string): void {
    const dedupeKey = key ?? message
    if (this.seen.has(dedupeKey)) {
      return
    }

    this.seen.add(dedupeKey)
    this.warnings.push(message)
  }

  list(): string[] {
    return [...this.warnings]
  }
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
