import { object, type JsonObject, type JsonValue } from './types'

export function lookupReference(document: JsonObject, ref: string): JsonValue | undefined {
  if (!ref.startsWith('#/')) return undefined
  try {
    return decodeURIComponent(ref.slice(2)).split('/').reduce<JsonValue | undefined>((value, token) => {
      const key = token.replace(/~1/g, '/').replace(/~0/g, '~')
      return value !== null && typeof value === 'object' && Object.hasOwn(value, key)
        ? (value as JsonObject)[key] : undefined
    }, document)
  }
  catch { return undefined }
}

/** Resolve parameter/path-item references without expanding their nested schemas. */
export function resolveObject(document: JsonObject, value: JsonValue | undefined, seen = new Set<string>()): JsonObject {
  const result = object(value)
  if (typeof result.$ref !== 'string') return result
  if (seen.has(result.$ref)) return result
  const target = lookupReference(document, result.$ref)
  if (target === undefined) return result
  const { $ref, ...siblings } = result
  return { ...resolveObject(document, target, new Set([...seen, $ref])), ...siblings }
}

export function expandReferences(document: JsonObject, value: JsonValue, maxDepth: number) {
  const warnings = new Set<string>()
  let remaining = 12_000
  function visit(current: JsonValue, refs: Set<string>, refDepth: number, treeDepth: number): JsonValue {
    if (current === null || typeof current !== 'object') return current
    if (--remaining < 0 || treeDepth > 80) {
      warnings.add('Expansion limit reached; some structures are truncated')
      return { 'x-worma-truncated': true }
    }
    if (Array.isArray(current)) return current.map(item => visit(item, refs, refDepth, treeDepth + 1))
    if (typeof current.$ref === 'string') {
      const ref = current.$ref
      const target = lookupReference(document, ref)
      const reason = !ref.startsWith('#/') ? 'external reference not loaded'
        : target === undefined ? 'reference not found'
          : refs.has(ref) ? 'circular reference'
            : refDepth >= maxDepth ? 'maximum reference depth reached' : undefined
      if (reason) {
        warnings.add(`${ref}: ${reason}`)
        return { ...current, 'x-worma-ref-status': reason }
      }
      const { $ref, ...siblings } = current
      const expanded = visit(target!, new Set([...refs, ref]), refDepth + 1, treeDepth + 1)
      if (!Object.keys(siblings).length) return expanded
      const expandedSiblings = visit(siblings, refs, refDepth, treeDepth + 1)
      if (!ref.startsWith('#/components/schemas/') && !ref.startsWith('#/definitions/')) {
        return { ...object(expanded), ...object(expandedSiblings) }
      }
      // Preserve both constraints when a Schema Object has $ref siblings.
      return { allOf: [expanded, expandedSiblings] }
    }
    return Object.fromEntries(Object.entries(current).map(([key, item]) =>
      [key, visit(item, refs, refDepth, treeDepth + 1)]))
  }
  return { value: visit(value, new Set(), 0, 0), warnings: [...warnings] }
}
