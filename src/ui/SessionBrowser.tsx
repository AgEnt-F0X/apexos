/* ============================================================
   The archive — pick any session from 2023 → today.
   Fully on-demand: everything streams from the OpenF1 API and
   is cached locally after first load.
   ============================================================ */

import { useEffect, useState } from 'react'
import { listCachedSessions } from '../data/cache'
import { fetchRows, readTableCache, writeTableCache } from '../data/openf1'
import type { MeetingRow, SessionMetaRow } from '../data/types'
import { useAppStore } from '../state/appStore'
import { MeetingLore } from './MeetingLore'
import { SeasonStandings } from './SeasonStandings'

const CURRENT_YEAR = new Date().getFullYear()
/** past seasons never change; the current one refreshes every few hours */
const ttlFor = (year: number) => (year < CURRENT_YEAR ? 30 * 864e5 : 6 * 36e5)
/** "latest race" changes every GP weekend — short TTL keeps it honest */
const LATEST_TTL_MS = 3 * 36e5
const RETRY_S = 6

/** the signature replay: a genuinely great showcase race, kept as a
    hand-picked companion to whatever the live "latest race" hero is —
    never the app's default door, so the archive never reads as stale */
export const SIGNATURE = {
  sessionKey: 9636,
  title: 'SÃO PAULO GP · RACE · 2024',
}

