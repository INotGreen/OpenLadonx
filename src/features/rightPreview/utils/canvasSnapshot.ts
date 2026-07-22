import { createTLStore, type TLStoreSnapshot, type TLRecord, type SerializedSchema } from 'tldraw'

export type CanvasSnapshot = {
  store: Record<string, TLRecord>
  schema: SerializedSchema
}

export type SkippedRecord = {
  id: string
  typeName: string
  type: string | null
  reason: string
}

export function isCanvasSnapshot(value: unknown): value is CanvasSnapshot {
  return (
    value !== null &&
    typeof value === 'object' &&
    'store' in value &&
    'schema' in value &&
    typeof (value as CanvasSnapshot).store === 'object' &&
    typeof (value as CanvasSnapshot).schema === 'object'
  )
}

export function firstErrorLine(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error).split('\n')[0]
}

export function describeSkippedRecord(record: TLRecord | unknown, reason: unknown): SkippedRecord {
  const rec = record as TLRecord
  return {
    id: typeof rec?.id === 'string' ? rec.id : '(missing id)',
    typeName: typeof rec?.typeName === 'string' ? rec.typeName : '(missing typeName)',
    type: 'type' in rec && typeof rec.type === 'string' ? rec.type : null,
    reason: firstErrorLine(reason)
  }
}

function getRecordDependencies(record: TLRecord): string[] {
  const dependencies: string[] = []
  if (record?.typeName === 'shape') {
    const shape = record as TLRecord & { parentId?: string; type?: string; props?: { assetId?: string } }
    if (typeof shape.parentId === 'string') dependencies.push(shape.parentId)
    if (shape.type === 'image' && typeof shape.props?.assetId === 'string') {
      dependencies.push(shape.props.assetId)
    }
  }
  if (record?.typeName === 'binding') {
    const binding = record as TLRecord & { fromId?: string; toId?: string; props?: { fromId?: string; toId?: string } }
    const fromId = binding.fromId ?? binding.props?.fromId
    const toId = binding.toId ?? binding.props?.toId
    if (typeof fromId === 'string') dependencies.push(fromId)
    if (typeof toId === 'string') dependencies.push(toId)
  }
  return dependencies
}

function pruneRecordsWithMissingDependencies(
  store: Record<string, TLRecord>,
  skippedRecords: SkippedRecord[]
): Record<string, TLRecord> {
  const prunedStore = { ...store }
  let changed = true

  while (changed) {
    changed = false
    for (const record of Object.values(prunedStore)) {
      const missingDependency = getRecordDependencies(record).find((id) => !prunedStore[id])
      if (!missingDependency) continue

      delete prunedStore[record.id]
      skippedRecords.push(
        describeSkippedRecord(record, `Missing dependent record: ${missingDependency}`)
      )
      changed = true
    }
  }

  return prunedStore
}

export function sanitizeCanvasSnapshotForTldraw(snapshot: unknown): {
  snapshot: CanvasSnapshot | null
  skippedRecords: SkippedRecord[]
} {
  if (!isCanvasSnapshot(snapshot)) {
    return { snapshot: null, skippedRecords: [] }
  }

  const validationStore = createTLStore()
  const skippedRecords: SkippedRecord[] = []
  let migratedSnapshot: TLStoreSnapshot

  try {
    migratedSnapshot = validationStore.migrateSnapshot(snapshot)
  } catch (error) {
    return {
      snapshot: null,
      skippedRecords: [
        {
          id: '(snapshot)',
          typeName: 'snapshot',
          type: null,
          reason: firstErrorLine(error)
        }
      ]
    }
  }

  const validStore: Record<string, TLRecord> = {}
  for (const record of Object.values(migratedSnapshot.store)) {
    try {
      validationStore.put([record], 'initialize')
      validStore[record.id] = validationStore.get(record.id)!
    } catch (error) {
      skippedRecords.push(describeSkippedRecord(record, error))
    }
  }

  return {
    snapshot: {
      schema: migratedSnapshot.schema,
      store: pruneRecordsWithMissingDependencies(validStore, skippedRecords)
    },
    skippedRecords
  }
}
