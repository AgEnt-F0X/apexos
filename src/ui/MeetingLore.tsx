/* ============================================================
   MeetingLore — the FIRST circuitMeta consumer.

   Circuit lore (length · turns · lap record) rendered exactly
   where you pick a race: the hero card and the archive rows.

   Enrichment law: fails soft (null meta renders nothing), and
   the source self-declares in the title attribute — X-ray can
   always answer where a number came from.
   ============================================================ */

import { useEffect, useState } from 'react'
import { circuitMeta, type CircuitMeta } from '../data/circuitMeta'

export function MeetingLore({ shortName }: { shortName: string }) {
  const [meta, setMeta] = useState<CircuitMeta | null>(null)

  useEffect(() => {
    let stale = false
    void circuitMeta(shortName).then((m) => {
      if (!stale) setMeta(m)
    })
    return () => {
      stale = true
    }
  }, [shortName])

  if (!meta) return null
  const bits: string[] = []
  if (meta.circuitLengthKm !== null) bits.push(`${meta.circuitLengthKm.toFixed(3)} KM`)
  if (meta.corners !== null) bits.push(`${meta.corners} TURNS`)
  if (meta.lapRecord !== null)
    bits.push(`LAP RECORD ${meta.lapRecord}${meta.lapRecordHolder ? ` · ${meta.lapRecordHolder.toUpperCase()}` : ''}`)
  if (bits.length === 0) return null

  return (
    <span className="meeting__lore label" title={`circuit lore · f1api.dev · ${meta.circuitName}`}>
      {bits.join(' · ')}
    </span>
  )
}
