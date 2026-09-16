/**************************************************************
 * 운명마스터 - 사주 해설서 자동 발송 (Google Apps Script)
 * --------------------------------------------------------------
 * 처리 흐름
 *   1) 신청서가 시트에 들어오면  → 발송상태 "입금대기"
 *   2) 입금 확인 후 발송상태를 "입금확인"으로 직접 바꾸면
 *      → 사주 계산 → Claude 해석 → PDF 생성 → 메일 발송
 *      → 발송상태 "발송완료"
 *
 * !! 주의 !!
 *   이 파일은 Apps Script 전용입니다.
 *   require( ) / module.exports / process.env 가 들어간 코드
 *   (lib/reportTemplate.js, api/generate-pdf.js)를 여기에
 *   붙여넣으면 즉시 오류가 납니다. 그 파일들은 GitHub 전용입니다.
 **************************************************************/

/*==============================================================
  0. 설정
==============================================================*/
const CONFIG = {
  // 비워두면 스프레드시트의 첫 번째 시트를 사용합니다.
  SHEET_NAME: '',

  // PDF 생성 서버 (Vercel)
  PDF_API: 'https://saju-pdf-server.vercel.app/api/generate-pdf',

  // Claude API
  CLAUDE_API: 'https://api.anthropic.com/v1/messages',
  CLAUDE_MODEL: 'claude-sonnet-5',
  MAX_TOKENS: 16000,

  BRAND_NAME: '운명마스터',
  SENDER_NAME: '운명마스터',

  // 진태양시(경도) 보정. 한국 표준시는 동경 135도 기준이라
  // 서울(약 127도)은 실제보다 약 32분 빠릅니다.
  // 사용하시는 만세력이 진태양시를 쓰면 true 로 바꾸세요.
  USE_TRUE_SOLAR_TIME: false,
  TRUE_SOLAR_OFFSET_MIN: -32,

  // 야자시 처리: 23:00~23:59 출생을 다음 날로 넘길지 여부
  // (대부분의 한국 만세력이 다음 날로 넘깁니다)
  NIGHT_ZI_NEXT_DAY: true,

  // 상태 문구
  ST_WAIT: '입금대기',
  ST_PAID: '입금확인',
  ST_DONE: '발송완료',
  ST_FAIL: '발송실패'
};

/*==============================================================
  1. 기본 상수 테이블
==============================================================*/
const GAN = ['갑','을','병','정','무','기','경','신','임','계'];
const GAN_H = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const JI  = ['자','축','인','묘','진','사','오','미','신','유','술','해'];
const JI_H = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

const GAN_ELEM = ['목','목','화','화','토','토','금','금','수','수'];
const JI_ELEM  = ['수','토','목','목','토','화','화','토','금','금','토','수'];

// 양(true) / 음(false)
const GAN_YANG = [true,false,true,false,true,false,true,false,true,false];
const JI_YANG  = [true,false,true,false,true,false,true,false,true,false];

// 지장간 : [천간index, 일수] 여기 → 중기 → 정기 순
const HIDDEN_STEMS = {
  0:  [[8,10],[9,20]],                 // 자 : 壬 癸
  1:  [[9,9],[7,3],[5,18]],            // 축 : 癸 辛 己
  2:  [[4,7],[2,7],[0,16]],            // 인 : 戊 丙 甲
  3:  [[0,10],[1,20]],                 // 묘 : 甲 乙
  4:  [[1,9],[9,3],[4,18]],            // 진 : 乙 癸 戊
  5:  [[4,7],[6,7],[2,16]],            // 사 : 戊 庚 丙
  6:  [[2,10],[5,9],[3,11]],           // 오 : 丙 己 丁
  7:  [[3,9],[1,3],[5,18]],            // 미 : 丁 乙 己
  8:  [[4,7],[8,7],[6,16]],            // 신 : 戊 壬 庚
  9:  [[6,10],[7,20]],                 // 유 : 庚 辛
  10: [[7,9],[3,3],[4,18]],            // 술 : 辛 丁 戊
  11: [[4,7],[0,7],[8,16]]             // 해 : 戊 甲 壬
};

// 12운성 (일간 기준, 지지 index 순서로 조회)
const UNSEONG_NAMES = ['장생','목욕','관대','건록','제왕','쇠','병','사','묘','절','태','양'];
// 각 천간의 장생지 (지지 index)
const JANGSAENG = [11,6,2,9,2,9,5,0,8,3];
// 음간은 역행
const GAN_REVERSE = [false,true,false,true,false,true,false,true,false,true];

// 절기 12절 (월을 가르는 절). 태양황경 315도(입춘)부터 30도씩.
const JEOLGI_NAMES = ['입춘','경칩','청명','입하','망종','소서',
                      '입추','백로','한로','입동','대설','소한'];
// 절기 index → 월지 index (입춘이면 寅=2)
function jeolgiToBranch(k) { return (k + 2) % 12; }

/*==============================================================
  2. 천문 계산 (절기 시각)
     Meeus 간이 태양황경 공식. 오차 1분 이내.
==============================================================*/
function toRad(d) { return d * Math.PI / 180; }

function jdnFromYMD(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy
           + Math.floor(yy / 4) - Math.floor(yy / 100)
           + Math.floor(yy / 400) - 32045;
}

// 그레고리력(UT) → 율리우스일
function jdFromDateUT(y, m, d, hour) {
  return jdnFromYMD(y, m, d) - 0.5 + hour / 24;
}

// 율리우스일 → {y,m,d,hour} (UT)
function dateFromJD(jd) {
  let z = Math.floor(jd + 0.5);
  let f = (jd + 0.5) - z;
  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const dd = Math.floor(365.25 * c);
  const e = Math.floor((b - dd) / 30.6001);
  const day = b - dd - Math.floor(30.6001 * e) + f;
  const month = (e < 14) ? e - 1 : e - 13;
  const year = (month > 2) ? c - 4716 : c - 4715;
  const dayInt = Math.floor(day);
  const hour = (day - dayInt) * 24;
  return { y: year, m: month, d: dayInt, hour: hour };
}

// 태양 겉보기 황경(도)
function sunApparentLongitude(jd) {
  const T = (jd - 2451545.0) / 36525.0;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M  = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C  = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(toRad(M))
           + (0.019993 - 0.000101 * T) * Math.sin(toRad(2 * M))
           + 0.000289 * Math.sin(toRad(3 * M));
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  let lambda = trueLong - 0.00569 - 0.00478 * Math.sin(toRad(omega));
  lambda = ((lambda % 360) + 360) % 360;
  return lambda;
}

/**
 * year년의 k번째 절(0=입춘)이 드는 시각을 KST Date 로 반환.
 * k=11(소한)은 year+1년 1월에 듭니다.
 */
function jeolgiDateKST(year, k) {
  const target = (315 + 30 * k) % 360;
  let gm = k + 2, gy = year;
  if (gm > 12) { gm -= 12; gy += 1; }
  let jd = jdFromDateUT(gy, gm, 6, 0);

  for (let i = 0; i < 8; i++) {
    const lon = sunApparentLongitude(jd);
    let diff = target - lon;
    while (diff >  180) diff -= 360;
    while (diff < -180) diff += 360;
    jd += diff / 0.9856473;
  }
  // dateFromJD 는 UT 달력값을 주므로 Date.UTC 로 실제 시각을 만듭니다.
  // (스크립트 시간대가 Asia/Seoul 이므로 이후 비교·표시는 자동으로 KST)
  const utc = dateFromJD(jd);
  return new Date(Date.UTC(utc.y, utc.m - 1, utc.d) + utc.hour * 3600000);
}

/** 절입 경계 근처(기본 30분 이내) 출생인지 확인 */
function nearJeolgiBoundary_(dt, jg, minutes) {
  const w = (minutes || 30) * 60000;
  return (Math.abs(dt.getTime() - jg.start.getTime()) < w) ||
         (Math.abs(jg.next.getTime() - dt.getTime()) < w);
}

/** 해당 시각이 속한 절기 구간을 찾아 {year, k, start, next} 반환 */
function findJeolgi(dt) {
  let y = dt.getFullYear();
  // 입춘 이전이면 전년도 절기표를 본다
  const ipchun = jeolgiDateKST(y, 0);
  if (dt < ipchun) y -= 1;

  for (let k = 11; k >= 0; k--) {
    const start = jeolgiDateKST(y, k);
    if (dt >= start) {
      const next = (k === 11) ? jeolgiDateKST(y + 1, 0) : jeolgiDateKST(y, k + 1);
      return { year: y, k: k, start: start, next: next };
    }
  }
  // 이론상 도달하지 않음
  const start = jeolgiDateKST(y, 0);
  return { year: y, k: 0, start: start, next: jeolgiDateKST(y, 1) };
}


/*==============================================================
  2-b. 음력 → 양력 변환 (한국천문연구원 KASI OpenAPI)
==============================================================*/
const KASI_URL = 'http://apis.data.go.kr/B090041/openapi/service/LrsrCldInfoService/getSolCalInfo';

