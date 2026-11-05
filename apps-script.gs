/** @OnlyCurrentDoc */
/**
 * 유리스마 스트레칭 예약 ↔ 구글 시트 연결 스크립트 (v4: 기존 회원 예약 + 남은 횟수)
 *
 * 설치·업데이트 순서
 * 1) 구글 시트 [확장 프로그램 → Apps Script]에 이 파일 내용을 붙여넣고 저장한다.
 * 2) [프로젝트 설정 → 스크립트 속성]에 ADMIN_KEY(관리자 비밀번호, 12자 이상 권장)를 둔다.
 * 3) 함수 setup 을 한 번 실행한다. (시트 탭·머리글 생성, 비밀번호 찾기 메일 권한 허용)
 * 4) [배포 → 배포 관리 → 수정 → 새 버전]으로 배포하면 웹 앱 주소가 그대로 유지된다.
 *
 * 시트 구성
 * - 예약: 신규·회원 예약이 한 줄씩 쌓인다. 상태: 신청 / 확정 / 노쇼 / 취소. '취소'만 시간이 다시 열리고 횟수가 돌아온다.
 * - 회원: 결제한 기존 회원. 남은 횟수 = 총 횟수 - 이전 사용 - 예약 사용(취소 제외)으로 자동 계산된다.
 *   기존 회원은 이름+연락처로 확인한다(시안용. 실제는 유리스마스쿨 로그인으로 대체).
 * - 가격: 상품별 판매가·정가·이벤트가 표시. 관리자 화면 [가격 관리]에서 바꾸면 새 신청부터 적용된다.
 * - 주간차단 / 날짜차단: 예약 불가 시간.
 *
 * 보안 장치
 * - 관리자 기능은 ADMIN_KEY가 맞아야만 된다. 5번 틀리면 15분 잠금.
 * - 관리자 비밀번호를 잊으면 관리자 화면의 [이메일로 받기]로 스크립트 주인 메일에 보낸다(10분에 1번).
 * - 신규 예약: 같은 연락처 미래 예약 최대 3건, 전체 1시간 15건, 당일 예약 불가.
 * - 예약·회원 시트에는 개인정보와 건강정보가 들어간다. 시트는 본인만 볼 수 있게 두고 공유하지 않는다.
 */

const TZ = 'Asia/Seoul';
const OPEN_HOUR = 10, CLOSE_HOUR = 21, SLOT_MIN = 60; // index.html CONFIG와 같게
// 예약 오픈 규칙: 이번 달 말까지만 열고, 매달 10일 낮 12시(한국 시간)에 다음 달을 연다. (관리자 입력은 제한 없음)
const OPEN_DAY = 10, OPEN_AT_HOUR = 12;
const MAX_ACTIVE_PER_PHONE = 3, MAX_BOOKINGS_PER_HOUR = 15, MAX_ADMIN_FAILS = 5, LOCK_MINUTES = 15;
const RECOVER_COOLDOWN_MIN = 10;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const BOOK_H = ['접수시각', '예약번호', '상태', '예약일', '시간', '구분', '이용권', '금액', '이름', '연락처', '성별', '연령대',
  '불편 부위', '통증(0-10)', '진료·수술·질환 이력', '이력 상세', '방문 경로', '요청사항', '필수동의', '관리 기록', '회원번호', '거주지', '학교', '캘린더 일정', '메모(캘린더)'];
const C = { created: 0, id: 1, status: 2, date: 3, time: 4, cat: 5, item: 6, price: 7, name: 8, phone: 9, gender: 10, age: 11,
  area: 12, pain: 13, med: 14, medDetail: 15, route: 16, memo: 17, agreed: 18, note: 19, member: 20, region: 21, school: 22, cal: 23, calMemo: 24 };
const MEM_H = ['회원번호', '이름', '연락처', '이용권', '총 횟수', '이전 사용', '예약 사용', '남은 횟수', '만료일', '상태', '메모', '등록일', '약정서', '거주지', '학교'];
const M = { id: 0, name: 1, phone: 2, item: 3, total: 4, prev: 5, used: 6, remain: 7, expires: 8, status: 9, memo: 10, created: 11, contract: 12, region: 13, school: 14 };
// 구글 캘린더 '이솔강사님' (스크립트 속성 CALENDAR_ID로 바꿀 수 있음, CALENDAR_SYNC=off면 연동 중지)
const CAL_DEFAULT = '30d7b2ceb3d95dee233b547cca23304d7f16729c3e7de19ecbb2a77f85080e9a@group.calendar.google.com';
// 상품 가격 (기본값 = 현재 이벤트가). 시트 '가격' 탭이 있으면 그 값을 쓴다.
const PRICE_H = ['상품ID', '상품', '판매가', '정가', '이벤트가 표시'];
const PRICE_DEFAULT = {
  'a-welcome': { name: '일반 웰컴 처방 스트레칭', price: 100000, list: 0, event: true }, 'a-1': { name: '일반 1회권', price: 150000, list: 0, event: true },
  'a-10': { name: '일반 10회권', price: 1200000, list: 1500000, event: true }, 'a-20': { name: '일반 20회권', price: 2000000, list: 3000000, event: true },
  'k-welcome': { name: '키즈 웰컴 스트레칭', price: 80000, list: 0, event: true }, 'k-1': { name: '키즈 1회권', price: 120000, list: 0, event: true },
  'k-10': { name: '키즈 10회권', price: 1000000, list: 1200000, event: true }, 'k-20': { name: '키즈 20회권', price: 1600000, list: 2400000, event: true }
};
// 약정서(10회권·20회권는 서명해야 예약·회원 등록 가능)
const CON_H = ['약정번호', '작성시각', '상태', '이름', '연락처', '생년월일', '주소', '상품', '1회 시간(분)', '결제 방법', '회당 수강료', '강습비 합계',
  '사용 시작', '사용 종료', '보호자 성명', '보호자 관계', '보호자 연락처', '필수 동의', '민감정보 동의', '전후사진 SNS', '영상 SNS', '후기 활용',
  '얼굴 노출', '서명자', '서명(이미지)', '예약번호', '작성 환경'];
const PACKAGES = { '10회권': { count: 10, days: 70 }, '20회권': { count: 20, days: 140 } };
// 회원권: 회원이 산 이용권 하나하나. 캘린더 금액은 그 예약이 속한 회원권의 '결제 금액'을 쓴다.
const PASS_H = ['회원권번호', '회원번호', '이용권', '횟수', '결제 금액', '등록일', '구분', '예약번호', '약정서', '메모'];
const P = { id: 0, member: 1, item: 2, count: 3, amount: 4, created: 5, kind: 6, booking: 7, contract: 8, memo: 9 };
// 지정가: 상품 화면에는 안 보이고 관리자가 회원권을 넣을 때만 고르는 가격
const CUSTOM_H = ['이름', '횟수', '금액'];
const TRAINER = { name: '이솔', phone: '010-3175-7357' };

function setup() {
  const s = sheet_('예약', BOOK_H);
  BOOK_H.forEach((h, i) => { const c = s.getRange(1, i + 1); if (!c.getValue()) c.setValue(h).setFontWeight('bold'); });
  const ms = sheet_('회원', MEM_H);
  if (String(ms.getRange(1, 4).getValue()).trim() === 'PIN') ms.deleteColumn(4);   // PIN 열 제거(이전 버전 시트)
  ms.getRange(1, 1, 1, MEM_H.length).setValues([MEM_H]).setFontWeight('bold');
  if (ms.getMaxColumns() > MEM_H.length) ms.getRange(1, MEM_H.length + 1, 1, ms.getMaxColumns() - MEM_H.length).clearContent();
  readPrices_();   // '가격' 탭이 없으면 기본값으로 만든다
  sheet_('회원권', PASS_H).getRange(1, 1, 1, PASS_H.length).setValues([PASS_H]).setFontWeight('bold');
  sheet_('지정가', CUSTOM_H);
  Logger.log('회원권 옮김: ' + withLock_(() => ({ ok: true, made: migratePasses_() })).made + '명');
  const cal = calendar_();
  Logger.log('연동 캘린더: ' + (cal ? cal.getName() : '찾지 못함'));
  if (cal && calOn_()) Logger.log('캘린더 맞춤: ' + JSON.stringify(calResyncAll_()));
  sheet_('약정서', CON_H).getRange(1, 1, 1, CON_H.length).setValues([CON_H]).setFontWeight('bold');
  sheet_('주간차단', ['요일', '시간']);
  sheet_('날짜차단', ['날짜', '시간(비우면 하루 전체)']);
  Logger.log('비밀번호 찾기 메일 주소: ' + ownerEmail_() + ' / 남은 메일 할당량: ' + MailApp.getRemainingDailyQuota());
}

