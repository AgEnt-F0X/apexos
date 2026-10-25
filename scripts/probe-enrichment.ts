/* ============================================================
   LIVE probe for the enrichment lane — jolpica-ergast +
   f1api.dev, exactly as the UI consumes them.

   Confirms the first consumers' data paths end-to-end:
   · season standings (drivers + constructors) for last season
   · season calendar round list
   · circuit lore for a slug-exact, an aliased, and a fuzzy case

   Politeness: jolpica client self-paces (one lane, 400 ms).
   usage: npx tsx scripts/probe-enrichment.ts
   ============================================================ */

import { constructorStandings, driverStandings, seasonCalendar } from '../src/data/jolpica'
import { circuitMeta } from '../src/data/circuitMeta'

const LAST = new Date().getFullYear() - 1
let failures = 0
const check = (ok: boolean, msg: string): void => {
  if (ok) console.log(`  ✓ ${msg}`)
  else {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}

console.log('probing enrichment lane…\n')

const drv = await driverStandings(LAST)
check(drv.length >= 10, `driver standings ${LAST}: ${drv.length} rows · leader ${drv[0]?.Driver.familyName.toUpperCase()} ${drv[0]?.points}PTS / ${drv[0]?.wins}W`)
check(drv.every((d) => d.Constructors.length > 0), 'every driver row carries a constructor')

const con = await constructorStandings(LAST)
check(con.length >= 5, `constructor standings: ${con.length} rows · leader ${con[0]?.Constructor.name.toUpperCase()} ${con[0]?.points}PTS`)

const cal = await seasonCalendar(LAST)
check(cal.length >= 14, `calendar ${LAST}: ${cal.length} rounds · r1 ${cal[0]?.raceName} @ ${cal[0]?.Circuit.circuitName}`)
check(cal.every((r) => r.Circuit.circuitId.length > 0), 'every round carries a circuit ref')

for (const name of ['Monza', 'Las Vegas', 'São Paulo']) {
  const m = await circuitMeta(name)
  check(
    m !== null && m.circuitLengthKm !== null && m.corners !== null && m.lapRecord !== null,
    `lore "${name}": ${m ? `${m.circuitName} · ${m.circuitLengthKm}km · ${m.corners}T · record ${m.lapRecord} (${m.lapRecordHolder ?? '?'})` : 'null (soft-fail)'}`,
  )
}

console.log(failures === 0 ? '\nALL ENRICHMENT CHECKS PASS' : `\n${failures} ENRICHMENT FAILURE(S)`)
process.exitCode = failures === 0 ? 0 : 1