function lunarToSolar_(y, m, d, leap) {
  const key = PropertiesService.getScriptProperties().getProperty('KASI_API_KEY');
  if (!key) throw new Error('스크립트 속성에 KASI_API_KEY 가 없습니다.');

  const cache = CacheService.getScriptCache();
  const ck = 'L2S_' + y + '_' + m + '_' + d + '_' + (leap ? 'L' : 'N');
  const hit = cache.get(ck);
  if (hit) { const p = hit.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }

  const url = KASI_URL
    + '?serviceKey=' + encodeURIComponent(key)
    + '&lunYear=' + y
    + '&lunMonth=' + ('0' + m).slice(-2)
    + '&lunDay=' + ('0' + d).slice(-2)
    + '&leapMonth=' + (leap ? '윤' : '평');

  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const xml = res.getContentText();
  if (res.getResponseCode() !== 200) {
    throw new Error('KASI 음양력 API 오류 ' + res.getResponseCode());
  }
  if (/SERVICE_KEY_IS_NOT_REGISTERED|LIMITED_NUMBER/.test(xml)) {
    throw new Error('KASI 인증키 오류입니다. Decoding 키가 맞는지 확인해 주세요.');
  }

  const pick = function (tag) {
    const mm = xml.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>'));
    return mm ? mm[1].trim() : '';
  };
  const sy = parseInt(pick('solYear'), 10);
  const sm = parseInt(pick('solMonth'), 10);
  const sd = parseInt(pick('solDay'), 10);
  if (!sy || !sm || !sd) {
    throw new Error('음력 ' + y + '-' + m + '-' + d + (leap ? '(윤달)' : '')
      + ' 변환 실패. 윤달 여부가 맞는지 확인해 주세요.');
  }
  cache.put(ck, sy + '-' + sm + '-' + sd, 21600);
  return { y: sy, m: sm, d: sd };
}

/*==============================================================
  3. 사주 원국 계산
==============================================================*/

/** 시지 index (0=자) - 23시~01시 자시, 30분 경계 없음(2시간 단위) */
function hourBranchIndex(h, min) {
  const t = h * 60 + min;
  if (t >= 23 * 60 || t < 60) return 0;          // 자
  return Math.floor((t - 60) / 120) + 1;
}

/**
 * 사주 계산
 * @param {Date} birth  출생 일시 (KST, 양력)
 * @return {Object}
 */
function calcSaju(birth) {
  // 진태양시 보정
  let dt = new Date(birth.getTime());
  if (CONFIG.USE_TRUE_SOLAR_TIME) {
    dt = new Date(dt.getTime() + CONFIG.TRUE_SOLAR_OFFSET_MIN * 60000);
  }

  const jg = findJeolgi(dt);

  // --- 년주 : 입춘 기준 ---
  const sajuYear = jg.year;
  const yStem   = ((sajuYear - 4) % 10 + 10) % 10;
  const yBranch = ((sajuYear - 4) % 12 + 12) % 12;

  // --- 월주 : 절기 기준 ---
  const mBranch = jeolgiToBranch(jg.k);
  const mStem   = ((yStem % 5) * 2 + 2 + jg.k) % 10;

  // --- 일주 : 율리우스일 기준 (야자시 처리) ---
  let dY = dt.getFullYear(), dM = dt.getMonth() + 1, dD = dt.getDate();
  if (CONFIG.NIGHT_ZI_NEXT_DAY && dt.getHours() >= 23) {
    const nx = new Date(dt.getTime() + 24 * 3600000);
    dY = nx.getFullYear(); dM = nx.getMonth() + 1; dD = nx.getDate();
  }
  const jdn = jdnFromYMD(dY, dM, dD);
  const dayIdx  = ((jdn - 11) % 60 + 60) % 60;
  const dStem   = dayIdx % 10;
  const dBranch = dayIdx % 12;

  // --- 시주 ---
  const hBranch = hourBranchIndex(dt.getHours(), dt.getMinutes());
  const hStem   = ((dStem % 5) * 2 + hBranch) % 10;

  const mk = function (s, b) {
    return {
      stem: s, branch: b,
      stemHangul: GAN[s], stemHanja: GAN_H[s],
      branchHangul: JI[b], branchHanja: JI_H[b],
      stemElem: GAN_ELEM[s], branchElem: JI_ELEM[b],
      hidden: HIDDEN_STEMS[b].map(function (x) {
        return { idx: x[0], hangul: GAN[x[0]], hanja: GAN_H[x[0]],
                 elem: GAN_ELEM[x[0]], days: x[1] };
      })
    };
  };

  return {
    birth: dt,
    jeolgi: jg,
    sajuYear: sajuYear,
    pillars: {
      year:  mk(yStem, yBranch),
      month: mk(mStem, mBranch),
      day:   mk(dStem, dBranch),
      hour:  mk(hStem, hBranch)
    }
  };
}

/*--------------------------------------------------------------
  십성
--------------------------------------------------------------*/
const SAENG = { '목':'화','화':'토','토':'금','금':'수','수':'목' };
const GEUK  = { '목':'토','토':'수','수':'화','화':'금','금':'목' };

function tenGod(dayStem, targetElem, targetYang) {
  const de = GAN_ELEM[dayStem];
  const dy = GAN_YANG[dayStem];
  const same = (dy === targetYang);
  if (de === targetElem)              return same ? '비견' : '겁재';
  if (SAENG[de] === targetElem)       return same ? '식신' : '상관';
  if (GEUK[de]  === targetElem)       return same ? '편재' : '정재';
  if (GEUK[targetElem] === de)        return same ? '편관' : '정관';
  if (SAENG[targetElem] === de)       return same ? '편인' : '정인';
  return '-';
}

function tenGodOfStem(dayStem, s)   { return tenGod(dayStem, GAN_ELEM[s], GAN_YANG[s]); }
function tenGodOfBranch(dayStem, b) { return tenGod(dayStem, JI_ELEM[b],  JI_YANG[b]);  }

/*--------------------------------------------------------------
  12운성
--------------------------------------------------------------*/
function twelveUnseong(stem, branch) {
  const start = JANGSAENG[stem];
  let d;
  if (GAN_REVERSE[stem]) d = (start - branch + 12) % 12;
  else                   d = (branch - start + 12) % 12;
  return UNSEONG_NAMES[d];
}

/*--------------------------------------------------------------
  통근 : 사주 내 모든 천간에 대해, 지지의 "지장간"에
         같은 오행이 있는지로 판단 (사용자 지정 규칙)
--------------------------------------------------------------*/
function checkTonggeun(saju) {
  const pos = ['year','month','day','hour'];
  const posName = { year:'년', month:'월', day:'일', hour:'시' };
  const result = [];

  pos.forEach(function (p) {
    const stem = saju.pillars[p].stem;
    const elem = GAN_ELEM[stem];
    const roots = [];
    pos.forEach(function (q) {
      const b = saju.pillars[q].branch;
      HIDDEN_STEMS[b].forEach(function (h) {
        if (GAN_ELEM[h[0]] === elem) {
          roots.push(posName[q] + '지 ' + JI[b] + '(' + JI_H[b] + ') 중 '
                     + GAN[h[0]] + GAN_H[h[0]]);
        }
      });
    });
    result.push({
      position: posName[p] + '간',
      stem: GAN[stem] + GAN_H[stem],
      elem: elem,
      rooted: roots.length > 0,
      roots: roots
    });
  });
  return result;
}

/*--------------------------------------------------------------
  오행 분포 (천간 + 지지본기 + 지장간 가중)
--------------------------------------------------------------*/
function elementCount(saju) {
  const cnt = { 목:0, 화:0, 토:0, 금:0, 수:0 };
  const surface = { 목:0, 화:0, 토:0, 금:0, 수:0 };
  ['year','month','day','hour'].forEach(function (p) {
    const pl = saju.pillars[p];
    cnt[GAN_ELEM[pl.stem]] += 1;  surface[GAN_ELEM[pl.stem]] += 1;
    cnt[JI_ELEM[pl.branch]] += 1; surface[JI_ELEM[pl.branch]] += 1;
    pl.hidden.forEach(function (h) { cnt[h.elem] += 0.3; });
  });
  Object.keys(cnt).forEach(function (k) { cnt[k] = Math.round(cnt[k] * 10) / 10; });
  return { weighted: cnt, surface: surface };
}

/*--------------------------------------------------------------
  대운
--------------------------------------------------------------*/
function calcDaewoon(saju, isMale) {
  const yStemYang = GAN_YANG[saju.pillars.year.stem];
  const forward = (yStemYang === isMale);   // 양남·음녀 순행

  const dt = saju.birth;
  let diffMs;
  if (forward) diffMs = saju.jeolgi.next.getTime() - dt.getTime();
  else         diffMs = dt.getTime() - saju.jeolgi.start.getTime();

  const days = diffMs / 86400000;
  let num = Math.round(days / 3);
  if (num < 1) num = 1;

  // 사용자 만세력 기준(세는나이, 출생 즉시 1세)에 맞춰 +1
  const startAge = num + 1;

  const list = [];
  let s = saju.pillars.month.stem;
  let b = saju.pillars.month.branch;
  for (let i = 0; i < 9; i++) {
    if (forward) { s = (s + 1) % 10; b = (b + 1) % 12; }
    else         { s = (s + 9) % 10; b = (b + 11) % 12; }
    const age = startAge + i * 10;
    list.push({
      order: i + 1,
      ageFrom: age,
      ageTo: age + 9,
      yearFrom: saju.birth.getFullYear() + age - 1,
      stemHangul: GAN[s], stemHanja: GAN_H[s],
      branchHangul: JI[b], branchHanja: JI_H[b],
      ganji: GAN[s] + JI[b] + '(' + GAN_H[s] + JI_H[b] + ')',
      stemTenGod: tenGodOfStem(saju.pillars.day.stem, s),
      branchTenGod: tenGodOfBranch(saju.pillars.day.stem, b),
      unseong: twelveUnseong(saju.pillars.day.stem, b),
      element: GAN_ELEM[s] + '·' + JI_ELEM[b]
    });
  }
  return { forward: forward, number: num, startAge: startAge, list: list };
}