/* ---------- 관리자 비밀번호 찾기: 스크립트 주인 메일로만 보낸다 ---------- */
function ownerEmail_() { return Session.getEffectiveUser().getEmail(); }
function maskEmail_(e) { const p = String(e).split('@'); return p[0].slice(0, 2) + '****@' + (p[1] || ''); }
function adminRecover_() {
  const cache = CacheService.getScriptCache(), to = ownerEmail_();
  if (cache.get('recover_sent')) return { ok: true, sent: false, to: maskEmail_(to), wait: RECOVER_COOLDOWN_MIN };
  const key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  const body = key
    ? '유리스마 스트레칭 예약 관리자 비밀번호입니다.\n\n' + key + '\n\n직접 요청하지 않았다면 Apps Script [프로젝트 설정 → 스크립트 속성]에서 ADMIN_KEY를 바꿔 주세요.'
    : '관리자 비밀번호(ADMIN_KEY)가 아직 설정되지 않았어요. Apps Script [프로젝트 설정 → 스크립트 속성]에서 추가해 주세요.';
  MailApp.sendEmail(to, '[유리스마 스트레칭] 관리자 비밀번호 안내', body);
  cache.put('recover_sent', '1', RECOVER_COOLDOWN_MIN * 60);
  CacheService.getScriptCache().remove('admin_fails');   // 잠금도 함께 풀기
  return { ok: true, sent: true, to: maskEmail_(to) };
}

/* ---------- 입구 ---------- */
function doGet(e) {
  const a = (e.parameter || {}).action;
  if (a === 'slots') return json_({ ok: true, today: today_(), openUntil: openUntil_(), blocks: readBlocks_(), booked: readBooked_(), prices: readPrices_() });
  return json_({ ok: false, error: 'unknown' });
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  if (d.action === 'book') return json_(book_(d));
  if (d.action === 'memberLogin') return json_(memberLogin_(d));
  if (d.action === 'memberBook') return json_(memberBook_(d));
  if (d.action === 'adminRecover') return json_(adminRecover_());
  if (d.action === 'contract') return json_(contractOnly_(d));
  const adminActions = { setBlocks: 1, list: 1, update: 1, cancel: 1, confirm: 1, noshow: 1, members: 1, memberSave: 1, memberDelete: 1, adminBook: 1, setPrices: 1, setSms: 1, calResync: 1, setMemo: 1, passAdd: 1, passEdit: 1, custom: 1, setCustom: 1 };
  if (!adminActions[d.action]) return json_({ ok: false, error: 'unknown' });
  const auth = checkAdmin_(d.key);
  if (!auth.ok) return json_(auth);
  switch (d.action) {
    case 'setBlocks': writeBlocks_(d.blocks || {}); return json_({ ok: true });
    case 'list': return json_({ ok: true, today: today_(), rows: listBookings_(), smsAuto: smsAuto_() });
    case 'setMemo': return json_(setMemo_(String(d.id || ''), d.memo));
    case 'setSms': PropertiesService.getScriptProperties().setProperty('SMS_AUTO', d.on ? 'on' : 'off'); return json_({ ok: true, smsAuto: smsAuto_() });
    case 'calResync': return json_(calResyncAll_());
    case 'update': return json_(update_(d));
    case 'cancel': return json_(setStatus_(d.id, '취소'));
    case 'confirm': return json_(setStatus_(d.id, '확정'));
    case 'noshow': return json_(setStatus_(d.id, '노쇼'));
    case 'members': return json_({ ok: true, rows: memberViews_() });
    case 'memberSave': return json_(memberSave_(d.member || {}));
    case 'memberDelete': return json_(memberDelete_(String(d.id || '')));
    case 'setPrices': return json_(writePrices_(d.prices || {}));
    case 'adminBook': return json_(adminBook_(d));
    case 'passAdd': return json_(passAddAdmin_(d));
    case 'passEdit': return json_(passEdit_(d));
    case 'custom': return json_({ ok: true, list: readCustom_() });
    case 'setCustom': return json_(writeCustom_(d.list || []));
  }
}

/* ---------- 관리자 확인 ---------- */
function checkAdmin_(key) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('admin_fails') || 0);
  if (fails >= MAX_ADMIN_FAILS) return { ok: false, error: 'locked' };
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key) return { ok: false, error: 'auth' };
  if (real && key === real) { cache.remove('admin_fails'); return { ok: true }; }
  cache.put('admin_fails', String(fails + 1), LOCK_MINUTES * 60);
  return { ok: false, error: fails + 1 >= MAX_ADMIN_FAILS ? 'locked' : 'auth' };
}

/* ---------- 신규 손님 예약 ---------- */
function book_(d) {
  if (d.website) return { ok: false, error: 'invalid' };
  const hour = Number(d.hour), phone = digits_(d.phone);
  const v = validateSlot_(d.date, hour, false); if (v) return v;
  if (!String(d.name || '').trim() || !/^01[016789]\d{7,8}$/.test(phone)) return { ok: false, error: 'invalid', message: '이름/연락처 확인' };
  if (!d.agreed) return { ok: false, error: 'invalid', message: '필수 동의 누락' };
  const region = String(d.region || '').trim(), school = String(d.school || '').trim(), kids = String(d.category || '').indexOf('키즈') >= 0;
  if (!region || region.length > 40 || school.length > 40 || (kids && !school)) return { ok: false, error: 'invalid', message: kids ? '거주지와 학교를 입력해 주세요.' : '거주지를 입력해 주세요.' };
  const pkg = packageOf_(d.itemName);
  let con = null;
  const pr = readPrices_()[d.itemId];
  if (!pr || !String(d.itemName || '') || pr.name.slice(-String(d.itemName).length) !== String(d.itemName)) return { ok: false, error: 'invalid', message: '상품 오류' };
  if (pkg) { con = checkContract_(Object.assign({}, d.contract, { itemId: d.itemId }), d.itemName, d.category); if (!con.ok) return con; con = con.c; }
  const res = withLock_(() => {
    const cache = CacheService.getScriptCache(), hourKey = 'bk_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMddHH');
    if (Number(cache.get(hourKey) || 0) >= MAX_BOOKINGS_PER_HOUR) return { ok: false, error: 'busy' };
    const rows = bookingRows_();
    if (isCoachBlocked_(d.date, hour) || slotTaken_(rows, d.date, hour)) return { ok: false, error: 'taken' };
    if (rows.filter(r => r.active && String(r.r[C.cat]) !== '회원' && r.phone === phone && r.date >= today_()).length >= MAX_ACTIVE_PER_PHONE) return { ok: false, error: 'limit' };
    const id = newId_('YU');
    let conId = '';
    if (con) { con.start = con.start || d.date; conId = saveContract_(con, id); }
    const mem = autoMember_(d, phone, pr, pkg, conId, region, school, id);   // 수업을 신청하면 바로 회원으로 등록(또는 기존 회원에 횟수 추가)
    appendBooking_({ id: id, status: '확정', date: d.date, hour: hour, cat: d.category, item: d.itemName, price: pr.price, name: d.name, phone: phone,
      gender: d.gender, age: d.age, area: [].concat(d.area || []).join(', '), pain: Number(d.pain) || 0, med: [].concat(d.med || []).join(', '),
      medDetail: d.medDetail, route: d.route, memo: d.memo, agreed: 'Y', note: [con ? '약정서 서명' : '', mem.note].filter(String).join(' / '),
      member: mem.id || '', region: region, school: school });
    cache.put(hourKey, String(Number(cache.get(hourKey) || 0) + 1), 3600);
    const out = { ok: true, id: id, memberId: mem.id || '' };
    if (con) { out.contractId = conId; out.contract = con; }
    if (mem.id) {
      recalc_(mem.id);
      const mm = members_().find(x => x.id === mem.id), v = memberView_(mm, bookingRows_());
      out.member = { name: mm.name, item: mm.item, total: mm.total, remaining: v.remaining, isNew: !!mem.isNew };
    }
    return out;
  });
  if (res.ok && res.contract) { mailContract_(res.contract, res.contractId); delete res.contract; }
  return afterCal_(res);
}

