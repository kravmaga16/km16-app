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

export function courseCalendarFile(course) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KM16//Réservations de cours//FR',
    'BEGIN:VEVENT',
    'UID:' + escape(course.id) + '@app.km16.fr',
    'DTSTAMP:' + stamp(Date.now()),
    'DTSTART:' + stamp(parisTimestamp(course.session_date, course.start_time)),
    'DTEND:' + stamp(parisTimestamp(course.session_date, course.end_time)),
    'SUMMARY:' + escape('Cours KM16 · ' + course.category),
    'LOCATION:' + escape(course.venue),
    'URL:https://app.km16.fr/course-operations.html',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}

export function downloadCourseCalendar(course) {
  const file = new Blob([courseCalendarFile(course)], {type: 'text/calendar;charset=utf-8'});
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'KM16-cours-' + course.session_date + '.ics';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