/*==============================================================
  4. 신살 / 합충형파해
==============================================================*/

// 삼합국 : 지지 index → 생지 index
const SAMHAP_START = {
  11:11, 3:11, 7:11,   // 해묘미 목국
  2:2,   6:2, 10:2,    // 인오술 화국
  5:5,   9:5, 1:5,     // 사유축 금국
  8:8,   0:8, 4:8      // 신자진 수국
};
const SINSAL12 = ['겁살','재살','천살','지살','연살','월살',
                  '망신','장성','반안','역마','육해','화개'];

/** 기준지지(년지 또는 일지) 대비 대상지지의 12신살 */
function sinsal12(baseBranch, targetBranch) {
  const start = SAMHAP_START[baseBranch];
  const gyeopsal = (start - 3 + 12) % 12;
  const d = (targetBranch - gyeopsal + 12) % 12;
  return SINSAL12[d];
}

// 천을귀인 (일간 → 지지 배열)
const CHEONEUL = {
  0:[1,7], 4:[1,7], 6:[1,7],     // 갑무경 - 축미
  1:[0,8], 5:[0,8],              // 을기   - 자신
  2:[11,9], 3:[11,9],            // 병정   - 해유
  8:[5,3], 9:[5,3],              // 임계   - 사묘
  7:[6,2]                        // 신     - 오인
};
// 문창귀인
const MUNCHANG = { 0:5, 1:6, 2:8, 4:8, 3:9, 5:9, 6:11, 7:0, 8:2, 9:3 };
// 양인
const YANGIN = { 0:3, 1:4, 2:6, 4:6, 3:7, 5:7, 6:9, 7:10, 8:0, 9:1 };
// 괴강일주 (간지 문자열)
const GOEGANG = ['경진','경술','임진','무술','임술'];
// 백호대살
const BAEKHO = ['갑진','을미','병술','정축','무진','임술','계축'];
// 원진
const WONJIN = { 0:7, 7:0, 1:6, 6:1, 2:9, 9:2, 3:8, 8:3, 4:11, 11:4, 5:10, 10:5 };
// 귀문관살
const GWIMUN = { 0:9, 9:0, 1:6, 6:1, 2:7, 7:2, 3:8, 8:3, 4:11, 11:4, 5:10, 10:5 };

/** 공망 : 일주 기준 */
function gongmang(dayIdx60) {
  const sun = Math.floor(dayIdx60 / 10);          // 0~5 순
  const b1 = (10 + sun * 10) % 12;
  const b2 = (11 + sun * 10) % 12;
  return [b1, b2];
}

/** 기둥별 신살 목록 */
function calcSinsal(saju) {
  const P = saju.pillars;
  const dayStem = P.day.stem;
  const yBranch = P.year.branch;
  const dBranch = P.day.branch;
  // 일주의 60갑자 index 를 천간·지지로부터 역산 → 공망 산출
  let dayIdx60 = 0;
  for (let i = 0; i < 60; i++) {
    if (i % 10 === P.day.stem && i % 12 === P.day.branch) { dayIdx60 = i; break; }
  }
  const gm = gongmang(dayIdx60);

  const pos = ['year','month','day','hour'];
  const posName = { year:'년주', month:'월주', day:'일주', hour:'시주' };
  const out = {};

  pos.forEach(function (p) {
    const b = saju.pillars[p].branch;
    const s = saju.pillars[p].stem;
    const arr = [];

    arr.push(sinsal12(yBranch, b) + '(년지기준)');
    const byDay = sinsal12(dBranch, b);
    if (byDay !== sinsal12(yBranch, b)) arr.push(byDay + '(일지기준)');

    if (CHEONEUL[dayStem] && CHEONEUL[dayStem].indexOf(b) >= 0) arr.push('천을귀인');
    if (MUNCHANG[dayStem] === b) arr.push('문창귀인');
    if (YANGIN[dayStem] === b)   arr.push('양인');
    if (gm.indexOf(b) >= 0)      arr.push('공망');
    if (WONJIN[dBranch] === b && p !== 'day') arr.push('원진');
    if (GWIMUN[dBranch] === b && p !== 'day') arr.push('귀문관살');

    const gj = GAN[s] + JI[b];
    if (GOEGANG.indexOf(gj) >= 0) arr.push('괴강');
    if (BAEKHO.indexOf(gj) >= 0)  arr.push('백호대살');

    out[p] = { name: posName[p], list: arr };
  });

  out.gongmangBranches = gm.map(function (x) { return JI[x] + JI_H[x]; });
  return out;
}

/*--------------------------------------------------------------
  합·충·형·파·해
--------------------------------------------------------------*/
const YUKHAP = { 0:1, 1:0, 2:11, 11:2, 3:10, 10:3, 4:9, 9:4, 5:8, 8:5, 6:7, 7:6 };
const CHUNG  = { 0:6, 6:0, 1:7, 7:1, 2:8, 8:2, 3:9, 9:3, 4:10, 10:4, 5:11, 11:5 };
const PA     = { 0:9, 9:0, 1:4, 4:1, 2:11, 11:2, 3:6, 6:3, 5:8, 8:5, 7:10, 10:7 };
const HAE    = { 0:7, 7:0, 1:6, 6:1, 2:5, 5:2, 3:4, 4:3, 8:11, 11:8, 9:10, 10:9 };
const GAN_HAP = { 0:5, 5:0, 1:6, 6:1, 2:7, 7:2, 3:8, 8:3, 4:9, 9:4 };
const GAN_HAP_ELEM = { '갑기':'토','을경':'금','병신':'수','정임':'목','무계':'화' };

const SAMHAP_SETS = [
  { br:[11,3,7], elem:'목' }, { br:[2,6,10], elem:'화' },
  { br:[5,9,1],  elem:'금' }, { br:[8,0,4],  elem:'수' }
];
const BANGHAP_SETS = [
  { br:[2,3,4],  elem:'목', name:'인묘진 목방합' },
  { br:[5,6,7],  elem:'화', name:'사오미 화방합' },
  { br:[8,9,10], elem:'금', name:'신유술 금방합' },
  { br:[11,0,1], elem:'수', name:'해자축 수방합' }
];

function calcRelations(saju) {
  const pos = ['year','month','day','hour'];
  const label = { year:'년', month:'월', day:'일', hour:'시' };
  const br = pos.map(function (p) { return saju.pillars[p].branch; });
  const st = pos.map(function (p) { return saju.pillars[p].stem; });
  const res = { ganhap:[], yukhap:[], samhap:[], banghap:[], chung:[], hyeong:[], pa:[], hae:[] };

  // 천간합
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    if (GAN_HAP[st[i]] === st[j]) {
      const key = GAN[Math.min(st[i],st[j])] + GAN[Math.max(st[i],st[j])];
      res.ganhap.push(label[pos[i]] + '간 ' + GAN[st[i]] + ' + ' + label[pos[j]] + '간 ' + GAN[st[j]]
                      + ' 합 → ' + (GAN_HAP_ELEM[key] || ''));
    }
  }

  // 지지 관계
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const a = br[i], b = br[j];
    const tag = label[pos[i]] + '지 ' + JI[a] + ' ↔ ' + label[pos[j]] + '지 ' + JI[b];
    if (YUKHAP[a] === b) res.yukhap.push(tag + ' 육합');
    if (CHUNG[a]  === b) res.chung.push(tag + ' 충');
    if (PA[a]     === b) res.pa.push(tag + ' 파');
    if (HAE[a]    === b) res.hae.push(tag + ' 해');
    if (a === b && [4,6,9,11].indexOf(a) >= 0) res.hyeong.push(tag + ' 자형');
    if ((a === 0 && b === 3) || (a === 3 && b === 0)) res.hyeong.push(tag + ' 상형(자묘형)');
  }

  // 삼형 : 두 글자만 겹쳐도 성립 (사용자 지정 규칙)
  const trio = [
    { set:[1,10,7],  name:'축술미 삼형' },
    { set:[2,5,8],   name:'인사신 삼형' }
  ];
  trio.forEach(function (t) {
    const found = t.set.filter(function (x) { return br.indexOf(x) >= 0; });
    if (found.length >= 2) {
      const names = found.map(function (x) { return JI[x] + JI_H[x]; }).join('·');
      res.hyeong.push(names + ' → ' + t.name
        + (found.length === 3 ? ' (완전 성립)' : ' (2자 성립)'));
    }
  });

  // 삼합 / 반합
  SAMHAP_SETS.forEach(function (s) {
    const found = s.br.filter(function (x) { return br.indexOf(x) >= 0; });
    if (found.length === 3) {
      res.samhap.push(found.map(function (x) { return JI[x]; }).join('') + ' 삼합 → ' + s.elem + '국');
    } else if (found.length === 2 && found.indexOf(s.br[1]) >= 0) {
      res.samhap.push(found.map(function (x) { return JI[x]; }).join('') + ' 반합 → ' + s.elem + '기 강화');
    }
  });

  // 방합
  BANGHAP_SETS.forEach(function (s) {
    const found = s.br.filter(function (x) { return br.indexOf(x) >= 0; });
    if (found.length === 3) res.banghap.push(s.name + ' 완성');
  });

  return res;
}