const FIRST_SEASON = 2023
const YEARS = Array.from({ length: CURRENT_YEAR - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i).reverse()

interface LatestRace {
  sessionKey: number
  title: string
  location: string
  year: number
  circuit: string
}

/** the most recent Race session whose green flag has already happened,
    searched current season first, then last, so the hero is never stale
    even in the dead of winter before round one */
async function fetchLatestRace(): Promise<LatestRace | null> {
  const nowIso = new Date().toISOString()
  for (const year of [CURRENT_YEAR, CURRENT_YEAR - 1]) {
    try {
      const rows = await fetchRows<SessionMetaRow>('sessions', {
        year,
        session_name: 'Race',
        'date_start<=': nowIso,
      })
      if (rows.length === 0) continue
      rows.sort((a, b) => b.date_start.localeCompare(a.date_start))
      const r = rows[0]
      return {
        sessionKey: r.session_key,
        title: `${r.location.toUpperCase()} GP · RACE · ${r.year}`,
        location: r.location,
        year: r.year,
        circuit: r.circuit_short_name,
      }
    } catch {
      // try the fallback year
    }
  }
  return null
}

const SESSION_SHORT: Record<string, string> = {
  'Practice 1': 'FP1',
  'Practice 2': 'FP2',
  'Practice 3': 'FP3',
  'Sprint Qualifying': 'SQ',
  'Sprint Shootout': 'SQ',
  Sprint: 'SPRINT',
  Qualifying: 'QUALI',
  Race: 'RACE',
}

export function SessionBrowser() {
  const loadSession = useAppStore((s) => s.loadSession)
  const [year, setYear] = useState(CURRENT_YEAR)
  const [meetings, setMeetings] = useState<MeetingRow[] | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [sessions, setSessions] = useState<Record<number, SessionMetaRow[]>>({})
  const [cached, setCached] = useState<Set<number>>(new Set())
  const [meetingsError, setMeetingsError] = useState(false)
  const [retryIn, setRetryIn] = useState(0)
  const [retryNonce, setRetryNonce] = useState(0)
  const [latest, setLatest] = useState<LatestRace | null>(null)
  const [latestFailed, setLatestFailed] = useState(false)

  useEffect(() => {
    void listCachedSessions().then((list) => setCached(new Set(list.map((c) => c.sessionKey))))
  }, [])

  // the featured card: whatever the latest completed Grand Prix actually is,
  // never a fixed year baked into the code. Cached so a repeat visit within
  // a few hours doesn't re-hit the API for something that can't have changed.
  useEffect(() => {
    let stale = false
    const cachedLatest = readTableCache<LatestRace>('latestRace', LATEST_TTL_MS)
    if (cachedLatest?.rows[0]) setLatest(cachedLatest.rows[0])
    if (cachedLatest?.fresh) return
    fetchLatestRace()
      .then((r) => {
        if (stale) return
        if (r) {
          setLatest(r)
          writeTableCache('latestRace', [r])
        } else if (!cachedLatest) {
          setLatestFailed(true)
        }
      })
      .catch(() => {
        if (!stale && !cachedLatest) setLatestFailed(true)
      })
    return () => {
      stale = true
    }
  }, [])

  // meetings: stale-while-revalidate — the archive renders instantly from
  // localStorage and quietly refreshes; a busy API can only delay freshness
  useEffect(() => {
    let stale = false
    setMeetingsError(false)
    setExpanded(null)
    const cachedList = readTableCache<MeetingRow>(`meetings:${year}`, ttlFor(year))
    setMeetings(cachedList ? cachedList.rows : null)
    if (cachedList?.fresh) return
    fetchRows<MeetingRow>('meetings', { year })
      .then((rows) => {
        if (stale) return
        setMeetings(rows)
        writeTableCache(`meetings:${year}`, rows)
      })
      .catch(() => {
        if (!stale && !cachedList) setMeetingsError(true)
      })
    return () => {
      stale = true
    }
  }, [year, retryNonce])

  // busy API: honest auto-retry with a visible countdown
  useEffect(() => {
    if (!meetingsError) return
    setRetryIn(RETRY_S)
    const id = setInterval(() => {
      setRetryIn((s) => {
        if (s <= 1) {
          clearInterval(id)
          setRetryNonce((x) => x + 1)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [meetingsError, retryNonce])

  const toggleMeeting = (key: number) => {
    const next = expanded === key ? null : key
    setExpanded(next)
    if (next === null) return
    const have = sessions[next]
    if (have && have.length > 0) return
    const cachedRows = readTableCache<SessionMetaRow>(`sessions:${next}`, ttlFor(year))
    if (cachedRows) setSessions((s) => ({ ...s, [next]: cachedRows.rows }))
    if (cachedRows?.fresh) return
    void fetchRows<SessionMetaRow>('sessions', { meeting_key: next })
      .then((rows) => {
        setSessions((s) => ({ ...s, [next]: rows }))
        writeTableCache(`sessions:${next}`, rows)
      })
      .catch(() => {
        if (!cachedRows) setSessions((s) => ({ ...s, [next]: s[next] ?? [] }))
      })
  }

  return (
    <div className="browser">
      <section className="browser__intro">
        <div className="browser__brand">
          APEX<span className="browser__brandSlash">//</span>OS
        </div>
        <p className="browser__tag label--hi label">F1 SPATIAL RACE INTELLIGENCE — CONCEPT 001</p>
        <p className="browser__lede">
          Every F1 session since 2023 broadcast ~500,000 rows of raw telemetry.
          This machine replays them as a directed spatial broadcast — the race,
          as the pit wall sees it.
        </p>

        <div className="hero ticked">
          <span className="hero__eyebrow label">
            {latest ? `LATEST RACE${cached.has(latest.sessionKey) ? ' · ARCHIVED LOCALLY' : ''}` : 'FINDING THE LATEST RACE…'}
          </span>
          <span className="hero__title">
            {latest ? `${latest.location.toUpperCase()} ${latest.year}` : '—'}
          </span>
          <span className="hero__sub mono">
            {latest ? 'THE MOST RECENT GRAND PRIX ON RECORD' : latestFailed ? 'ARCHIVE UNREACHABLE — TRY THE SIGNATURE REPLAY BELOW' : 'QUERYING OPENF1…'}
          </span>
          <div className="hero__lore">
            {latest && <MeetingLore shortName={latest.circuit} />}
          </div>
          <div className="hero__actions">
            <button className="hero__cta mono" disabled={!latest} onClick={() => latest && loadSession(latest)}>
              ENTER THEATRE ↗
            </button>
            <button
              className="hero__cta hero__cta--live mono"
              disabled={!latest}
              onClick={() => latest && loadSession({ ...latest, join: true })}
              title="watch as if live: the future stays hidden — no spoilers, no scrubbing ahead"
            >
              ⦿ JOIN AS LIVE
            </button>
          </div>
        </div>

        <button className="browser__signature mono" onClick={() => loadSession(SIGNATURE)}>
          OR RELIVE THE SIGNATURE REPLAY — SÃO PAULO 2024
          <span className="browser__signatureSub">RAIN · SAFETY CARS · RED FLAGS · VERSTAPPEN P17 → P1</span>
        </button>

        <p className="browser__note label">
          FIRST LOAD STREAMS LIVE FROM THE OPENF1 ARCHIVE (~1–2 MIN) · CACHED AFTER ·
          JOIN-AS-LIVE HIDES THE FUTURE ENTIRELY
        </p>
      </section>

      <section className="browser__archive">
        <div className="browser__archiveHead">
          <span className="label label--hi">SESSION ARCHIVE</span>
          <div className="browser__years" role="tablist">
            {YEARS.map((y) => (
              <button
                key={y}
                role="tab"
                aria-selected={year === y}
                className={`browser__year mono ${year === y ? 'is-active' : ''}`}
                onClick={() => setYear(y)}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        <SeasonStandings year={year} />

        <div className="browser__meetings">
          {meetings === null && !meetingsError && <div className="browser__loading mono">QUERYING ARCHIVE…</div>}
          {meetingsError && (
            <div className="browser__loading mono">
              ARCHIVE BUSY{retryIn > 0 ? ` — RETRYING IN ${retryIn}s` : ' — RETRYING…'}
              <button className="browser__retry mono" onClick={() => setRetryNonce((x) => x + 1)}>
                RETRY NOW
              </button>
            </div>
          )}
          {meetings?.length === 0 && <div className="browser__loading mono">NO MEETINGS ON RECORD FOR {year}</div>}
          {meetings?.map((m, i) => (
            <div key={m.meeting_key} className={`meeting ${expanded === m.meeting_key ? 'is-open' : ''}`}>
              <button className="meeting__row" onClick={() => toggleMeeting(m.meeting_key)}>
                <span className="meeting__round mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="meeting__name">{m.meeting_name.toUpperCase()}</span>
                <span className="meeting__loc label">{m.location.toUpperCase()} · {m.country_name.toUpperCase()}</span>
                <span className="meeting__chev mono">{expanded === m.meeting_key ? '−' : '+'}</span>
              </button>
              {expanded === m.meeting_key && (
                <div className="meeting__detail">
                  <MeetingLore shortName={m.circuit_short_name} />
                  <div className="meeting__sessions">
                  {!sessions[m.meeting_key] && <span className="mono meeting__wait">…</span>}
                  {sessions[m.meeting_key]?.length === 0 && (
                    <span className="mono meeting__wait">API BUSY — CLICK THE MEETING TO RETRY</span>
                  )}
                  {sessions[m.meeting_key]?.map((s) => (
                    <button
                      key={s.session_key}
                      className="chip mono"
                      onClick={() =>
                        loadSession({
                          sessionKey: s.session_key,
                          title: `${m.meeting_name.toUpperCase()} · ${(SESSION_SHORT[s.session_name] || s.session_name).toUpperCase()} · ${s.year}`,
                        })
                      }
                    >
                      {SESSION_SHORT[s.session_name] || s.session_name}
                      {cached.has(s.session_key) && <i className="chip__dot" title="cached locally" />}
                    </button>
                  ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <footer className="browser__foot label">
        <span>DATA · OPENF1.ORG COMMUNITY API — UNOFFICIAL CONCEPT · NOT ASSOCIATED WITH FORMULA 1</span>
        <button className="browser__about mono" onClick={() => useAppStore.getState().setAbout(true)}>
          ABOUT THIS CONCEPT ↗
        </button>
      </footer>
    </div>
  )
}