// 신규 신청 → 회원 자동 등록. 같은 연락처의 같은 이름 회원이 있으면 새 이용권 횟수를 더한다.
// 같은 연락처에 다른 이름 회원이 있으면(형제가 보호자 번호를 같이 쓰는 경우 등) 연결하지 않고 관리 기록에 남긴다. (잠금 안에서 호출)
// 연락처가 같은 회원이 있으면 회원을 새로 만들지 않고 회원권만 추가한다(이름이 달라도 같은 번호면 같은 회원). (잠금 안에서 호출)
function autoMember_(d, phone, pr, pkg, conId, region, school, bookingId) {
  const s = sheet_('회원', MEM_H), name = String(d.name || '').trim(), count = pkg ? pkg.count : 1;
  const m = members_().find(x => x.phone === phone);
  const diff = m && normName_(m.name) !== normName_(name) ? '예약 이름 ' + name + '(회원 이름과 다름)' : '';
  const pass = { item: pr.name, count: count, amount: pr.price, kind: '신규 예약', booking: bookingId, contract: conId, memo: diff };
  if (!m) {
    const id = newId_('M');
    s.appendRow([id, safe_(name), "'" + phone, pr.name, count, 0, 0, count, '', '활성', '', today_(), conId, safe_(region), safe_(school)]);
    passAppend_(id, pass);
    return { id: id, isNew: true, note: '회원 자동 등록' };
  }
  migratePasses_(m.id);
  passAppend_(m.id, pass);
  syncMemberPasses_(m.id);
  if (conId) s.getRange(m.row, M.contract + 1).setValue(conId);
  if (region) s.getRange(m.row, M.region + 1, 1, 2).setValues([[safe_(region), safe_(school || m.school)]]);
  return { id: m.id, isNew: false, note: '기존 회원에 회원권 추가(' + pr.name + ')' + (diff ? ' / ' + diff : '') };
}

/* ---------- 회원권 ---------- */
function passes_() {
  const v = sheet_('회원권', PASS_H).getDataRange().getDisplayValues(), out = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i]; if (!r[P.id]) continue;
    out.push({ row: i + 1, id: String(r[P.id]), memberId: String(r[P.member]), item: String(r[P.item]), count: Number(r[P.count]) || 0,
      amount: Number(digits_(r[P.amount])) || 0, created: dateStr_(r[P.created]) || String(r[P.created] || ''), kind: String(r[P.kind] || ''),
      booking: String(r[P.booking] || ''), contract: String(r[P.contract] || ''), memo: String(r[P.memo] || '') });
  }
  return out;
}
// 회원권 기록이 없는 예전 회원은 회원 줄 값으로 '기존' 회원권 하나를 만든다. (금액은 지금 가격표 기준, 관리자가 고칠 수 있음)
function migratePasses_(onlyId) {
  const have = {}; passes_().forEach(p => have[p.memberId] = 1);
  let made = 0;
  members_().filter(m => !have[m.id] && (!onlyId || m.id === onlyId) && m.total > 0).forEach(m => {
    passAppend_(m.id, { item: m.item, count: m.total, amount: packagePrice_(m.item), kind: '기존', created: m.created, contract: m.contract, memo: '' }); made++;
  });
  return made;
}
function passAppend_(memberId, p) {
  const id = newId_('P');
  sheet_('회원권', PASS_H).appendRow([id, memberId, safe_(p.item || ''), Number(p.count) || 0, Number(p.amount) || 0, "'" + (p.created || today_()),
    p.kind || '', p.booking || '', p.contract || '', safe_(p.memo || '')]);
  return id;
}
function passesFor_(m, all) {   // 회원권 기록이 없으면 회원 줄로 만든 가상 회원권 하나
  const ps = all.filter(p => p.memberId === m.id);
  return ps.length ? ps : [{ id: '', item: m.item, count: m.total, amount: packagePrice_(m.item), created: m.created, kind: '기존', virtual: true }];
}
function passAt_(ps, pos) {   // pos번째 수업이 속한 회원권과 그 안에서의 회차
  let cum = 0;
  for (const p of ps) { if (pos <= cum + p.count) return { p: p, n: pos - cum }; cum += p.count; }
  const last = ps[ps.length - 1]; return last ? { p: last, n: pos - (cum - last.count) } : null;
}
function syncMemberPasses_(memberId) {   // 회원 줄의 이용권(최근)·총 횟수(합)를 회원권에 맞춘다
  const m = members_().find(x => x.id === memberId); if (!m) return;
  const ps = passes_().filter(p => p.memberId === memberId); if (!ps.length) return;
  sheet_('회원', MEM_H).getRange(m.row, M.item + 1, 1, 2).setValues([[safe_(ps[ps.length - 1].item), ps.reduce((a, p) => a + p.count, 0)]]);
  recalc_(memberId);
}
function passInfo_(m, rows, all) {   // 관리자 화면용: 회원권별 시작일(첫 수업일)·사용 횟수
  const ps = passesFor_(m, all), used = ps.map(() => 0), start = ps.map(() => '');
  for (let k = 0; k < m.prev; k++) { const h = passAt_(ps, k + 1); if (h) used[ps.indexOf(h.p)]++; }
  rows.filter(r => r.memberId === m.id && r.active && r.status !== '신청').sort((a, c) => (a.date + hm_(a.hour)).localeCompare(c.date + hm_(c.hour)))
    .forEach((r, i) => { const h = passAt_(ps, m.prev + i + 1); if (!h) return; const j = ps.indexOf(h.p); used[j]++; if (!start[j]) start[j] = r.date; });
  return ps.map((p, j) => ({ id: p.id, item: p.item, count: p.count, amount: p.amount, created: p.created, kind: p.kind, memo: p.memo, contract: p.contract, used: used[j], start: start[j] }));
}
// 관리자: 회원권 추가(재결제·지정가 등)
function passAddAdmin_(d) {
  const item = String(d.item || '').trim(), count = Math.round(Number(d.count) || 0), amount = Math.round(Number(d.amount) || 0);
  if (!item || item.length > 40 || count < 1 || count > 500 || amount < 0 || amount > 100000000) return { ok: false, error: 'invalid', message: '이용권·횟수·금액을 확인해 주세요.' };
  const res = withLock_(() => {
    const m = members_().find(x => x.id === String(d.memberId || '')); if (!m) return { ok: false, error: 'notfound' };
    migratePasses_(m.id);
    let con = d.paperContract ? '종이' : '';
    if (packageOf_(item) && !con) {   // 10·20회권은 아직 회원권에 연결 안 된 온라인 약정서가 있어야 한다
      const usedC = {}; passes_().forEach(p => usedC[p.contract] = 1);
      const free = contractsByPhone_(m.phone).filter(c => !usedC[c.id]).pop();
      if (!free) return { ok: false, error: 'noContract' };
      con = free.id;
    }
    passAppend_(m.id, { item: item, count: count, amount: amount, kind: '관리자 추가', contract: con, memo: String(d.memo || '').slice(0, 100) });
    syncMemberPasses_(m.id);
    if (con) sheet_('회원', MEM_H).getRange(m.row, M.contract + 1).setValue(con);
    return { ok: true, id: m.id };
  });
  if (res.ok) calSyncMember_(res.id);
  return res;
}
// 관리자: 회원권 결제 금액 고치기
function passEdit_(d) {
  const amount = Math.round(Number(d.amount)), res = withLock_(() => {
    if (!(amount >= 0) || amount > 100000000) return { ok: false, error: 'invalid', message: '금액을 확인해 주세요.' };
    const p = passes_().find(x => x.id === String(d.id || '')); if (!p) return { ok: false, error: 'notfound' };
    sheet_('회원권', PASS_H).getRange(p.row, P.amount + 1).setValue(amount);
    return { ok: true, id: p.memberId };
  });
  if (res.ok) calSyncMember_(res.id);
  return res;
}
/* ---------- 지정가 (상품 화면에 안 보임) ---------- */
function readCustom_() {
  const v = sheet_('지정가', CUSTOM_H).getDataRange().getDisplayValues(), out = [];
  for (let i = 1; i < v.length; i++) { const name = String(v[i][0]).trim(); if (name) out.push({ name: name, count: Number(v[i][1]) || 1, price: Number(digits_(v[i][2])) || 0 }); }
  return out;
}
function writeCustom_(list) {
  list = [].concat(list).slice(0, 30);
  for (const x of list) {
    const name = String(x.name || '').trim(), count = Math.round(Number(x.count)), price = Math.round(Number(x.price));
    if (!name || name.length > 40 || !(count >= 1 && count <= 500) || !(price >= 1000 && price <= 100000000)) return { ok: false, error: 'invalid', message: (name || '이름 없는 줄') + ': 이름·횟수·금액을 확인해 주세요.' };
  }
  return withLock_(() => {
    const s = sheet_('지정가', CUSTOM_H);
    if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, CUSTOM_H.length).clearContent();
    if (list.length) s.getRange(2, 1, list.length, 3).setValues(list.map(x => [safe_(String(x.name).trim()), Math.round(Number(x.count)), Math.round(Number(x.price))]));
    return { ok: true, list: readCustom_() };
  });
}