/*==============================================================
  4-b. 십간론(적천수 계열) · 궁통보감 조후
  --------------------------------------------------------------
  ※ 아래 두 표는 해석의 "참고 근거"로 Claude에게 전달됩니다.
     판본에 따라 표현이 다를 수 있으니 검수 후 문구를 고쳐 쓰세요.
==============================================================*/

// 십간 특성 (적천수 계열 관점)
const SIPGAN_NATURE = {
  '갑': '곧게 위로 뻗는 큰 나무의 기운입니다. 시작하고 주도하는 힘이 강하고 뜻이 곧으나, 한번 꺾이면 다시 굽히기 어렵습니다. 뿌리내릴 흙(토)과 자라날 물(수)이 함께 있어야 크게 자라고, 금이 지나치면 상합니다.',
  '을': '덩굴처럼 휘어지며 뻗는 풀의 기운입니다. 부드럽고 유연해 어떤 환경에도 적응하며, 남의 힘을 빌려 올라서는 데 능합니다. 겉은 순해 보여도 속으로는 질기게 버팁니다. 따뜻한 화와 기댈 자리가 있으면 살아납니다.',
  '병': '만물을 비추는 태양의 기운입니다. 밝고 거침없이 드러내며 숨기지 못합니다. 베푸는 데 인색하지 않으나 지속성이 약하고, 지나치면 태워버립니다. 물(임수)을 만나야 빛이 더 살아납니다.',
  '정': '등불과 화롯불의 기운입니다. 은은하고 오래가며 안으로 밝습니다. 세심하고 정성스러우나 예민한 면이 있습니다. 태울 땔감(목)이 있어야 꺼지지 않고, 습한 기운이 지나치면 약해집니다.',
  '무': '넓은 들과 큰 산의 기운입니다. 무겁고 흔들리지 않으며 남을 품는 도량이 있습니다. 다만 둔하고 고집스러워질 수 있습니다. 물을 가두고 나무를 키워야 쓰임이 생기며, 메마르면 아무것도 자라지 못합니다.',
  '기': '밭흙과 정원의 기운입니다. 부드럽고 낮아 잘 받아들이며 기르는 데 능합니다. 실속 있고 꼼꼼하나 소극적일 수 있습니다. 적당한 물기와 볕이 있어야 곡식을 냅니다.',
  '경': '제련되지 않은 쇠와 도끼의 기운입니다. 강하고 결단력 있으며 맺고 끊음이 분명합니다. 거칠고 급한 면이 있습니다. 불(정화)로 단련되고 물(임수)로 씻겨야 그릇이 되며, 그냥 두면 무디거나 상하게 합니다.',
  '신': '이미 다듬어진 보석과 칼날의 기운입니다. 섬세하고 예리하며 자존심이 높습니다. 깔끔하나 상처를 잘 받습니다. 맑은 물(임수)에 씻기면 빛나고, 거센 불을 만나면 오히려 훼손됩니다.',
  '임': '바다와 큰 강의 기운입니다. 넓고 깊으며 막힘없이 흐릅니다. 포용력과 지혜가 있으나 종잡기 어렵고 넘치면 범람합니다. 둑(무토)이 있어야 쓰임이 생깁니다.',
  '계': '이슬과 빗물, 시냇물의 기운입니다. 맑고 고요하며 스며들듯 파고듭니다. 총명하고 감수성이 깊으나 약하고 흔들리기 쉽습니다. 메마른 땅을 적시는 데 큰 공이 있습니다.'
};

/**
 * 궁통보감(난강망) 조후 요약 — 일간 × 월지
 * 값: [조후용신·희신 요약, 핵심 취지]
 * 월지 키는 인·묘·진·사·오·미·신·유·술·해·자·축
 */
const JOHU_TABLE = {
  '갑': { '인':'병화로 따뜻하게 하고 계수로 적신다', '묘':'경금으로 다듬고 병화·무토를 곁들인다', '진':'경금으로 베고 임수로 적신다',
          '사':'계수로 목마름을 풀고 정화를 경계한다', '오':'계수가 급하고 정화가 지나치면 마른다', '미':'계수로 적시고 경금으로 다듬는다',
          '신':'정화로 경금을 제어하고 임수로 돕는다', '유':'정화가 긴요하고 병화로 온기를 더한다', '술':'갑목과 임계수로 마른 흙을 적신다',
          '해':'경금으로 다듬고 병화로 언 기운을 녹인다', '자':'병화가 가장 급하고 무토로 물을 막는다', '축':'병화로 언 나무를 녹이는 것이 우선이다' },
  '을': { '인':'병화로 따뜻하게 하고 계수로 적신다', '묘':'병화를 향하고 계수로 뿌리를 적신다', '진':'병화와 계수를 함께 쓴다',
          '사':'계수가 긴요하고 신금이 계수를 돕는다', '오':'계수가 급하니 임수라도 있어야 한다', '미':'계수로 적시고 병화로 기른다',
          '신':'병화로 온기를 주고 계수로 적신다', '유':'계수로 씻고 병화로 온기를 더한다', '술':'계수로 마른 흙을 적시고 갑목에 기댄다',
          '해':'병화가 긴요하고 무토로 물을 막는다', '자':'병화로 언 기운을 녹이는 것이 급하다', '축':'병화가 가장 급하다' },
  '병': { '인':'임수로 빛을 살리고 경금이 임수를 돕는다', '묘':'임수가 긴요하고 기토를 경계한다', '진':'임수로 맑게 하고 갑목으로 흙을 소통시킨다',
          '사':'임수가 급하고 경금으로 수원을 만든다', '오':'임수와 경금으로 지나친 화를 제어한다', '미':'임수가 긴요하고 경금으로 돕는다',
          '신':'임수로 빛을 살리고 무토로 물을 조절한다', '유':'임수로 맑히고 계수는 꺼린다', '술':'갑목으로 흙을 소통시키고 임수를 쓴다',
          '해':'갑목·무토로 물을 다스리고 임수를 절제한다', '자':'임수가 넘치니 무토로 막고 갑목을 쓴다', '축':'임수와 갑목으로 언 흙을 소통시킨다' },
  '정': { '인':'갑목으로 불을 이어가고 경금으로 갑목을 쪼갠다', '묘':'경금으로 습한 을목을 정리한다', '진':'갑목이 긴요하고 경금으로 돕는다',
          '사':'갑목과 경금을 함께 쓴다', '오':'임수로 열기를 식히고 경금으로 돕는다', '미':'갑목으로 불을 잇고 임수로 식힌다',
          '신':'갑목이 긴요하고 경금으로 쪼갠다', '유':'갑목으로 불을 잇고 병화로 온기를 돕는다', '술':'갑목과 경금을 함께 쓴다',
          '해':'갑목이 긴요하고 경금으로 돕는다', '자':'갑목과 경금으로 언 기운 속에 불을 살린다', '축':'갑목이 급하고 경금으로 쪼갠다' },
  '무': { '인':'병화로 따뜻하게 하고 갑목으로 소통시키며 계수로 적신다', '묘':'병화·갑목·계수를 함께 쓴다', '진':'갑목으로 소통시키고 병화·계수를 곁들인다',
          '사':'갑목과 병화를 쓰되 계수로 적셔야 한다', '오':'임수가 긴요하고 갑목으로 소통시킨다', '미':'계수로 적시고 병화·갑목을 곁들인다',
          '신':'병화로 온기를 주고 계수로 적신다', '유':'병화가 긴요하고 계수로 적신다', '술':'갑목으로 소통시키고 병화·계수를 쓴다',
          '해':'갑목과 병화로 언 흙을 소통시키고 녹인다', '자':'병화가 급하고 갑목으로 돕는다', '축':'병화가 가장 급하고 갑목으로 소통시킨다' },
  '기': { '인':'병화로 녹이고 경금으로 갑목을 제어하며 갑목으로 소통시킨다', '묘':'갑목으로 소통시키고 병화·계수를 쓴다', '진':'병화·계수·갑목을 함께 쓴다',
          '사':'계수가 긴요하고 병화로 온기를 유지한다', '오':'계수가 급하고 병화를 절제한다', '미':'계수로 적시고 병화를 곁들인다',
          '신':'병화로 온기를 주고 계수로 적신다', '유':'병화가 긴요하다', '술':'갑목으로 소통시키고 병화·계수를 쓴다',
          '해':'병화로 녹이고 무토로 물을 막는다', '자':'병화가 가장 급하고 무토로 돕는다', '축':'병화로 언 흙을 녹이는 것이 우선이다' },
  '경': { '인':'무토·병화로 따뜻하게 하고 갑목·임수를 곁들인다', '묘':'정화로 제련하고 갑목으로 돕는다', '진':'갑목으로 흙을 소통시키고 정화로 제련한다',
          '사':'임수로 씻고 무토·병화를 조절한다', '오':'임수가 긴요하고 계수로 돕는다', '미':'정화로 제련하고 갑목으로 돕는다',
          '신':'정화로 제련하고 갑목으로 돕는다', '유':'정화가 긴요하고 갑목·병화를 곁들인다', '술':'갑목으로 흙을 덜고 임수로 씻는다',
          '해':'정화로 언 쇠를 녹이고 병화로 온기를 준다', '자':'정화와 병화가 함께 필요하다', '축':'병화로 녹이고 정화로 제련한다' },
  '신': { '인':'기토로 기르고 임수로 씻으며 경금으로 돕는다', '묘':'임수로 씻는 것이 우선이다', '진':'임수가 긴요하고 갑목으로 흙을 소통시킨다',
          '사':'임수로 씻고 갑목으로 무토를 제어한다', '오':'임수와 기토로 뜨거운 화를 막는다', '미':'임수가 긴요하고 경금으로 돕는다',
          '신':'임수로 씻고 무토·갑목을 곁들인다', '유':'임수로 씻는 것이 가장 긴요하다', '술':'임수로 씻고 갑목으로 흙을 덜어낸다',
          '해':'임수로 씻되 병화로 온기를 준다', '자':'병화로 언 기운을 녹이고 임수로 씻는다', '축':'병화가 급하고 임수로 씻는다' },
  '임': { '인':'경금으로 수원을 만들고 병화로 따뜻하게 한다', '묘':'무토로 막고 경금으로 수원을 만든다', '진':'갑목으로 흙을 소통시키고 경금으로 돕는다',
          '사':'임수가 약하니 경금·계수로 돕는다', '오':'계수와 경금으로 마른 물길을 채운다', '미':'신금·계수로 수원을 만들고 갑목을 곁들인다',
          '신':'무토로 막고 정화로 경금을 제어한다', '유':'갑목으로 흙을 소통시키고 무토로 막는다', '술':'갑목과 병화를 함께 쓴다',
          '해':'무토로 막고 병화로 온기를 준다', '자':'무토로 막고 병화가 반드시 있어야 한다', '축':'병화로 녹이고 무토·정화를 곁들인다' },
  '계': { '인':'신금으로 수원을 만들고 병화로 따뜻하게 한다', '묘':'경금·신금으로 수원을 만든다', '진':'병화로 따뜻하게 하고 신금·갑목을 곁들인다',
          '사':'신금이 긴요하고 경금으로 돕는다', '오':'경금·신금·임수로 마른 기운을 채운다', '미':'경금·신금·임수를 함께 쓴다',
          '신':'정화로 경금을 제어하고 갑목을 곁들인다', '유':'신금으로 수원을 만들고 병화로 온기를 준다', '술':'신금·갑목·임계수를 함께 쓴다',
          '해':'경금·신금으로 수원을 만들고 무토로 조절한다', '자':'병화가 반드시 필요하고 신금으로 돕는다', '축':'병화로 언 물을 녹이는 것이 급하다' }
};

