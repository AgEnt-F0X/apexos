/* ============================================================
   SeasonStandings — the FIRST jolpica consumer.

   Season-scoped championship tables beside the archive: pick a
   year, see where that season ended up. Fails soft by law —
   enrichment may never block the core archive; a dead jolpica
   renders a quiet notice, never an error surface.

   Source self-declares in the section head (X-ray lineage).
   ============================================================ */

import { useEffect, useState } from 'react'
import {
  constructorStandings,
  driverStandings,
  type JolpicaConstructorStanding,
  type JolpicaDriverStanding,
} from '../data/jolpica'

export function SeasonStandings({ year }: { year: number }) {
  const [drivers, setDrivers] = useState<JolpicaDriverStanding[] | null>(null)
  const [constructors, setConstructors] = useState<JolpicaConstructorStanding[] | null>(null)

  useEffect(() => {
    let stale = false
    setDrivers(null)
    setConstructors(null)
    void driverStandings(year).then((d) => {
      if (!stale) setDrivers(d)
    })
    void constructorStandings(year).then((c) => {
      if (!stale) setConstructors(c)
    })
    return () => {
      stale = true
    }
  }, [year])

  // still resolving (or enrichment fully offline): render nothing at all
  if (drivers === null && constructors === null) return null
  if ((drivers?.length ?? 0) === 0 && (constructors?.length ?? 0) === 0) {
    return (
      <div className="standings standings--empty label">
        {year} CHAMPIONSHIP TABLE UNAVAILABLE — ENRICHMENT OFFLINE · CORE ARCHIVE UNAFFECTED
      </div>
    )
  }

  return (
    <section className="standings">
      <div className="standings__head">
        <span className="label label--hi">{year} CHAMPIONSHIP</span>
        <span className="standings__src mono" title="enrichment source: jolpica-ergast · fails soft">
          TABLE · JOLPICA-ERGAST
        </span>
      </div>
      <div className="standings__cols">
        <table className="standings__table mono">
          <thead>
            <tr>
              <th>DRIVERS</th>
              <th>CAR</th>
              <th>PTS</th>
              <th>W</th>
            </tr>
          </thead>
          <tbody>
            {(drivers ?? []).slice(0, 10).map((d) => (
              <tr key={d.Driver.driverId}>
                <td>
                  <i className="standings__pos">{d.positionText}</i>
                  {d.Driver.familyName.toUpperCase()}
                </td>
                <td className="standings__team">{d.Constructors[0]?.name.toUpperCase() ?? '—'}</td>
                <td>{d.points}</td>
                <td>{d.wins}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="standings__table mono">
          <thead>
            <tr>
              <th>CONSTRUCTORS</th>
              <th>PTS</th>
              <th>W</th>
            </tr>
          </thead>
          <tbody>
            {(constructors ?? []).slice(0, 5).map((c) => (
              <tr key={c.Constructor.constructorId}>
                <td>
                  <i className="standings__pos">{c.positionText}</i>
                  {c.Constructor.name.toUpperCase()}
                </td>
                <td>{c.points}</td>
                <td>{c.wins}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