/* ---------- 약정서 ---------- */
function packageOf_(item) { const k = Object.keys(PACKAGES).find(p => String(item || '').indexOf(p) >= 0); return k ? Object.assign({ key: k }, PACKAGES[k]) : null; }
function checkContract_(c, item, category) {
  c = c || {};
  const pkg = packageOf_(c.product || item);
  if (!pkg) return { ok: false, error: 'contract', message: '약정 상품 오류' };
  const name = String(c.name || '').trim(), phone = digits_(c.phone), birth = dateStr_(c.birth), addr = String(c.address || '').trim();
  if (!name || !/^01[016789]\d{7,8}$/.test(phone) || !birth || !addr) return { ok: false, error: 'contract', message: '약정서 회원 정보를 모두 입력해 주세요.' };
  if (['현금', '계좌이체', '카드'].indexOf(c.pay) < 0) return { ok: false, error: 'contract', message: '결제 방법을 골라 주세요.' };
  if (!c.agreeTerms || !c.agreeRequired || !c.agreeSensitive) return { ok: false, error: 'contract', message: '필수 동의가 빠졌어요.' };
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(c.sign || '')) || String(c.sign).length > 45000) return { ok: false, error: 'contract', message: '서명을 다시 해 주세요.' };
  const minor = ageOn_(birth, today_()) < 14;
  const gName = String(c.guardianName || '').trim(), gRel = String(c.guardianRel || '').trim(), gPhone = digits_(c.guardianPhone);
  if (minor && (!gName || !gRel || !/^01[016789]\d{7,8}$/.test(gPhone))) return { ok: false, error: 'contract', message: '만 14세 미만은 보호자 정보와 보호자 서명이 필요해요.' };
  const minutes = Number(c.minutes) || (String(category || c.category || '').indexOf('키즈') >= 0 ? 40 : 50);
  const start = c.start ? dateStr_(c.start) : '';
  return { ok: true, c: { name: name, phone: phone, birth: birth, address: addr, product: (c.categoryLabel ? c.categoryLabel + ' ' : '') + pkg.key, pkg: pkg,
    minutes: minutes, pay: c.pay, unit: priceTotal_(c) ? Math.round(priceTotal_(c) / pkg.count) : (Number(c.unit) || ''), total: priceTotal_(c) || Number(c.total) || '', start: start,
    guardianName: gName, guardianRel: gRel, guardianPhone: gPhone,
    snsPhoto: !!c.snsPhoto, snsVideo: !!c.snsVideo, review: !!c.review, face: !!c.face, signer: gName ? gName + '(' + gRel + ', 보호자)' : name,
    sign: String(c.sign), ua: String(c.ua || '').slice(0, 200) } };
}
function priceTotal_(c) { const p = c && c.itemId ? readPrices_()[c.itemId] : null; return p ? p.price : 0; }   // 금액은 서버 가격표 기준
function ageOn_(birth, onDate) { const b = birth.split('-').map(Number), o = onDate.split('-').map(Number); let a = o[0] - b[0]; if (o[1] < b[1] || (o[1] === b[1] && o[2] < b[2])) a--; return a; }
function endDate_(start, days) { if (!start) return ''; return addDays_(start, days - 1); }
function saveContract_(c, bookingId) {
  const id = newId_('C'), end = endDate_(c.start, c.pkg.days);
  const yn = v => v ? '동의' : '미동의';
  sheet_('약정서', CON_H).appendRow([id, Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), '유효', safe_(c.name), "'" + c.phone, "'" + c.birth,
    safe_(c.address), c.product, c.minutes, c.pay, c.unit, c.total, c.start ? "'" + c.start : '첫 수업일부터', end ? "'" + end : c.pkg.days + '일',
    safe_(c.guardianName), safe_(c.guardianRel), c.guardianPhone ? "'" + c.guardianPhone : '', '동의', '동의', yn(c.snsPhoto), yn(c.snsVideo), yn(c.review),
    c.face ? '허용' : '얼굴 가림', safe_(c.signer), c.sign, bookingId || '', safe_(c.ua)]);
  return id;
}
function contractOnly_(d) {
  if (d.website) return { ok: false, error: 'invalid' };
  const chk = checkContract_(d.contract, (d.contract || {}).product, (d.contract || {}).category); if (!chk.ok) return chk;
  const cache = CacheService.getScriptCache(), hourKey = 'bk_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMddHH');
  if (Number(cache.get(hourKey) || 0) >= MAX_BOOKINGS_PER_HOUR) return { ok: false, error: 'busy' };
  const id = withLock_(() => saveContract_(chk.c, ''));
  cache.put(hourKey, String(Number(cache.get(hourKey) || 0) + 1), 3600);
  mailContract_(chk.c, id);
  return { ok: true, contractId: id };
}
function contractsByPhone_(phone) {
  const v = sheet_('약정서', CON_H).getDataRange().getDisplayValues(), out = [];
  for (let i = 1; i < v.length; i++) if (digits_(v[i][4]) === phone && String(v[i][2]).trim() !== '취소') out.push({ id: v[i][0], at: v[i][1], product: v[i][7] });
  return out;
}
function contractHtml_(c, id) {
  const end = endDate_(c.start, c.pkg.days), won = n => n ? Number(n).toLocaleString('ko-KR') + '원' : '-';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
  const yn = v => v ? '■ 동의 □ 미동의' : '□ 동의 ■ 미동의';
  const row = (a, b, c2, d2) => '<tr><th>' + a + '</th><td>' + b + '</td>' + (c2 ? '<th>' + c2 + '</th><td>' + d2 + '</td>' : '<td colspan="2"></td>') + '</tr>';
  return '<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;color:#1a1815;font-size:11px;line-height:1.6}h1{font-size:20px;margin:0 0 4px}'
    + '.brand{color:#4395eb;font-weight:bold}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}'
    + 'th{background:#f3f6fa;width:16%}h2{font-size:13px;margin:14px 0 4px;color:#2d7dd2}.sig{height:70px}</style></head><body>'
    + '<div class="brand">Yurisma School · 유리스마 스트레칭</div><h1>개인 트레이닝 약정서</h1><div>약정번호 ' + esc(id) + ' · 작성 ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + '</div>'
    + '<table>' + row('회원 성명', esc(c.name), '연락처', esc(c.phone)) + row('주소', esc(c.address), '생년월일', esc(c.birth))
    + row('상품', esc(c.product) + ' (주 1회 / 1회 ' + c.minutes + '분)', '결제 방법', esc(c.pay)) + row('회당 수강료', won(c.unit) + ' (1회 정가 150,000원)', '강습비 합계', won(c.total))
    + row('사용기간', (c.start ? esc(c.start) + ' ~ ' + esc(end) : '첫 수업일부터 ' + c.pkg.days + '일') + ' (첫 수업일부터 10회권 70일 / 20회권 140일)')
    + row('담당 트레이너', TRAINER.name, '트레이너 연락처', TRAINER.phone)
    + (c.guardianName ? row('보호자(법정대리인)', esc(c.guardianName) + ' (' + esc(c.guardianRel) + ')', '보호자 연락처', esc(c.guardianPhone)) : '') + '</table>'
    + CONTRACT_TERMS_HTML
    + '<h2>개인정보 수집·이용 동의</h2><table><tr><th>필수</th><td>성명, 연락처, 주소, 생년월일, 결제 정보 / 계약 이행·일정 안내·환불 처리 / 계약 종료 후 3년</td><td>■ 동의</td></tr>'
    + '<tr><th>필수(민감정보)</th><td>질환, 통증, 수술 이력, 복용 약 등 건강 정보 / 안전한 운동 프로그램 설계 / 계약 종료 시 파기</td><td>■ 동의</td></tr>'
    + '<tr><th>선택</th><td>전·후 사진 촬영 및 인스타그램 등 SNS 게시</td><td>' + yn(c.snsPhoto) + '</td></tr>'
    + '<tr><th>선택</th><td>수업 영상 촬영 및 인스타그램 등 SNS 게시</td><td>' + yn(c.snsVideo) + '</td></tr>'
    + '<tr><th>선택</th><td>작성한 후기(리뷰)의 SNS·홈페이지 홍보 활용</td><td>' + yn(c.review) + '</td></tr>'
    + '<tr><th>선택</th><td>게시물에 얼굴 노출 허용 (미동의 시 얼굴을 가리고 게시)</td><td>' + yn(c.face) + '</td></tr></table>'
    + '<div>선택 항목은 동의하지 않아도 불이익이 없으며, 언제든 철회를 요청하면 게시물을 지체 없이 내립니다.</div>'
    + '<p>위의 모든 사항을 설명 듣고 이해하였으며, 이에 동의하여 약정을 체결합니다.</p>'
    + '<table><tr><th>' + (c.guardianName ? '보호자 서명' : '회원 서명') + '</th><td>' + esc(c.signer) + '<br><img class="sig" src="' + c.sign + '"></td><th>트레이너</th><td>' + TRAINER.name + '</td></tr></table>'
    + '</body></html>';
}
function mailContract_(c, id) {
  try {
    const html = contractHtml_(c, id);
    const pdf = Utilities.newBlob(html, 'text/html', id + '.html').getAs('application/pdf').setName('약정서_' + c.name + '_' + id + '.pdf');
    MailApp.sendEmail({ to: ownerEmail_(), subject: '[유리스마 스트레칭] 약정서 서명 · ' + c.name + ' · ' + c.product, htmlBody: html, attachments: [pdf] });
  } catch (e) { Logger.log('약정서 메일 실패: ' + e); }
}
const CONTRACT_TERMS_HTML = '<h2>1. 수업 진행과 사용 기간</h2><div>1) 모든 세션은 주 1회 진행을 기본으로 하며, 세션 소진 기간은 10회 70일, 20회 140일입니다. 사용기간은 첫 수업일부터 10회권 70일, 20회권 140일이며 위에 기재된 날짜까지입니다.<br>2) 본 상품은 10회권·20회권 상품이며, 여행·질병·출장 등 회원 개인 사정에 따른 홀딩(일시정지)은 제공하지 않습니다.<br>3) 사용기간 동안 수강을 완료하지 않은 경우 남은 세션은 소멸하며 환불되지 않습니다.</div>'
  + '<h2>2. 계약 해지와 환불</h2><div>1) 회원 사정으로 해지하는 경우, 수업 시작 여부와 관계없이 총 강습비의 10%를 위약금으로 공제합니다.<br>2) 수업을 시작한 뒤 해지하는 경우, 위약금과 이미 진행한 세션 비용을 공제한 뒤 남은 금액을 환불합니다. 진행한 세션은 1회 정가 150,000원으로 계산하며, 이는 다회권 할인가가 아닌 1회권 정가 기준입니다.<br>3) 카드 결제는 결제 금액 전체를 카드 취소한 뒤, 사용액(위약금과 진행한 세션 비용)을 재결제하는 방식으로 처리합니다.</div>'
  + '<h2>3. 이용 대상</h2><div>본 강습은 회원 본인만 사용할 수 있으며, 타인에게 양도할 수 없습니다.</div>'
  + '<h2>4. 예약 취소와 변경</h2><div>수업을 취소·변경하려면 수업 24시간 전까지 트레이너에게 연락해야 하며, 미리 연락하지 않은 경우 1회 수업이 진행된 것으로 봅니다. 갑작스러운 사고·응급 질환 등 불가피한 사유가 확인되면 협의하여 차감하지 않을 수 있습니다.</div>'
  + '<h2>5. 건강 상태 고지와 안전</h2><div>1) 회원은 현재 앓고 있는 질환, 통증, 수술 이력, 복용 중인 약, 임신 여부 등 운동에 영향을 줄 수 있는 사항을 수업 전에 사실대로 알려야 하며, 변동이 생기면 즉시 알립니다.<br>2) 트레이너는 의료인이 아니며 진단이나 치료를 하지 않습니다. 의학적 판단이 필요한 경우 전문의 상담을 권하며, 필요하면 의사 확인 후 수업을 진행할 수 있습니다.<br>3) 트레이너의 개인 강습을 받는 도중 회원님이나 그 이외의 사람이 사고를 유발할 경우 상해의 위험이 있습니다. 이러한 위험이 발생할 수 있다는 것을 회원님께서는 인지하고 계시며, 회원님의 부주의 또는 다른 사람의 행위로 인하여 회원님 개인의 신체 혹은 정신에 어떠한 형태로든 상해가 발생하거나 경제적 손실 및 손상을 보게 되더라도 트레이너는 책임이 없다는 사실을 인지하고 동의합니다. 회원님의 과실로 인하여 다른 사람이 상해를 입어서 발생하는 경제적 손실에 대해 보상을 요구할 경우, 트레이너가 아닌 회원님 본인이 손해 배상 청구와 관련된 일체의 책임을 지셔야 하며 그러한 보상에 대해 트레이너는 책임지지 않습니다.</div>'
  + '<h2>6. 기타</h2><div>1) 본 약정서에 기재되어 있지 아니한 사항에 대해 트레이너는 약속이나 책임을 지지 않으며, 이 약정서 이외의 어떠한 구두, 서면상의 약정은 효력이 없습니다.<br>2) 본 약정서는 전자서명으로 체결하며, 체결 후 pdf파일로 회원과 트레이너가 각각 보관합니다.</div>';