/** 일간·월지로 십간론 + 조후 참고문을 만든다 */
function buildSipganJohuBlock_(saju) {
  const ds = GAN[saju.pillars.day.stem];
  const mb = JI[saju.pillars.month.branch];
  const nature = SIPGAN_NATURE[ds] || '';
  const johu = (JOHU_TABLE[ds] && JOHU_TABLE[ds][mb]) || '';

  let t = '\n[십간론 — 일간 ' + ds + ' (적천수 계열 관점)]\n' + nature + '\n';
  if (johu) {
    t += '\n[궁통보감 조후 — ' + ds + '일간 ' + mb + '월]\n' + johu + '\n';
  }
  return t;
}

/*==============================================================
  5. 시트 유틸 / 입력값 파싱
==============================================================*/
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (CONFIG.SHEET_NAME) {
    const s = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (s) return s;
  }
  return ss.getSheets()[0];
}

function headerMap_(sheet) {
  const hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  hdr.forEach(function (h, i) { map[String(h).trim()] = i + 1; });
  return map;
}

function col_(map, name) {
  if (map[name]) return map[name];
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].replace(/\s/g, '') === name.replace(/\s/g, '')) return map[keys[i]];
  }
  return 0;
}

/** 다양한 형식의 날짜 입력을 {y,m,d} 로 */
function parseDate_(v) {
  if (v instanceof Date) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  const s = String(v).trim();
  let m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  throw new Error('생년월일 형식을 읽을 수 없습니다: ' + s);
}

const SIJI_TEXT = { '자':0,'축':1,'인':2,'묘':3,'진':4,'사':5,
                    '오':6,'미':7,'신':8,'유':9,'술':10,'해':11 };

/** 시각 입력을 {h,min} 으로. 모르면 null */
function parseTime_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return { h: v.getHours(), min: v.getMinutes() };
  const s = String(v).trim();
  if (/모름|미상|불명/.test(s)) return null;

  // 사시(巳時) 같은 표기
  const jm = s.match(/([자축인묘진사오미신유술해])\s*시/);
  if (jm) { const bi = SIJI_TEXT[jm[1]]; return { h: (bi === 0 ? 0 : bi * 2 - 1), min: 30 }; }

  let m = s.match(/(오전|오후|AM|PM|am|pm)?\s*(\d{1,2})\s*[:시]\s*(\d{1,2})?/);
  if (m) {
    let h = +m[2]; const mi = m[3] ? +m[3] : 0;
    if (/오후|PM|pm/.test(m[1] || '') && h < 12) h += 12;
    if (/오전|AM|am/.test(m[1] || '') && h === 12) h = 0;
    return { h: h, min: mi };
  }
  m = s.match(/^(\d{1,2})(\d{2})$/);
  if (m) return { h: +m[1], min: +m[2] };
  return null;
}

function isLunar_(v) { return /음력/.test(String(v || '')); }
function isYundal_(v) { return /윤/.test(String(v || '')) && !/평달|아니/.test(String(v || '')); }
function isMale_(v)  { return /남/.test(String(v || '')); }

function fmtKDate_(d) {
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy년 M월 d일');
}

/*==============================================================
  6. 프롬프트 생성
==============================================================*/
function pillarText_(saju) {
  const P = saju.pillars;
  const ds = P.day.stem;
  const order = [['시',P.hour],['일',P.day],['월',P.month],['년',P.year]];
  let out = '';
  order.forEach(function (o) {
    const p = o[1];
    const hid = p.hidden.map(function (h) {
      return h.hangul + h.hanja + '(' + h.elem + '/' + tenGodOfStem(ds, h.idx) + ')';
    }).join(', ');
    out += o[0] + '주: ' + p.stemHangul + p.branchHangul
        + '(' + p.stemHanja + p.branchHanja + ')'
        + ' | 천간 ' + p.stemHangul + '=' + p.stemElem + '/' + tenGodOfStem(ds, p.stem)
        + ' | 지지 ' + p.branchHangul + '=' + p.branchElem + '/' + tenGodOfBranch(ds, p.branch)
        + ' | 12운성 ' + twelveUnseong(ds, p.branch)
        + ' | 지장간 ' + hid + '\n';
  });
  return out;
}

function buildAnalysisBlock_(saju, daewoon, sinsal, rel, tong, elem) {
  let t = '';
  t += '[사주 원국]\n' + pillarText_(saju) + '\n';
  t += '[일간] ' + GAN[saju.pillars.day.stem] + GAN_H[saju.pillars.day.stem]
     + ' (' + GAN_ELEM[saju.pillars.day.stem] + ', '
     + (GAN_YANG[saju.pillars.day.stem] ? '양' : '음') + ')\n';
  t += '[일주] ' + GAN[saju.pillars.day.stem] + JI[saju.pillars.day.branch]
     + '(' + GAN_H[saju.pillars.day.stem] + JI_H[saju.pillars.day.branch] + ') / 12운성 '
     + twelveUnseong(saju.pillars.day.stem, saju.pillars.day.branch) + '\n';
  t += '[월령] ' + JEOLGI_NAMES[saju.jeolgi.k] + ' 이후 → 월지 '
     + JI[saju.pillars.month.branch] + JI_H[saju.pillars.month.branch] + '\n\n';

  t += '[오행 분포] 표면(천간+지지본기): ';
  t += Object.keys(elem.surface).map(function (k) { return k + ' ' + elem.surface[k]; }).join(', ');
  t += '\n[오행 분포] 지장간 가중 포함: ';
  t += Object.keys(elem.weighted).map(function (k) { return k + ' ' + elem.weighted[k]; }).join(', ');
  t += '\n\n';

  t += '[통근 판정 — 지장간 기준, 사주 내 모든 천간]\n';
  tong.forEach(function (x) {
    t += '- ' + x.position + ' ' + x.stem + '(' + x.elem + '): '
       + (x.rooted ? '통근 O → ' + x.roots.join(' / ') : '통근 X (지장간에 같은 오행 없음)') + '\n';
  });
  t += '\n';

  t += '[신살]\n';
  ['year','month','day','hour'].forEach(function (p) {
    t += '- ' + sinsal[p].name + ': ' + (sinsal[p].list.join(', ') || '-') + '\n';
  });
  t += '- 공망: ' + sinsal.gongmangBranches.join(', ') + '\n\n';

  t += '[형충회합]\n';
  const relLabel = { ganhap:'천간합', yukhap:'육합', samhap:'삼합/반합', banghap:'방합',
                     chung:'충', hyeong:'형', pa:'파', hae:'해' };
  Object.keys(relLabel).forEach(function (k) {
    if (rel[k] && rel[k].length) t += '- ' + relLabel[k] + ': ' + rel[k].join(' / ') + '\n';
  });
  t += '\n';

  t += buildSipganJohuBlock_(saju) + '\n';

  t += '[대운] ' + (daewoon.forward ? '순행' : '역행')
     + ' / 대운수 ' + daewoon.number + ' / 시작 ' + daewoon.startAge + '세(세는나이)\n';
  daewoon.list.forEach(function (d) {
    t += '- ' + d.ageFrom + '~' + d.ageTo + '세: ' + d.ganji
       + ' (' + d.stemTenGod + '/' + d.branchTenGod + ', 12운성 ' + d.unseong + ')\n';
  });
  return t;
}

