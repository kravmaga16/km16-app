import { courseCategoryLabel } from './course-category-label.mjs?v=ages-5-8';
const parisOffset = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Paris', timeZoneName: 'longOffset',
});

function parisTimestamp(date, time) {
  const wall = Date.parse(date + 'T' + time.slice(0, 5) + ':00Z');
  function offsetAt(timestamp) {
    const label = parisOffset.formatToParts(timestamp).find(part => part.type === 'timeZoneName').value;
    const [, sign, hours, minutes] = /^GMT([+-])(\d{2}):(\d{2})$/.exec(label);
    return (sign === '+' ? 1 : -1) * (Number(hours) * 60 + Number(minutes)) * 60000;
  }
  return wall - offsetAt(wall - offsetAt(wall));
}

const stamp = timestamp => new Date(timestamp).toISOString().replace(/[-:]|\.\d{3}/g, '');
const escape = value => String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
  .replace(/[,;]/g, character => '\\' + character);

function fold(line) {
  const encoder = new TextEncoder();
  let result = '', width = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (width + size > 75) {
      result += '\r\n ';
      width = 1;
    }
    result += character;
    width += size;
  }
  return result;
}

function calendarFile({id, date, start, end, title, venue, details}) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KM16//Agenda KM16//FR',
    'BEGIN:VEVENT',
    'UID:' + escape(id) + '@app.km16.fr',
    'DTSTAMP:' + stamp(Date.now()),
    'DTSTART:' + stamp(parisTimestamp(date, start)),
    'DTEND:' + stamp(parisTimestamp(date, end)),
    'SUMMARY:' + escape(title),
    'LOCATION:' + escape(venue || ''),
    'URL:' + details,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}

export function courseCalendarFile(course) {
  return calendarFile({
    id: course.id, date: course.session_date, start: course.start_time, end: course.end_time,
    title: 'Cours KM16 · ' + courseCategoryLabel(course.category), venue: course.venue,
    details: 'https://app.km16.fr/course-operations.html',
  });
}

export function stageCalendarFile(stage, order) {
  const [slot, venue] = String(stage.note || '').split('·').map(part => part.trim());
  const hours = /^(\d{1,2})\s*h\s*([0-5]\d)?\s*[-–—]\s*(\d{1,2})\s*h\s*([0-5]\d)?$/i.exec(slot);
  if (!hours) return null;
  const [, from, fromMinute = '00', to, toMinute = '00'] = hours;
  const start = from.padStart(2, '0') + ':' + fromMinute;
  const end = to.padStart(2, '0') + ':' + toMinute;
  if (Number(from) > 23 || Number(to) > 23 || end <= start) return null;
  return calendarFile({
    id: 'stage-' + order.id, date: stage.event_date, start, end, title: 'KM16 · ' + order.title,
    venue, details: 'https://app.km16.fr/adhesion.html?espace=1',
  });
}

export function downloadCalendar(contents, filename) {
  const file = new Blob([contents], {type: 'text/calendar;charset=utf-8'});
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function downloadCourseCalendar(course) {
  downloadCalendar(courseCalendarFile(course), 'KM16-cours-' + course.session_date + '.ics');
}
