/** Registered secret values are replaced even when embedded in otherwise public text. */
export class Redactor {
  private readonly secrets = new Set<string>();
  add(value: string | undefined): void {
    if (value) this.secrets.add(value);
  }
  text(value: string): string {
    let result = value;
    for (const secret of this.secrets) {
      result = result.split(secret).join('[REDACTED]');
      result = result.split(encodeURIComponent(secret)).join('[REDACTED]');
    }
    return result
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
      .replace(
        /([?&](?:key|api_key|access_token|token|secret|password)=)[^&#\s]*/gi,
        '$1[REDACTED]',
      )
      .replace(/\b(Bearer\s+)[\w.\-~+/=]+/gi, '$1[REDACTED]');
  }
  value<T>(value: T): T {
    const visit = (item: unknown): unknown => {
      if (typeof item === 'string') return this.text(item);
      if (Array.isArray(item)) return item.map(visit);
      if (item && typeof item === 'object')
        return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, visit(entry)]));
      return item;
    };
    return visit(value) as T;
  }
}