const COMMON_RULES = [
  '아래 원칙을 반드시 지켜서 작성하세요.',
  '',
  '【해석 원칙】',
  '1. 통근(뿌리) 판단은 지지의 본기가 아니라 "지장간에 같은 오행이 있는지"로 합니다.',
  '   일간뿐 아니라 년간·월간·시간 등 사주 내 모든 천간에 대해 확인하고 십성 강약에 반영하세요.',
  '2. 지지의 십성이 관성·재성·식상으로 분류되더라도, 그 지장간에 판단 대상 천간과 같은 오행이',
  '   있으면 통근처로 인정하세요. 표면적인 극/설 관계만 보고 "뿌리 없다"고 하지 마세요.',
  '3. 어떤 오행이 천간·지지 본기에 없어도 지장간에 있으면 "전혀 없다"가 아니라',
  '   "드러나지 않아 약하다"로 표현하세요.',
  '4. 억부·통관뿐 아니라 조후(계절적 한난조습)도 함께 종합적으로 고려하세요.',
  '5. 축술미·인사신 삼형은 두 글자만 겹쳐도 형이 성립한 것으로 봅니다.',
  '   같은 지지 쌍에 파 등 다른 관계가 동시에 있어도 형을 더 비중 있게 서술하세요.',
  '6. 삼형살을 포함한 형충파해 전반은 고통·부정적 측면만 나열하지 말고,',
  '   그 이후의 발전·전환 가능성 등 긍정적 측면도 반드시 균형 있게 함께 서술하세요.',
  '7. 나이 표기는 전통 방식(세는나이, 태어나자마자 1세)으로 통일합니다.',
  '7-1. [십간론] 항목은 일간의 타고난 기질을 설명할 때 근거로 삼되, "일주 해설" 안에',
  '   자연스럽게 녹여 쓰세요. 십간론이라는 말이나 비유(큰 나무·태양 등)를 그대로',
  '   옮기지 말고, 그 성질이 실제 성격과 행동으로 어떻게 나타나는지로 바꿔 쓰세요.',
  '7-2. [궁통보감 조후] 항목은 "신강·신약과 용신" 안에서 조후 판단의 근거로만 쓰세요.',
  '   별도 소제목을 만들지 말고, 억부로 본 용신과 조후로 본 용신이 같은지 다른지를',
  '   함께 짚어 결론을 내리세요. 원문 표현을 인용하지 말고 풀어서 설명하세요.',
  '   단, 원국에 해당 글자가 실제로 있는지 반드시 확인하고, 없으면 "없어서 아쉽다"가',
  '   아니라 대운·세운에서 언제 채워지는지로 연결해 서술하세요.',
  '',
  '【서술 원칙】',
  '8. 재물운·직업운 등을 추상적으로 뭉뚱그리지 마세요. 재관쌍미·재고(財庫) 보유 여부,',
  '   식상생재 여부, 재성의 통근 상태 등 구체적 근거를 들어 디테일하게 서술하세요.',
  '9. 전문 용어 자체가 아니라, 그 작용에 따른 "실질적인 결과·조언 문장"을 **굵게** 표시하세요.',
  '   (예: "인사신 삼형" 이 아니라 "**계약서는 반드시 조항을 끝까지 읽고 서명하세요**")',
  '   일반 고객이 용어를 몰라도 결과를 바로 알아볼 수 있어야 합니다.',
  '10. 항목별 소제목은 절대 합치지 마세요. 결혼운·자녀운·부모운은 각각 독립된 소제목으로 씁니다.',
  '11. "○○○님 사주해석 리포트" 같은 제목은 쓰지 마세요. 표지에 이미 있으므로 중복입니다.',
  '    문서 맨 위에 제목 줄을 만들지 말고 바로 첫 소제목부터 시작하세요.',
  '12. 면책 문구나 "사주명리 이론 참고" 같은 안내 문장은 넣지 마세요.',
  '13. 고객에게 직접 전달하는 존댓말 문체로 쓰세요. 마크다운 ## 과 ### 만 사용합니다.'
].join('\n');

function promptLifetime_(name, birthText, block) {
  return [
    '당신은 30년 경력의 사주명리 전문가입니다. 아래 사주를 해석해 주세요.',
    '',
    '고객명: ' + name,
    '생년월일시: ' + birthText,
    '',
    block,
    '',
    COMMON_RULES,
    '',
    '【반드시 이 순서·이 소제목으로 작성】',
    '## 사주 총평',
    '## 일주 해설   ← 일주 자체의 오행 특성, 12운성, 괴강일 등 특이사항 포함',
    '## 지장간이 말해주는 것',
    '   지장간이 무엇인지 두세 문장으로 쉽게 설명한 뒤, 이 사주의 네 지지 속에',
    '   어떤 글자가 숨어 있고 그것이 일간에게 무슨 의미인지 풀어 쓰세요.',
    '   겉으로 드러난 글자와 속에 숨은 글자가 어떻게 다른지, 통근 여부가',
    '   이 사람의 힘에 어떤 차이를 만드는지를 실제 생활 언어로 설명하세요.',
    '   전문 용어를 나열하지 말고, 숨은 재능·드러나지 않은 기질처럼',
    '   고객이 바로 이해할 수 있는 표현으로 바꿔 쓰세요.',
    '## 신강·신약과 용신',
    '## 격(格)과 격국(格局)',
    '   내격 8개(식신·상관·정재·편재·정관·편관·정인·편인) 중 무엇인지 밝히고,',
    '   살인상생·식신제살·재자약살·상관패인·관인상생·재관쌍미 등 짜임새와 성격/파격 여부를 판정하세요.',
    '   격국명만 나열하지 말고, 그것이 이 사주에서 시사하는 실질적 의미(성향·강점·주의점)까지 풀어 쓰세요.',
    '## 성격과 타고난 기질',
    '## 학업운',
    '## 직업운',
    '## 재물운',
    '## 결혼운',
    '## 자녀운',
    '## 부모운·가족운',
    '## 건강운',
    '## 대운의 흐름',
    '   대운별로 나이(세는나이) 구간을 밝히고 흐름을 서술하세요.',
    '## 조심해야 할 사항',
    '## 마무리 조언'
  ].join('\n');
}

function promptYearly_(name, birthText, block, targetYear, month) {
  const extra = month ? ('\n특히 ' + month + '월에 대해 별도로 상세히 짚어주세요.') : '';
  return [
    '당신은 30년 경력의 사주명리 전문가입니다. 아래 사주의 ' + targetYear + '년 운세를 해석해 주세요.',
    '',
    '고객명: ' + name,
    '생년월일시: ' + birthText,
    '해당 연도: ' + targetYear + '년' + extra,
    '',
    block,
    '',
    COMMON_RULES,
    '',
    '【반드시 이 순서·이 소제목으로 작성】',
    '## ' + targetYear + '년 총운',
    '   해당 연도의 세운 간지가 원국·대운과 어떻게 작용하는지 먼저 밝히세요.',
    '## 재물운',
    '## 직업운·사업운',
    '## 학업운',
    '## 연애운',
    '## 결혼운',
    '## 건강운',
    '## 인간관계운',
    '## 월별 흐름',
    '   1월부터 12월까지 각 달을 한두 문장씩 짚어주세요.',
    '## 조심해야 할 사항',
    '## ' + targetYear + '년을 잘 보내는 법'
  ].join('\n');
}

function promptGunghap_(nameA, birthA, blockA, birthB, blockB) {
  return [
    '당신은 30년 경력의 사주명리 전문가입니다. 두 사람의 궁합을 봐 주세요.',
    '',
    '[본인] ' + nameA + ' / ' + birthA,
    blockA,
    '',
    '[상대방] ' + birthB,
    blockB,
    '',
    COMMON_RULES,
    '',
    '【작성 지침 — 매우 중요】',
    '- 개별 사주 해석은 하지 마세요. 오직 두 사람의 궁합 결과만 씁니다.',
    '- 전체 분량은 3~5줄로 간결하게. 소제목도 쓰지 마세요.',
    '- 일간끼리의 관계, 일지끼리의 합·충, 오행 보완 여부를 근거로 삼되',
    '  용어가 아니라 실질적인 결과 문장을 **굵게** 표시하세요.'
  ].join('\n');
}

