/* Manila calendar dates, wall-clock time and shift boundaries. */
const KalinTime = (() => {
  const zone = 'Asia/Manila';
  const wallClock = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    timeZoneName: 'longOffset'
  });
  let skew = 0;
  let clockSync;

  function now() {
    return new Date(Date.now() + skew);
  }

  function syncClock(client) {
    clockSync ??= (async () => {
      try {
        const { data, error } = await client.rpc('manila_now');
        if (error || typeof data !== 'string') return;
        // The RPC returns a Manila wall time without a timezone suffix.
        const instant = manilaWallInstant(data.replace(' ', 'T'));
        if (!Number.isFinite(+instant)) return;
        skew = +instant - Date.now();
      } catch {
        return;
      }
      if (skew) document.dispatchEvent(new Event('kalin:clock'));
    })();
    return clockSync;
  }

  function manilaNow(instant = now()) {
    const parts = Object.fromEntries(wallClock.formatToParts(instant).map(({ type, value }) => [type, value]));
    return {
      date: parts.year.padStart(4, '0') + '-' + parts.month + '-' + parts.day,
      time: parts.hour + ':' + parts.minute + ':' + parts.second,
      minutes: Number(parts.hour) * 60 + Number(parts.minute)
    };
  }

  function manilaToday(instant) {
    return manilaNow(instant).date;
  }

  // UTC serves as a neutral calendar for date-only arithmetic.
  function addDays(date, days) {
    const day = new Date(date + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() + days);
    return day.toISOString().slice(0, 10);
  }

  function manilaWallInstant(local) {
    const utc = new Date(local + 'Z');
    if (!Number.isFinite(+utc)) return utc;
    const { value } = wallClock.formatToParts(utc).find(part => part.type === 'timeZoneName');
    return new Date(local + value.slice(3));
  }

  function manilaInstant(date, hour) {
    return manilaWallInstant(date + 'T' + String(hour).padStart(2, '0') + ':00:00');
  }

  function manilaMidnightRange(instant) {
    const date = manilaToday(instant);
    return { date, start: manilaInstant(date, 0), end: manilaInstant(addDays(date, 1), 0) };
  }

  // Shifts carry Manila wall-clock times ('07:00' or '07:00:00') and end on the day they start.
  const clock = time => time.length === 5 ? time + ':00' : time.slice(0, 8);

  function shiftStart(shift) {
    return manilaWallInstant(shift.shift_date + 'T' + clock(shift.starts_at));
  }

  // A shift whose end time isn't later than its start time runs past midnight and ends the next day.
  function spansMidnight(shift) {
    return clock(shift.ends_at) <= clock(shift.starts_at);
  }

  function shiftEnd(shift) {
    const date = spansMidnight(shift) ? addDays(shift.shift_date, 1) : shift.shift_date;
    return manilaWallInstant(date + 'T' + clock(shift.ends_at));
  }

  function hasStarted(shift, instant = now()) {
    return +instant >= +shiftStart(shift);
  }

  function isOnDuty(shift, instant = now()) {
    return +instant >= +shiftStart(shift) && +instant < +shiftEnd(shift);
  }

  function formatClock(time) { // '15:30:00' -> '3:30 PM'
    const [hours, minutes] = time.split(':').map(Number);
    return (hours % 12 || 12) + ':' + String(minutes).padStart(2, '0') + ' ' + (hours >= 12 ? 'PM' : 'AM');
  }

  function shiftRange(shift) {
    return formatClock(shift.starts_at) + ' – ' + formatClock(shift.ends_at) + (spansMidnight(shift) ? ' (next day)' : '');
  }

  function shiftPeriod(shift) {
    if (shift.ends_at && spansMidnight(shift)) return 'Night';
    const hours = Number(shift.starts_at.slice(0, 2));
    return hours < 12 ? 'Morning' : hours < 15 ? 'Afternoon' : hours < 21 ? 'Evening' : 'Night';
  }

  function onMinute(callback, { visibleOnly = false } = {}) {
    let timer;
    function schedule() {
      if (visibleOnly && document.hidden) return;
      timer = setTimeout(() => {
        if (visibleOnly && document.hidden) return;
        schedule();
        callback();
      }, 60000 - (+now() % 60000 + 60000) % 60000);
    }
    function restart() {
      clearTimeout(timer);
      if (visibleOnly && document.hidden) return;
      schedule();
      callback();
    }
    document.addEventListener('kalin:clock', restart);
    if (visibleOnly) document.addEventListener('visibilitychange', restart);
    schedule();
  }

  return {
    zone, now, syncClock, manilaNow, manilaToday, manilaMidnightRange, addDays,
    shiftStart, shiftEnd, spansMidnight, hasStarted, isOnDuty, formatClock, shiftRange, shiftPeriod, onMinute
  };
})();
