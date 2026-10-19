/**
 * ESC-01 납품 요청 본문. `{ note, url? }`만 허용.
 * @returns {{ fields: Record<string, string>, note: string | null, url: string | null }}
 */
export function parseDeliveryBody(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {};
  for (const key of Object.keys(input)) {
    if (key !== 'note' && key !== 'url') fields[key] = '이 값은 보낼 수 없습니다.';
  }

  let note = null;
  if (typeof input.note !== 'string' || input.note.trim() === '') {
    fields.note = '납품 메모를 입력해 주세요.';
  } else {
    note = input.note.trim();
    if (note.length > 2000) fields.note = '납품 메모는 2000자 이하로 입력해 주세요.';
  }

  let url = null;
  if (input.url !== undefined && input.url !== null && input.url !== '') {
    if (typeof input.url !== 'string') {
      fields.url = '납품 링크 형식이 올바르지 않습니다.';
    } else {
      url = input.url.trim();
      if (url.length > 500) fields.url = '납품 링크는 500자 이하로 입력해 주세요.';
      else if (!/^https?:\/\/.+/i.test(url)) {
        fields.url = '납품 링크는 http(s)로 시작하는 URL이어야 합니다.';
      }
    }
  }

  if (Object.keys(fields).length > 0) {
    return { fields, note: null, url: null };
  }
  return { fields, note, url };
}