/*==============================================================
  7. 외부 호출 (Claude / PDF / 메일)
==============================================================*/
function callClaude_(prompt) {
  const key = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!key) throw new Error('스크립트 속성에 CLAUDE_API_KEY 가 없습니다.');

  const res = UrlFetchApp.fetch(CONFIG.CLAUDE_API, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: CONFIG.MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error('Claude API 오류 ' + code + ': ' + body.slice(0, 300));

  const json = JSON.parse(body);
  return (json.content || [])
    .filter(function (c) { return c.type === 'text'; })
    .map(function (c) { return c.text; })
    .join('\n')
    .trim();
}

// 템플릿(SINSAL_MEANINGS)이 쓰는 표기로 통일
const SINSAL_DISPLAY = {
  '역마':'역마살', '화개':'화개살', '연살':'도화살', '괴강':'괴강살',
  '양인':'양인살', '천을귀인':'천을귀인', '원진':'원진살',
  '지살':'지살', '겁살':'겁살', '재살':'재살', '천살':'천살',
  '월살':'월살', '망신':'망신살', '장성':'장성살', '반안':'반안살',
  '육해':'육해살', '공망':'공망', '문창귀인':'문창귀인',
  '귀문관살':'귀문관살', '백호대살':'백호대살'
};

function sinsalArray_(list) {
  const seen = {}, out = [];
  (list || []).forEach(function (raw) {
    const base = String(raw).replace(/\(.*?\)/g, '').trim();
    const disp = SINSAL_DISPLAY[base];
    if (disp && !seen[disp]) { seen[disp] = 1; out.push(disp); }
  });
  return out;
}

function pillarsPayload_(saju, sinsal) {
  const out = {};
  ['year','month','day','hour'].forEach(function (k) {
    const p = saju.pillars[k];
    out[k] = {
      stemHanja: p.stemHanja,
      branchHanja: p.branchHanja,
      stemHangul: p.stemHangul,
      branchHangul: p.branchHangul,
      stemElement: p.stemElem,
      branchElement: p.branchElem,
      hiddenStemsHanja: p.hidden.map(function (h) { return h.hanja; }).join(''),
      hiddenStems: p.hidden.map(function (h) {
        return {
          hanja: h.hanja,
          hangul: h.hangul,
          element: h.elem,
          tenGod: tenGodOfStem(saju.pillars.day.stem, h.idx)
        };
      }),
      tenGodStem: tenGodOfStem(saju.pillars.day.stem, p.stem),
      tenGodBranch: tenGodOfBranch(saju.pillars.day.stem, p.branch),
      unseong: twelveUnseong(saju.pillars.day.stem, p.branch),
      sinsal: sinsalArray_(sinsal[k] ? sinsal[k].list : [])   // ← 반드시 배열
    };
  });
  return out;
}

/** 템플릿 buildDaewoonBlocks 가 기대하는 형태로 변환 */
function daewoonPayload_(daewoon) {
  return daewoon.list.map(function (d) {
    return {
      ageRange: d.ageFrom + '~' + d.ageTo + '세',
      ganji: d.stemHangul + d.branchHangul,
      hanja: d.stemHanja + d.branchHanja,
      tenGods: d.stemTenGod + ' + ' + d.branchTenGod,
      branchLetter: d.branchHangul,
      descriptionHtml: d.yearFrom + '년부터 · 12운성 ' + d.unseong
                     + ' · 오행 ' + d.element
    };
  });
}

function makePdf_(payload) {
  const res = UrlFetchApp.fetch(CONFIG.PDF_API, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('PDF 서버 오류 ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  return res.getBlob().setName(payload.name + '_' + payload.docTitle + '.pdf');
}

function sendMail_(to, name, docTitle, blob) {
  const subject = '[' + CONFIG.BRAND_NAME + '] ' + name + '님 ' + docTitle + ' 보내드립니다';
  const body = [
    name + '님, 안녕하세요.',
    '',
    CONFIG.BRAND_NAME + '입니다.',
    '신청해 주신 ' + docTitle + '을(를) 첨부 파일로 보내드립니다.',
    '',
    '차분히 읽어보시고 궁금한 점이 있으시면 편하게 답장 주세요.',
    '',
    '감사합니다.',
    CONFIG.BRAND_NAME + ' 드림'
  ].join('\n');

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: body,
    name: CONFIG.SENDER_NAME,
    attachments: [blob]
  });
}

/*==============================================================
  8. 한 행 처리 (메인)
==============================================================*/
function buildOne_(dateObj, timeObj, lunar, male, leap) {
  const solar = lunar ? lunarToSolar_(dateObj.y, dateObj.m, dateObj.d, !!leap) : dateObj;
  const t = timeObj || { h: 12, min: 0 };
  const birth = new Date(solar.y, solar.m - 1, solar.d, t.h, t.min, 0);
  const saju = calcSaju(birth);

  // 절기 계산은 간이 천문공식이라 수 분의 오차가 있습니다.
  // 절입 경계 30분 이내면 월주가 바뀔 수 있으므로 자동 발송을 멈춥니다.
  if (nearJeolgiBoundary_(saju.birth, saju.jeolgi, 30)) {
    throw new Error('절입 시각 30분 이내 출생입니다. 월주가 바뀔 수 있으니 '
      + '만세력으로 직접 확인한 뒤 수동으로 발송해 주세요. '
      + '(' + JEOLGI_NAMES[saju.jeolgi.k] + ' 구간 경계)');
  }

  const daewoon = calcDaewoon(saju, male);
  const sinsal = calcSinsal(saju);
  const rel = calcRelations(saju);
  const tong = checkTonggeun(saju);
  const elem = elementCount(saju);
  const block = buildAnalysisBlock_(saju, daewoon, sinsal, rel, tong, elem);
  return { saju: saju, daewoon: daewoon, sinsal: sinsal, block: block,
           timeKnown: !!timeObj, solar: solar, wasLunar: !!lunar, leap: !!leap };
}

function processRow(rowNum) {
  const sheet = getSheet_();
  const map = headerMap_(sheet);
  const C = function (n) { return col_(map, n); };
  const statusCol = C('발송상태');
  const get = function (n) {
    const c = C(n);
    return c ? sheet.getRange(rowNum, c).getValue() : '';
  };

  const name  = String(get('불리고 싶은 이름') || '고객').trim();
  const email = String(get('이메일') || '').trim();
  if (!email) throw new Error('이메일이 비어 있습니다.');

  const dateObj = parseDate_(get('생년월일'));
  const timeObj = parseTime_(get('태어난 시각'));
  const lunar   = isLunar_(get('달력구분'));
  const leap    = isYundal_(get('윤달여부'));
  const male    = isMale_(get('성별'));
  const want    = String(get('원하는 항목') || '');

  const me = buildOne_(dateObj, timeObj, lunar, male, leap);

  const sd0 = me.solar;
  const birthText = sd0.y + '년 ' + sd0.m + '월 ' + sd0.d + '일 '
    + (timeObj ? (('0' + timeObj.h).slice(-2) + ':' + ('0' + timeObj.min).slice(-2))
               : '시간 미상')
    + ' · ' + (male ? '남자' : '여자') + ' · 양력'
    + (me.wasLunar ? ' (음력 ' + dateObj.y + '.' + dateObj.m + '.' + dateObj.d
        + (me.leap ? ' 윤달' : '') + ')' : '');

  let prompt, docTitle;

  if (/궁합/.test(want)) {
    const bDate = parseDate_(get('궁합 - 상대방 생년월일'));
    const bTime = parseTime_(get('궁합 - 상대방 태어난 시각'));
    const bLun  = isLunar_(get('궁합 - 상대방 달력구분'));
    const bLeap = isYundal_(get('궁합 - 상대방 윤달여부'));
    const bMale = isMale_(get('궁합 - 상대방 성별'));
    const other = buildOne_(bDate, bTime, bLun, bMale, bLeap);
    const bs = other.solar;
    const bText = bs.y + '년 ' + bs.m + '월 ' + bs.d + '일 · '
                + (bMale ? '남자' : '여자');
    prompt = promptGunghap_(name, birthText, me.block, bText, other.block);
    docTitle = '궁합 풀이';

  } else if (/한해|신년|세운|년\s*운/.test(want)) {
    let ty = parseInt(String(get('한해의 운세 대상 연도')).replace(/\D/g, ''), 10);
    if (!ty) ty = new Date().getFullYear();
    const mo = parseInt(String(get('특정 월')).replace(/\D/g, ''), 10) || 0;
    // 세운 간지 정보 추가
    const sy = ((ty - 4) % 10 + 10) % 10, sb = ((ty - 4) % 12 + 12) % 12;
    const extra = '\n[' + ty + '년 세운] ' + GAN[sy] + JI[sb]
      + '(' + GAN_H[sy] + JI_H[sb] + ') / 천간 '
      + tenGodOfStem(me.saju.pillars.day.stem, sy) + ' · 지지 '
      + tenGodOfBranch(me.saju.pillars.day.stem, sb) + '\n';
    prompt = promptYearly_(name, birthText, me.block + extra, ty, mo);
    docTitle = ty + '년 운세 풀이';

  } else {
    prompt = promptLifetime_(name, birthText, me.block);
    docTitle = '인생총운 해설서';
  }

  const markdown = callClaude_(prompt);
  if (!markdown) throw new Error('Claude 응답이 비어 있습니다.');

  const payload = {
    name: name,
    docTitle: docTitle,
    brandName: CONFIG.BRAND_NAME,
    birthInfoText: birthText,
    ganDate: fmtKDate_(new Date()),
    pillars: pillarsPayload_(me.saju, me.sinsal),
    gongmang: me.sinsal.gongmangBranches.join(', '),
    tonggeun: checkTonggeun(me.saju).map(function (x) {
      return { position: x.position, stem: x.stem, element: x.elem,
               rooted: x.rooted, roots: x.roots };
    }),
    daewoonList: daewoonPayload_(me.daewoon),
    daewoonNumber: me.daewoon.number,
    daewoonForward: me.daewoon.forward,
    interpretationMarkdown: markdown
  };

  const blob = makePdf_(payload);
  sendMail_(email, name, docTitle, blob);
  sheet.getRange(rowNum, statusCol).setValue(CONFIG.ST_DONE);
}