/* ---------- 기존 회원: 확인·예약 ---------- */
function memberAuth_(d) {
  const phone = digits_(d.phone), name = normName_(d.name);
  if (!/^01[016789]\d{7,8}$/.test(phone) || !name) return { ok: false, error: 'auth' };
  const m = members_().find(x => x.phone === phone);
  if (m && m.status !== '정지' && normName_(m.name) === name) return { ok: true, m: m };
  return { ok: false, error: 'auth' };
}

function memberLogin_(d) {
  const a = memberAuth_(d); if (!a.ok) return a;
  return { ok: true, member: publicMember_(a.m, bookingRows_()) };
}

function memberBook_(d) {
  const a = memberAuth_(d); if (!a.ok) return a;
  const hour = Number(d.hour), v = validateSlot_(d.date, hour, false); if (v) return v;
  return afterCal_(withLock_(() => {
    const rows = bookingRows_(), m = members_().find(x => x.id === a.m.id), view = memberView_(m, rows);
    if (view.expires && d.date > view.expires) return { ok: false, error: 'expired' };
    if (view.remaining <= 0) return { ok: false, error: 'noRemain' };
    if (isCoachBlocked_(d.date, hour) || slotTaken_(rows, d.date, hour)) return { ok: false, error: 'taken' };
    const id = newId_('YM');
    appendBooking_({ id: id, status: '확정', date: d.date, hour: hour, cat: '회원', item: m.item, price: '', name: m.name, phone: m.phone,
      gender: '', age: '', area: '', pain: '', med: '', medDetail: '', route: '', memo: safe_(d.memo || ''), agreed: '회원', note: '회원 직접 예약', member: m.id,
      region: m.region, school: m.school });
    recalc_(m.id);
    return { ok: true, id: id, member: publicMember_(m, bookingRows_()) };
  }));
}

/* ---------- 관리자: 회원 등록·수정, 대신 예약 ---------- */
function memberSave_(x) {
  const phone = digits_(x.phone), name = String(x.name || '').trim();
  if (!name || !/^01[016789]\d{7,8}$/.test(phone)) return { ok: false, error: 'invalid', message: '이름/연락처 확인' };
  const total = Math.max(0, Number(x.total) || 0), prev = Math.max(0, Number(x.prev) || 0);
  const expires = x.expires ? dateStr_(x.expires) : '';
  const res = withLock_(() => {
    const s = sheet_('회원', MEM_H), all = members_();
    if (all.some(m => m.phone === phone && m.id !== x.id)) return { ok: false, error: 'dupPhone' };
    let m = x.id ? all.find(r => r.id === x.id) : null;
    if (x.id && !m) return { ok: false, error: 'notfound' };
    // 10회권·20회권 회원은 약정서(온라인 서명 또는 종이)가 있어야 등록
    const online = contractsByPhone_(phone);
    let conTag = (m && m.contract) || (online.length ? online[online.length - 1].id : '') || (x.paperContract ? '종이' : '');
    if (packageOf_(x.item) && !conTag) return { ok: false, error: 'noContract' };
    const vals = { name: safe_(name), phone: "'" + phone, item: safe_(x.item || ''), total: total, prev: prev,
      expires: expires ? "'" + expires : '', status: x.status === '정지' ? '정지' : '활성', memo: safe_(x.memo || ''),
      region: safe_(String(x.region || '').trim().slice(0, 40)), school: safe_(String(x.school || '').trim().slice(0, 40)) };
    if (!vals.region || !vals.school) {   // 비어 있으면 같은 연락처의 최근 신규 예약에서 가져온다
      const last = bookingRows_().filter(r => r.phone === phone && !r.memberId).pop();
      if (last) { vals.region = vals.region || safe_(last.r[C.region] || ''); vals.school = vals.school || safe_(last.r[C.school] || ''); }
    }
    let id;
    const amountIn = x.amount === '' || x.amount == null ? null : Math.round(Number(x.amount));
    if (amountIn !== null && !(amountIn >= 0 && amountIn <= 100000000)) return { ok: false, error: 'invalid', message: '결제 금액을 확인해 주세요.' };
    if (!m) {
      id = newId_('M');
      s.appendRow([id, vals.name, vals.phone, vals.item, total, prev, 0, total - prev, vals.expires, vals.status, vals.memo,
        Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), conTag, vals.region, vals.school]);
      if (total > 0) passAppend_(id, { item: x.item || '', count: total, amount: amountIn !== null ? amountIn : packagePrice_(x.item), kind: '관리자 등록', contract: conTag });
    } else {
      id = m.id;
      const row = m.row;
      // 회원권: 최근 회원권을 고친 값에 맞춘다(총 횟수 = 회원권 횟수의 합)
      migratePasses_(m.id);
      const ps = passes_().filter(p => p.memberId === m.id);
      if (ps.length) {
        const last = ps[ps.length - 1], others = ps.slice(0, -1).reduce((a, p) => a + p.count, 0);
        if (total - others < 1) return { ok: false, error: 'invalid', message: '총 횟수는 이전 회원권 횟수 합(' + others + '회)보다 커야 해요.' };
        sheet_('회원권', PASS_H).getRange(last.row, P.item + 1, 1, 3).setValues([[vals.item, total - others, amountIn !== null ? amountIn : last.amount]]);
      }
      s.getRange(row, M.name + 1, 1, 2).setValues([[vals.name, vals.phone]]);
      s.getRange(row, M.item + 1, 1, 3).setValues([[vals.item, total, prev]]);
      s.getRange(row, M.expires + 1, 1, 3).setValues([[vals.expires, vals.status, vals.memo]]);
      if (conTag !== m.contract) s.getRange(row, M.contract + 1).setValue(conTag);
      s.getRange(row, M.region + 1, 1, 2).setValues([[vals.region, vals.school]]);
    }
    recalc_(id);
    return { ok: true, id: id };
  });
  if (res.ok) calSyncMember_(res.id);
  return res;
}

