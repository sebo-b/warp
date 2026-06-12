/** Minimal iCal parser — handles the subset produced by warp. */

export interface ICalEvent {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
  description?: string;
  url?: string;
}

/** Unfold iCal line continuations (RFC 5545 §3.1). */
function unfold(text: string): string {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

export function parseIcal(ical: string): ICalEvent[] {
  const events: ICalEvent[] = [];
  const lines = unfold(ical).split(/\r?\n/);

  let inside = false;
  let cur: Partial<ICalEvent> = {};

  for (const raw of lines) {
    if (raw === 'BEGIN:VEVENT') {
      inside = true;
      cur = {};
    } else if (raw === 'END:VEVENT') {
      inside = false;
      if (cur.uid && cur.summary) events.push(cur as ICalEvent);
    } else if (inside) {
      const sep = raw.indexOf(':');
      if (sep < 0) continue;
      // Params like DTSTART;TZID=Europe/Berlin:... — strip param part
      const propName = raw.substring(0, sep).split(';')[0].toLowerCase();
      const value = raw.substring(sep + 1);
      switch (propName) {
        case 'uid':         cur.uid         = value; break;
        case 'summary':     cur.summary     = value; break;
        case 'dtstart':     cur.dtstart     = value; break;
        case 'dtend':       cur.dtend       = value; break;
        case 'description': cur.description = value; break;
        case 'url':         cur.url         = value; break;
      }
    }
  }
  return events;
}

/** Return only VEVENT entries whose UID starts with the given prefix. */
export function filterByUidPrefix(events: ICalEvent[], prefix: string): ICalEvent[] {
  return events.filter(e => e.uid.startsWith(prefix));
}