/*==============================================================
  9. 트리거 핸들러
==============================================================*/

/** 새 신청 행에 "입금대기" 채우기 */
function onSheetChangeHandler(e) {
  try {
    const sheet = getSheet_();
    const map = headerMap_(sheet);
    const statusCol = col_(map, '발송상태');
    const emailCol  = col_(map, '이메일');
    if (!statusCol || !emailCol) return;

    const last = sheet.getLastRow();
    if (last < 2) return;

    const emails = sheet.getRange(2, emailCol, last - 1, 1).getValues();
    const stats  = sheet.getRange(2, statusCol, last - 1, 1).getValues();
    let changed = false;
    for (let i = 0; i < emails.length; i++) {
      if (String(emails[i][0]).trim() && !String(stats[i][0]).trim()) {
        stats[i][0] = CONFIG.ST_WAIT;
        changed = true;
      }
    }
    if (changed) sheet.getRange(2, statusCol, last - 1, 1).setValues(stats);
  } catch (err) {
    console.error('onSheetChangeHandler: ' + err.message);
  }
}

/** 발송상태를 "입금확인"으로 바꾸면 발송 처리 */
function onEditHandler(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    if (sheet.getSheetId() !== getSheet_().getSheetId()) return;

    const map = headerMap_(sheet);
    const statusCol = col_(map, '발송상태');
    if (e.range.getColumn() !== statusCol) return;

    const row = e.range.getRow();
    if (row < 2) return;
    if (String(e.range.getValue()).trim() !== CONFIG.ST_PAID) return;

    e.range.setValue('처리중...');
    try {
      processRow(row);
    } catch (err) {
      sheet.getRange(row, statusCol).setValue(CONFIG.ST_FAIL + ': ' + err.message);
      console.error('processRow(' + row + '): ' + err.stack);
    }
  } catch (err) {
    console.error('onEditHandler: ' + err.message);
  }
}

/*==============================================================
  10. 수동 실행용 도구
==============================================================*/

/** 편집기에서 직접 실행해서 전체 점검 */
function 점검() {
  const sheet = getSheet_();
  const map = headerMap_(sheet);
  const need = ['불리고 싶은 이름','이메일','생년월일','태어난 시각','성별','달력구분',
                '원하는 항목','발송상태'];
  const missing = need.filter(function (n) { return !col_(map, n); });

  let msg = '시트 이름: ' + sheet.getName() + '\n';
  msg += '마지막 행: ' + sheet.getLastRow() + '\n';
  msg += '필수 열 누락: ' + (missing.length ? missing.join(', ') : '없음') + '\n';
  msg += 'CLAUDE_API_KEY: '
       + (PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY') ? '있음' : '없음') + '\n';

  const t = calcSaju(new Date(2004, 4, 31, 10, 0));
  msg += '\n[계산 테스트] 2004-05-31 10:00 →\n' + pillarText_(t);
  console.log(msg);
  return msg;
}

/** 특정 행을 강제로 다시 발송 (편집기에서 행 번호 바꿔 실행) */
function 수동발송() {
  const ROW = 2;   // ← 발송할 행 번호로 바꾸세요
  processRow(ROW);
}

/** 빈 발송상태 일괄 채우기 */
function 상태초기화() {
  onSheetChangeHandler();
}

/** 음력 변환 단독 테스트 : 음력 1990-01-01 → 양력 1990-1-27 이면 정상 */
function 음력테스트() {
  const r = lunarToSolar_(1990, 1, 1, false);
  const msg = '음력 1990-01-01 → 양력 ' + r.y + '-' + r.m + '-' + r.d;
  console.log(msg);
  return msg;
}

/*==============================================================
  12. 일일 요약 알림 (매일 오후 5시)
  --------------------------------------------------------------
  처음 한 번만 편집기에서 [알림트리거설치] 를 실행하세요.
  그 뒤부터는 매일 오후 5시에 요약 메일이 자동 발송됩니다.
==============================================================*/

// 요약 메일을 받을 주소. 비워두면 스크립트 소유자 계정으로 보냅니다.
const SUMMARY_EMAIL_TO = '';

/** 매일 오후 5시에 실행되는 요약 메일 */
function 일일요약메일() {
  const sheet = getSheet_();
  const map = headerMap_(sheet);
  const last = sheet.getLastRow();
  if (last < 2) return;

  const cName  = col_(map, '불리고 싶은 이름');
  const cWant  = col_(map, '원하는 항목');
  const cPayer = col_(map, '입금자명');
  const cStat  = col_(map, '발송상태');
  if (!cStat) return;

  const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  const waiting = [], failed = [], stuck = [];

  rows.forEach(function (r, i) {
    const rowNum = i + 2;
    const st = String(r[cStat - 1] || '').trim();
    if (!st) return;
    const name  = cName  ? String(r[cName - 1]  || '') : '';
    const want  = cWant  ? String(r[cWant - 1]  || '') : '';
    const payer = cPayer ? String(r[cPayer - 1] || '') : '';
    const line = rowNum + '행  ' + name + ' / ' + (want || '항목없음')
               + (payer ? ' / 입금자 ' + payer : '');

    if (st === CONFIG.ST_WAIT) waiting.push(line);
    else if (st.indexOf(CONFIG.ST_FAIL) === 0) {
      failed.push(line + '\n      → ' + st.replace(CONFIG.ST_FAIL + ': ', ''));
    } else if (st === '처리중...') stuck.push(line);
  });

  // 처리할 게 하나도 없으면 메일을 보내지 않습니다.
  if (!waiting.length && !failed.length && !stuck.length) return;

  const parts = [];
  parts.push(Utilities.formatDate(new Date(), 'Asia/Seoul', 'M월 d일') + ' 처리 현황입니다.');
  parts.push('');

  if (waiting.length) {
    parts.push('■ 입금대기 ' + waiting.length + '건');
    parts.push('  입금을 확인하신 뒤 발송상태를 "' + CONFIG.ST_PAID + '"으로 바꿔주세요.');
    parts.push('');
    waiting.forEach(function (l) { parts.push('  ' + l); });
    parts.push('');
  }
  if (failed.length) {
    parts.push('■ 발송실패 ' + failed.length + '건 — 확인이 필요합니다');
    parts.push('');
    failed.forEach(function (l) { parts.push('  ' + l); });
    parts.push('');
  }
  if (stuck.length) {
    parts.push('■ 처리중 상태로 멈춘 건 ' + stuck.length + '건');
    parts.push('  6분 제한에 걸렸을 수 있습니다. 발송상태를 다시 "'
               + CONFIG.ST_PAID + '"으로 바꿔 재시도해 주세요.');
    parts.push('');
    stuck.forEach(function (l) { parts.push('  ' + l); });
    parts.push('');
  }

  parts.push('시트 바로가기');
  parts.push(SpreadsheetApp.getActiveSpreadsheet().getUrl());

  const to = SUMMARY_EMAIL_TO || Session.getEffectiveUser().getEmail();
  const title = '[' + CONFIG.BRAND_NAME + '] 입금대기 ' + waiting.length + '건'
              + (failed.length ? ' · 실패 ' + failed.length + '건' : '');

  MailApp.sendEmail({
    to: to,
    subject: title,
    body: parts.join('\n'),
    name: CONFIG.SENDER_NAME
  });
}

/** 처음 한 번만 실행 — 매일 오후 5시 트리거를 설치합니다 */
function 알림트리거설치() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === '일일요약메일') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('일일요약메일')
    .timeBased()
    .atHour(17)
    .everyDays(1)
    .inTimezone('Asia/Seoul')
    .create();
  const msg = '매일 오후 5시 요약 메일 트리거를 설치했습니다.';
  console.log(msg);
  return msg;
}

/** 지금 바로 요약 메일을 받아보고 싶을 때 실행 */
function 요약메일_지금보내기() {
  일일요약메일();
  console.log('요약 메일을 보냈습니다. (대기·실패 건이 없으면 발송되지 않습니다)');
}