/* 회원 삭제: 회원 줄을 지우고, 오늘 이후 잡힌 예약은 취소(캘린더 일정도 삭제). 지난 예약 기록·약정서는 남긴다. */
function memberDelete_(id) {
  const res = withLock_(() => {
    const m = members_().find(x => x.id === id); if (!m) return { ok: false, error: 'notfound' };
    const s = sheet_('예약', BOOK_H), today = today_();
    const up = bookingRows_().filter(r => r.memberId === m.id && r.active && r.date >= today);
    up.forEach(r => { s.getRange(r.row, C.status + 1).setValue('취소'); addNote_(s, r.row, '회원 삭제로 취소'); });
    sheet_('회원', MEM_H).deleteRow(m.row);
    return { ok: true, name: m.name, cancelled: up.map(r => r.id) };
  });
  if (res.ok) res.cancelled.forEach(bid => calSync_(bid));
  if (res.ok) res.cancelled = res.cancelled.length;
  return res;
}

function adminBook_(d) {
  const hour = Number(d.hour), v = validateSlot_(d.date, hour, true); if (v) return v;
  return afterCal_(withLock_(() => {
    const rows = bookingRows_(), m = members_().find(x => x.id === d.memberId);
    if (!m) return { ok: false, error: 'notfound' };
    if (memberView_(m, rows).remaining <= 0) return { ok: false, error: 'noRemain' };
    if (slotTaken_(rows, d.date, hour)) return { ok: false, error: 'taken' };   // 관리자는 막아둔 시간에도 넣을 수 있음
    const id = newId_('YM');
    appendBooking_({ id: id, status: '확정', date: d.date, hour: hour, cat: '회원', item: m.item, price: '', name: m.name, phone: m.phone,
      gender: '', age: '', area: '', pain: '', med: '', medDetail: '', route: '', memo: safe_(d.memo || ''), agreed: '회원', note: '관리자 입력', member: m.id,
      region: m.region, school: m.school, calMemo: cleanMemo_(d.calMemo) });
    recalc_(m.id);
    return { ok: true, id: id };
  }));
}

/* ---------- 관리자: 시간 변경 / 상태 변경 ---------- */
function update_(d) {
  const hour = Number(d.hour);
  if (!d.id || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || slotStarts_().indexOf(hour) < 0) return { ok: false, error: 'invalid' };
  return afterCal_(withLock_(() => {
    const rows = bookingRows_(), me = rows.find(r => r.id === d.id);
    if (!me) return { ok: false, error: 'notfound' };
    if (!me.active) return { ok: false, error: 'cancelled' };
    if (slotTaken_(rows, d.date, hour, d.id)) return { ok: false, error: 'taken' };
    const s = sheet_('예약', BOOK_H);
    s.getRange(me.row, C.date + 1, 1, 2).setValues([["'" + d.date, "'" + hm_(hour)]]);
    addNote_(s, me.row, '시간 변경 ' + me.date + ' ' + hm_(me.hour) + ' → ' + d.date + ' ' + hm_(hour));
    return { ok: true, id: me.id, memberId: me.memberId };
  }));
}

function setStatus_(id, status) {
  return afterCal_(withLock_(() => {
    const me = bookingRows_().find(r => r.id === id);
    if (!me) return { ok: false, error: 'notfound' };
    const s = sheet_('예약', BOOK_H);
    s.getRange(me.row, C.status + 1).setValue(status);
    addNote_(s, me.row, '상태 ' + me.status + ' → ' + status);
    if (me.memberId) recalc_(me.memberId);
    return { ok: true, id: me.id, memberId: me.memberId };
  }));
}

/* ---------- 확정 문자 자동 발송 설정 (발송 자체는 문자 서비스를 고른 뒤 연결) ---------- */
function smsAuto_() { return PropertiesService.getScriptProperties().getProperty('SMS_AUTO') === 'on'; }

/* ---------- 구글 캘린더 연동 ----------
 * 제목 예: <스트레칭8完>이시현(경기 안양, 귀인초등학교)010-6549-0464, 20/19
 *   8 = 결제 금액(만원, 회원은 이용권 전체 금액), 完 = 결제 완료, 20/19 = 총 20회 중 19회째(10·20회권)
 * 확정되면 일정을 만들고(항상 完), 시간 변경은 일정을 옮기고, 취소는 일정을 지운다. 새 예약은 들어오면 바로 확정이다(예전 '신청' 줄은 올리지 않음). 실패해도 예약은 그대로 저장된다. */
