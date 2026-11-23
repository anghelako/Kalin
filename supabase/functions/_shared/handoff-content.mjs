// Shared by the browser preview and the Edge Function's confirmation check.
export const MAX_NOTES = 20;
export const MAX_NOTE_CHARACTERS = 300;
export const MAX_HANDOFF_BODY_BYTES = 16 * 1024;

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
});
const emailPattern = /[\p{L}\p{N}._%+!#$&'*\/=?^{}|~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu;
const phonePattern = /(?<![\p{L}\p{N}])\+?(?:\(\p{Nd}{2,4}\)|\p{Nd})[\p{Nd}\p{Pd}(). \t]{5,}\p{Nd}(?![\p{L}\p{N}])/gu;
const timeStampPattern = /(\b\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/gi;

export function firstCharacters(value, limit) {
  return Array.from(value).slice(0, limit).join('');
}

function dateOnly(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return [parts.year, parts.month, parts.day].join('-');
}

export function minimizeNotes(rows, names) {
  const escapedNames = [...new Set(names.filter(value => typeof value === 'string')
    .map(name => name.normalize('NFKC').replace(/\p{Cf}/gu, '').trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&'));
  const namePattern = escapedNames.length
    ? new RegExp('(?<![\\p{L}\\p{N}])(?:' + escapedNames.join('|') + ')(?![\\p{L}\\p{N}])', 'giu')
    : null;

  const notes = rows.slice(0, MAX_NOTES).flatMap(row => {
    const date = dateOnly(row.created_at);
    if (!date || typeof row.body !== 'string') return [];
    let text = row.body.normalize('NFKC').replace(/\p{Cf}/gu, '')
      .replace(timeStampPattern, '$1')
      .replace(emailPattern, '[email removed]')
      .replace(phonePattern, match => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(match) || (match.match(/\p{Nd}/gu)?.length ?? 0) < 7) return match;
        return '[phone removed]';
      });
    if (namePattern) text = text.replace(namePattern, '[name removed]');
    text = firstCharacters(text.trim(), MAX_NOTE_CHARACTERS);
    return text ? [{ date, text }] : [];
  });
  // Leave room for the fixed request keys, circle ID and kind. Drop oldest notes first.
  const encoder = new TextEncoder();
  while (encoder.encode(JSON.stringify(notes)).byteLength > MAX_HANDOFF_BODY_BYTES - 256) notes.pop();
  return notes;
}

export async function loadHandoffNotes(client, circleId) {
  const { data: circle, error: circleError } = await client.from('circles')
    .select('name, ai_enabled, is_active').eq('id', circleId).maybeSingle();
  if (circleError) return { code: 'preview_unavailable' };
  if (!circle) return { code: 'not_a_member' };
  if (circle.ai_enabled !== true || circle.is_active !== true) return { code: 'ai_disabled' };

  const [members, notes] = await Promise.all([
    client.from('circle_members').select('user_id').eq('circle_id', circleId),
    client.from('care_notes').select('body, created_at').eq('circle_id', circleId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(MAX_NOTES)
  ]);
  if (members.error || notes.error) return { code: 'preview_unavailable' };
  if (!notes.data?.length) return { code: 'no_notes' };

  const names = [circle.name];
  if (members.data?.length) {
    const { data, error } = await client.from('profiles').select('full_name')
      .in('id', members.data.map(member => member.user_id));
    if (error) return { code: 'preview_unavailable' };
    names.push(...data.map(profile => profile.full_name));
  }
  const prepared = minimizeNotes(notes.data, names);
  return prepared.length ? { notes: prepared } : { code: 'no_notes' };
}
