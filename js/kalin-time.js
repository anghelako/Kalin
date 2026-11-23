/* Manila calendar dates, wall-clock time and shift boundaries. */
const KalinTime = (() => {
  const zone = 'Asia/Manila';
  const wallClock = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    timeZoneName: 'longOffset'
  });
  const slots = {
    morning: { from: 7, to: 15 },
    evening: { from: 15, to: 22 }
  };

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

  function currentSlot(instant) {
    const { minutes } = manilaNow(instant);
    return Object.keys(slots).find(key => minutes >= slots[key].from * 60 && minutes < slots[key].to * 60) || null;
  }

  function shiftStart(shift) {
    return manilaInstant(shift.shift_date, slots[shift.slot].from);
  }

  function shiftEnd(shift) {
    return manilaInstant(shift.shift_date, slots[shift.slot].to);
  }

  function hasStarted(shift, instant = now()) {
    return +instant >= +shiftStart(shift);
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
    zone, slots, now, syncClock, manilaNow, manilaToday, manilaMidnightRange, addDays,
    currentSlot, shiftStart, shiftEnd, hasStarted, onMinute
  };
})();