function afterCal_(res) {
  if (res && res.ok && res.id) { if (res.memberId) calSyncMember_(res.memberId, res.id); else calSync_(res.id); }
  if (res) delete res.memberId;
  return res;
}
function calOn_() { return PropertiesService.getScriptProperties().getProperty('CALENDAR_SYNC') !== 'off'; }
function calendar_() { return CalendarApp.getCalendarById(PropertiesService.getScriptProperties().getProperty('CALENDAR_ID') || CAL_DEFAULT); }
function manwon_(n) { n = Number(n) || 0; return n ? String(Math.round(n / 1000) / 10) : ''; }
function fmtPhone_(p) { p = digits_(p); return p.length === 11 ? p.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3') : p.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3'); }
function packagePrice_(item) {   // 회원 이용권 이름으로 현재 가격표 금액을 찾는다
  // 예: '일반 20회권', '성인 1회권', '학생 키즈 웰컴 스트레칭', '학생 10회권' (학생·키즈가 들어 있으면 키즈 가격)
  const s = String(item || '').trim(), kids = /학생|키즈/.test(s), strip = t => t.replace(/^((일반|성인|학생|키즈)[\s·]*)+/, '').trim();
  const p = readPrices_(), base = strip(s);
  const id = Object.keys(p).find(k => k.indexOf(kids ? 'k-' : 'a-') === 0 && (p[k].name === s || strip(p[k].name) === base));
  return id ? p[id].price : 0;
}
function calTitle_(b, rows, members, passes) {
  const r = b.r, m = b.memberId ? members.find(x => x.id === b.memberId) : null;
  let price = Number(digits_(r[C.price])) || 0, count = '';
  const paid = calShow_(b);
  const where = [String(r[C.region] || (m && m.region) || '').trim(), String(r[C.school] || (m && m.school) || '').trim()].filter(String).join(', ');
  if (m) {   // 회원 예약: 이 예약이 속한 회원권의 결제 금액, 회차는 2회 이상 회원권만 (예: 10/3)
    const mine = rows.filter(x => x.memberId === m.id && x.active && x.status !== '신청').sort((a, c) => (a.date + hm_(a.hour)).localeCompare(c.date + hm_(c.hour)));
    const idx = mine.findIndex(x => x.id === b.id), hit = idx >= 0 ? passAt_(passesFor_(m, passes || []), m.prev + idx + 1) : null;
    if (hit) { price = hit.p.amount || price || packagePrice_(hit.p.item); if (hit.p.count > 1) count = hit.p.count + '/' + hit.n; }
    else price = price || packagePrice_(m.item);
  } else { const pkg = packageOf_(r[C.item]); if (pkg) count = pkg.count + '/1'; }
  return '<스트레칭' + manwon_(price) + (paid ? '完' : '') + '>' + String(r[C.name]).trim() + (where ? '(' + where + ')' : '') + fmtPhone_(b.phone)
    + (count ? ', ' + count : '') + (b.status === '노쇼' ? ' (노쇼)' : '');
}
// 캘린더 작업은 항상 잠금 안에서 최신 시트를 다시 읽고 한다. (여러 건을 연달아 취소해도 서로 덮어쓰지 않게)
function calCtx_() { return { rows: bookingRows_(), members: members_(), passes: passes_(), cal: calendar_() }; }
function calSync_(id) {
  if (!calOn_()) return;
  try { withLock_(() => calSyncCore_(id, calCtx_())); } catch (e) { Logger.log('캘린더 연동 실패 ' + id + ': ' + e); }
}
function calDayEvents_(cal, date, id) {   // 그날 일정 중 설명에 이 예약번호가 있는 것(= 이 시스템이 만든 일정)
  const st = new Date(date + 'T00:00:00+09:00'), en = new Date(st.getTime() + 86400000);
  return cal.getEvents(st, en).filter(e => String(e.getDescription() || '').indexOf('예약번호 ' + id) >= 0);
}
function calShow_(b) { return b.active && (b.status === '확정' || b.status === '노쇼'); }
function calSyncCore_(id, ctx) {
  const b = ctx.rows.find(x => x.id === id); if (!b || !ctx.cal) return;
  const s = sheet_('예약', BOOK_H), evId = String(b.r[C.cal] || '').trim();
  let found = calDayEvents_(ctx.cal, b.date, b.id);
  if (!found.length && evId) {   // 시간 변경 등으로 다른 날에 있는 일정: 실제로 살아 있는지 그날 목록에서 확인
    try { const ev = ctx.cal.getEventById(evId); if (ev) { const d = Utilities.formatDate(ev.getStartTime(), TZ, 'yyyy-MM-dd');
      found = calDayEvents_(ctx.cal, d, b.id); } } catch (e) {}
  }
  // 캘린더에는 결제가 확인된 예약(확정·노쇼)만 올린다. 신청(결제 대기)·취소는 일정을 두지 않는다.
  if (!calShow_(b)) {   // 이 예약으로 만든 일정을 모두 지운다
    found.forEach(e => { try { e.deleteEvent(); } catch (er) {} });
    if (evId) s.getRange(b.row, C.cal + 1).setValue('');
    return;
  }
  const start = new Date(b.date + 'T' + hm_(b.hour) + ':00+09:00'), end = new Date(start.getTime() + SLOT_MIN * 60000);
  const title = calTitle_(b, ctx.rows, ctx.members, ctx.passes);
  // 설명 맨 위: 요청(회원 예약의 요청사항) → 메모(관리자) → 빈 줄 → 나머지. 신규 신청의 요청사항은 건강 정보가 섞일 수 있어 넣지 않는다.
  const req = String(b.r[C.cat]) === '회원' ? String(b.r[C.memo] || '').trim() : '';   // 회원 예약 화면에서 적은 요청만
  const memo = String(b.r[C.calMemo] || '').trim();
  const head = (req ? '요청: ' + req + '\n' : '') + (memo ? '메모: ' + memo + '\n' : '');
  const desc = (head ? head + '\n' : '') + '예약번호 ' + b.id + '\n이용권 ' + (b.r[C.item] || '') + ' · 상태 ' + b.status + '\n유리스마 스트레칭 예약 페이지에서 자동 등록';
  let ev = found[0] || null;
  found.slice(1).forEach(e => { try { e.deleteEvent(); } catch (er) {} });   // 중복 일정 정리
  if (ev) { if (ev.getTitle() !== title) ev.setTitle(title); if (ev.getStartTime().getTime() !== start.getTime()) ev.setTime(start, end); if (ev.getDescription() !== desc) ev.setDescription(desc); }
  else ev = ctx.cal.createEvent(title, start, end, { description: desc });
  if (ev.getId() !== evId) s.getRange(b.row, C.cal + 1).setValue(ev.getId());
}
function calSyncMember_(memberId, alsoId) {   // 회차(20/19)가 바뀔 수 있어 같은 회원의 예정 일정을 함께 고친다
  if (!calOn_()) return;
  try {
    withLock_(() => {
      const ctx = calCtx_(), today = today_();
      ctx.rows.filter(x => x.memberId === memberId && (x.date >= today || x.id === alsoId) && (x.active || x.id === alsoId))
        .forEach(x => { try { calSyncCore_(x.id, ctx); } catch (e) { Logger.log('캘린더 연동 실패 ' + x.id + ': ' + e); } });
    });
  } catch (e) { Logger.log('캘린더 회원 연동 실패 ' + e); }
}
function calResyncAll_() {   // 관리자: 오늘 이후 예약(취소 포함)을 캘린더에 다시 맞춘다
  if (!calOn_()) return { ok: false, error: 'invalid', message: '캘린더 연동이 꺼져 있어요.' };
  return withLock_(() => {
    const ctx = calCtx_(), today = today_();
    if (!ctx.cal) return { ok: false, error: 'invalid', message: '캘린더를 찾지 못했어요.' };
    const list = ctx.rows.filter(x => x.date >= today);
    let fail = 0;
    list.forEach(x => { try { calSyncCore_(x.id, ctx); } catch (e) { fail++; Logger.log('캘린더 연동 실패 ' + x.id + ': ' + e); } });
    return { ok: true, count: list.length, fail: fail };
  });
}

/* ---------- 회원 계산 ---------- */
function members_() {
  const v = sheet_('회원', MEM_H).getDataRange().getDisplayValues(), out = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i]; if (!r[M.id]) continue;
    out.push({ row: i + 1, id: String(r[M.id]), name: String(r[M.name]), phone: digits_(r[M.phone]),
      item: String(r[M.item]), total: Number(r[M.total]) || 0, prev: Number(r[M.prev]) || 0, expires: dateStr_(r[M.expires]),
      status: String(r[M.status] || '활성').trim() || '활성', memo: String(r[M.memo] || ''), created: String(r[M.created] || ''), contract: String(r[M.contract] || ''),
      region: String(r[M.region] || ''), school: String(r[M.school] || '') });
  }
  return out;
}
function memberView_(m, rows) {
  const used = rows.filter(r => r.memberId === m.id && r.active).length;
  return { id: m.id, name: m.name, phone: m.phone, item: m.item, total: m.total, prev: m.prev, used: used,
    remaining: m.total - m.prev - used, expires: m.expires, status: m.status, memo: m.memo, created: m.created, contract: m.contract, region: m.region, school: m.school };
}

/* ---------- 가격 ---------- */
function readPrices_() {
  const s = sheet_('가격', PRICE_H), v = s.getDataRange().getDisplayValues(), out = {};
  for (let i = 1; i < v.length; i++) {
    const id = String(v[i][0]).trim(); if (!PRICE_DEFAULT[id]) continue;
    out[id] = { name: PRICE_DEFAULT[id].name, price: Number(digits_(v[i][2])) || PRICE_DEFAULT[id].price, list: Number(digits_(v[i][3])) || 0, event: /^(Y|예|O|true|1)$/i.test(String(v[i][4]).trim()) };
  }
  const missing = Object.keys(PRICE_DEFAULT).filter(id => !out[id]);
  if (missing.length) {
    const rows = missing.map(id => { const p = PRICE_DEFAULT[id]; out[id] = { name: p.name, price: p.price, list: p.list, event: p.event }; return [id, p.name, p.price, p.list || '', p.event ? 'Y' : 'N']; });
    s.getRange(s.getLastRow() + 1, 1, rows.length, PRICE_H.length).setValues(rows);
  }
  return out;
}
function writePrices_(p) {
  return withLock_(() => {
    const cur = readPrices_(), rows = [];
    for (const id of Object.keys(PRICE_DEFAULT)) {
      const x = p[id] || cur[id], price = Math.round(Number(x.price) || 0), list = Math.round(Number(x.list) || 0);
      if (price <= 0 || price > 100000000 || list < 0 || list > 100000000) return { ok: false, error: 'invalid', message: (PRICE_DEFAULT[id].name) + ' 금액을 확인해 주세요.' };
      rows.push([id, PRICE_DEFAULT[id].name, price, list || '', x.event ? 'Y' : 'N']);
    }
    const s = sheet_('가격', PRICE_H);
    if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, PRICE_H.length).clearContent();
    s.getRange(2, 1, rows.length, PRICE_H.length).setValues(rows);
    return { ok: true, prices: readPrices_() };
  });
}
function memberViews_() {   // 관리자 화면: 회원권 내역(이용권·금액·시작일)과 최근 결제 금액을 함께
  const rows = bookingRows_(), all = passes_();
  return members_().map(m => { const v = memberView_(m, rows), ps = passInfo_(m, rows, all); v.passes = ps; v.amount = ps.length ? ps[ps.length - 1].amount : 0; return v; });
}
function publicMember_(m, rows) {
  const v = memberView_(m, rows), today = today_();
  const upcoming = rows.filter(r => r.memberId === m.id && r.active && r.date >= today)
    .sort((a, b) => (a.date + hm_(a.hour)).localeCompare(b.date + hm_(b.hour))).map(r => ({ date: r.date, hour: r.hour, status: r.status }));
  return { name: v.name, item: v.item, total: v.total, remaining: v.remaining, expires: v.expires, upcoming: upcoming };
}
function recalc_(memberId) {
  const m = members_().find(x => x.id === memberId); if (!m) return;
  const v = memberView_(m, bookingRows_());
  sheet_('회원', MEM_H).getRange(m.row, M.used + 1, 1, 2).setValues([[v.used, v.remaining]]);
}

/* ---------- 예약 읽기·쓰기 ---------- */
function bookingRows_() {
  const v = sheet_('예약', BOOK_H).getDataRange().getDisplayValues(), out = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i], date = dateStr_(r[C.date]), hour = hourNum_(r[C.time]);
    if (!r[C.id] || !date || hour === null) continue;
    const status = String(r[C.status]).trim() || '신청';
    out.push({ row: i + 1, id: String(r[C.id]), status: status, active: status !== '취소', date: date, hour: hour,
      phone: digits_(r[C.phone]), memberId: String(r[C.member] || ''), r: r });
  }
  return out;
}
function appendBooking_(b) {
  sheet_('예약', BOOK_H).appendRow([
    Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), b.id, b.status, "'" + b.date, "'" + hm_(b.hour), safe_(b.cat), safe_(b.item),
    Number(b.price) || '', safe_(b.name), "'" + b.phone, safe_(b.gender), safe_(b.age), safe_(b.area), b.pain === '' ? '' : Number(b.pain) || 0,
    safe_(b.med), safe_(b.medDetail), safe_(b.route), safe_(b.memo), b.agreed, safe_(b.note), b.member || '', safe_(b.region || ''), safe_(b.school || ''), '', b.calMemo || ''
  ]);
}
function cleanMemo_(v) { return safe_(String(v || '').replace(/\r/g, '').trim().slice(0, 300)); }
/* 관리자 메모: 예약에 저장하고 캘린더 일정 설명 맨 위에 넣는다 */
function setMemo_(id, memo) {
  const res = withLock_(() => {
    const me = bookingRows_().find(r => r.id === id); if (!me) return { ok: false, error: 'notfound' };
    sheet_('예약', BOOK_H).getRange(me.row, C.calMemo + 1).setValue(cleanMemo_(memo));
    return { ok: true, id: me.id };
  });
  if (res.ok) calSync_(res.id);
  return res;
}
function slotTaken_(rows, date, hour, exceptId) { return rows.some(r => r.active && r.id !== exceptId && r.date === date && r.hour === hour); }
function readBooked_() {
  const today = today_();
  return bookingRows_().filter(b => b.active && b.date >= today).map(b => ({ date: b.date, hour: b.hour }));
}
function listBookings_() {
  return bookingRows_().map(b => ({
    id: b.id, status: b.status, date: b.date, hour: b.hour, created: b.r[C.created], category: b.r[C.cat], itemName: b.r[C.item],
    name: b.r[C.name], phone: b.phone, gender: b.r[C.gender], age: b.r[C.age], area: b.r[C.area], pain: b.r[C.pain],
    med: b.r[C.med], medDetail: b.r[C.medDetail], route: b.r[C.route], memo: b.r[C.memo], note: b.r[C.note] || '', memberId: b.memberId,
    region: b.r[C.region] || '', school: b.r[C.school] || '', cal: !!String(b.r[C.cal] || '').trim(), calMemo: b.r[C.calMemo] || ''
  }));
}
function addNote_(s, row, text) {
  const cell = s.getRange(row, C.note + 1), prev = String(cell.getDisplayValue() || '');
  cell.setValue(safe_((prev ? prev + ' / ' : '') + Utilities.formatDate(new Date(), TZ, 'MM-dd HH:mm') + ' ' + text));
}
function validateSlot_(date, hour, isAdmin) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || slotStarts_().indexOf(hour) < 0) return { ok: false, error: 'invalid', message: '날짜/시간 형식 오류' };
  const today = today_();
  if (isAdmin ? date < today : date <= today) return { ok: false, error: isAdmin ? 'invalid' : 'sameday' };
  if (!isAdmin && date > openUntil_()) return { ok: false, error: 'notOpen' };
  return null;
}

/* ---------- 예약 불가 시간 ---------- */
function readBlocks_() {
  const weekly = {}, dates = {};
  const w = sheet_('주간차단', ['요일', '시간']).getDataRange().getDisplayValues();
  for (let i = 1; i < w.length; i++) {
    const d = WEEK.indexOf(String(w[i][0]).trim().charAt(0)), h = hourNum_(w[i][1]);
    if (d < 0 || h === null) continue;
    (weekly[d] = weekly[d] || []).push(h);
  }
  const dt = sheet_('날짜차단', ['날짜', '시간(비우면 하루 전체)']).getDataRange().getDisplayValues();
  for (let i = 1; i < dt.length; i++) {
    const date = dateStr_(dt[i][0]); if (!date) continue;
    if (!String(dt[i][1]).trim()) { dates[date] = 'all'; continue; }
    const h = hourNum_(dt[i][1]); if (h === null || dates[date] === 'all') continue;
    (dates[date] = dates[date] || []).push(h);
  }
  return { weekly: weekly, dates: dates };
}
function isCoachBlocked_(date, hour) {
  const b = readBlocks_(), dow = Number(Utilities.formatDate(new Date(date + 'T12:00:00+09:00'), TZ, 'u')) % 7;
  if ((b.weekly[dow] || []).indexOf(hour) >= 0) return true;
  const v = b.dates[date];
  return v === 'all' || (Array.isArray(v) && v.indexOf(hour) >= 0);
}
function writeBlocks_(b) {
  return withLock_(() => {
    const ws = sheet_('주간차단', ['요일', '시간']), ds = sheet_('날짜차단', ['날짜', '시간(비우면 하루 전체)']);
    const wRows = [], dRows = [];
    Object.keys(b.weekly || {}).forEach(d => (b.weekly[d] || []).forEach(h => { if (WEEK[d] !== undefined) wRows.push([WEEK[d], "'" + hm_(Number(h))]); }));
    Object.keys(b.dates || {}).forEach(date => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const v = b.dates[date];
      if (v === 'all') dRows.push(["'" + date, '']); else (v || []).forEach(h => dRows.push(["'" + date, "'" + hm_(Number(h))]));
    });
    [[ws, wRows], [ds, dRows]].forEach(([s, rows]) => {
      if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 2).clearContent();
      if (rows.length) s.getRange(2, 1, rows.length, 2).setValues(rows);
    });
  });
}

/* ---------- 도우미 ---------- */
function withLock_(fn) { const lock = LockService.getScriptLock(); lock.waitLock(15000); try { return fn(); } finally { lock.releaseLock(); } }
function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName(name);
  if (!s) { s = ss.insertSheet(name); s.appendRow(headers); s.setFrozenRows(1); s.getRange(1, 1, 1, headers.length).setFontWeight('bold'); }
  return s;
}
function newId_(prefix) { return prefix + Utilities.formatDate(new Date(), TZ, 'MMdd') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(); }
function digits_(v) { return String(v || '').replace(/\D/g, ''); }
function normName_(v) { return String(v || '').replace(/\s+/g, '').trim(); }
function openUntil_() {
  const n = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd-HH').split('-').map(Number);
  let y = n[0], m = n[1];
  if (n[2] > OPEN_DAY || (n[2] === OPEN_DAY && n[3] >= OPEN_AT_HOUR)) { m++; if (m > 12) { m = 1; y++; } }
  return y + '-' + pad_(m) + '-' + pad_(new Date(y, m, 0).getDate());
}
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function addDays_(ymd, n) { const t = new Date(ymd + 'T12:00:00+09:00'); t.setDate(t.getDate() + n); return Utilities.formatDate(t, TZ, 'yyyy-MM-dd'); }
function slotStarts_() { const out = []; for (let h = OPEN_HOUR; h + SLOT_MIN / 60 <= CLOSE_HOUR + 1e-9; h += SLOT_MIN / 60) out.push(h); return out; }
function pad_(n) { return String(n).padStart(2, '0'); }
function hm_(h) { return pad_(Math.floor(h)) + ':' + pad_(Math.round((h % 1) * 60)); }
function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const m = String(v).trim().match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*$/);
  return m ? m[1] + '-' + pad_(Number(m[2])) + '-' + pad_(Number(m[3])) : '';
}
function hourNum_(v) {
  const s = String(v).trim(), pm = /오후|PM/i.test(s), am = /오전|AM/i.test(s);
  const m = s.replace(/오전|오후|AM|PM/ig, '').trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*시?$/);
  if (!m) return null;
  let h = Number(m[1]); if (pm && h < 12) h += 12; if (am && h === 12) h = 0;
  return h + (m[2] ? Number(m[2]) / 60 : 0);
}
function safe_(v) { const s = String(v == null ? '' : v).slice(0, 1000); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }