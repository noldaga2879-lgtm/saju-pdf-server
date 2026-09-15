// lib/reportTemplate.js
// 사주 해설서 HTML 템플릿을 만드는 모듈.
// Puppeteer/Chromium이 이 HTML을 그대로 렌더링해서 PDF로 찍기 때문에,
// wkhtmltopdf에서 발생했던 한자 인코딩 깨짐 문제가 근본적으로 없습니다
// (실제 크롬 엔진이 폰트와 텍스트 인코딩을 정상적으로 처리합니다).

const { marked } = require('marked');

// 운명마스터 직인 이미지 (PNG, base64) - 사주_자동발송_AppsScript_v2.gs의
// SEAL_IMAGE_BASE64 상수와 동일한 이미지입니다. 로고를 바꾸실 때 이 값과
// Apps Script 쪽 상수를 함께 교체해주세요.
const SEAL_IMAGE_BASE64 = process.env.SEAL_IMAGE_BASE64 || '';

const BRAND_NAME = '운명마스터';

const ELEMENT_COLOR = {
  '목': '#3f6b4a',
  '화': '#a83a2e',
  '토': '#b8862f',
  '금': '#8c8676',
  '수': '#28374f'
};

// 지지 -> 오행 매핑 (대운 블록 좌측 색상 줄에 사용)
const BRANCH_ELEMENT = {
  '자': '수', '축': '토', '인': '목', '묘': '목', '진': '토', '사': '화',
  '오': '화', '미': '토', '신': '금', '유': '금', '술': '토', '해': '수'
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 사주 원국 표 HTML 생성
// pillars = { year: {stemHanja, branchHanja, stemHangul, branchHangul, hiddenStemsHanja: '戊庚丙'}, month:..., day:..., hour: null|{...} }
function buildPillarsTable(pillars) {
  const order = [
    ['시주', pillars.hour],
    ['일주', pillars.day],
    ['월주', pillars.month],
    ['년주', pillars.year]
  ];

  const headerCells = order.map(([label]) => `<th>${label}</th>`).join('');
  const stemCells = order.map(([, p]) => {
    if (!p) return `<td><div class="hanja">-</div><div class="hangul">-</div></td>`;
    return `<td><div class="hanja">${escapeHtml(p.stemHanja)}</div><div class="hangul">${escapeHtml(p.stemHangul)}</div></td>`;
  }).join('');
  const branchCells = order.map(([, p]) => {
    if (!p) return `<td><span class="jiji-main">-</span><div class="hangul">시각미상</div></td>`;
    return `<td><span class="jiji-main">${escapeHtml(p.branchHanja)}</span><span class="jijanggan">(${escapeHtml(p.hiddenStemsHanja)})</span><div class="hangul">${escapeHtml(p.branchHangul)}</div></td>`;
  }).join('');

  return `
  <table class="pillars-table">
    <tr>${headerCells}</tr>
    <tr class="cheongan-row">${stemCells}</tr>
    <tr class="jiji-row">${branchCells}</tr>
  </table>`;
}

// 대운 블록 HTML 생성
// daewoonList = [{ ageRange: '3~12세', ganji: '경오', hanja: '庚午', tenGods: '비견 + 편관', branchLetter: '오', descriptionHtml: '...' }, ...]
function buildDaewoonBlocks(daewoonList) {
  return daewoonList.map(dw => {
    const element = BRANCH_ELEMENT[dw.branchLetter] || '토';
    const colorClass = 'dw-' + ({ '목': 'mok', '화': 'hwa', '토': 'to', '금': 'geum', '수': 'su' }[element] || 'to');
    return `
    <div class="daewoon-block ${colorClass}">
      <div class="age-range">${escapeHtml(dw.ageRange)} · ${escapeHtml(dw.ganji)}(${escapeHtml(dw.hanja)}) <span class="pillar-tag">${escapeHtml(dw.tenGods)}</span></div>
      <p>${dw.descriptionHtml}</p>
    </div>`;
  }).join('\n');
}

// Claude가 생성한 해석 마크다운을 HTML로 변환.
// 마크다운 컨벤션: ## 소제목, **볼드**는 실질적 결과 문장.
function renderInterpretationMarkdown(markdown) {
  return marked.parse(markdown, { breaks: true });
}

function buildCoverPage({ name, birthInfoText, ganDate }) {
  const sealImg = SEAL_IMAGE_BASE64
    ? `<img class="seal-stamp-img" src="data:image/png;base64,${SEAL_IMAGE_BASE64}" alt="직인" />`
    : `<div class="seal-stamp-fallback">運命<br/>마스터</div>`;

  return `
  <div class="cover">
    <div class="mark">사 주 명 리 해 설</div>
    <h1>종합 사주 해설서</h1>
    <div class="subtitle">타고난 여덟 글자로 읽는 인생의 흐름</div>
    <div class="name">${escapeHtml(name)} 님</div>
    <div class="meta">${escapeHtml(birthInfoText)}</div>
    <div class="gan-date">간명일자 · ${escapeHtml(ganDate)}</div>
    <div class="provider-row">
      ${sealImg}
      <div class="provider-text">${BRAND_NAME}</div>
    </div>
  </div>`;
}

const STYLE = `
  @page { size: A4; margin: 26mm 22mm 22mm 22mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    font-size: 14pt; line-height: 2; color: #2b2820; background: #fdfbf5;
    margin: 0;
  }
  .cover { text-align: center; padding-top: 40mm; page-break-after: always; }
  .cover .mark { font-family: 'Noto Serif KR', serif; letter-spacing: 0.4em; color: #a97a2b; font-size: 13pt; margin-bottom: 18px; }
  .cover h1 { font-family: 'Noto Serif KR', serif; font-size: 28pt; color: #2b2820; margin: 0 0 10px; }
  .cover .subtitle { font-size: 13pt; color: #6b6450; margin-bottom: 40px; }
  .cover .name { font-family: 'Noto Serif KR', serif; font-size: 20pt; border-top: 1px solid #c9b98a; border-bottom: 1px solid #c9b98a; display: inline-block; padding: 14px 40px; margin-bottom: 14px; }
  .cover .meta { font-size: 12pt; color: #837c63; }
  .cover .gan-date { font-size: 12pt; color: #a97a2b; margin-top: 60px; letter-spacing: 0.05em; }
  .cover .provider-row { margin-top: 40px; display: flex; align-items: center; justify-content: center; gap: 16px; flex-direction: column; }
  .seal-stamp-img { width: 90px; height: 90px; transform: rotate(-7deg); }
  .seal-stamp-fallback {
    width: 90px; height: 90px; border: 4px double #b7311f; display: flex; align-items: center; justify-content: center;
    transform: rotate(-7deg); font-family: 'Noto Serif KR', serif; font-weight: bold; font-size: 16pt; color: #b7311f; text-align: center; line-height: 1.25;
  }
  .cover .provider-text { font-family: 'Noto Serif KR', serif; font-weight: bold; font-size: 16pt; color: #4a4536; letter-spacing: 0.08em; }

  h2.section-title, .content h2 {
    font-family: 'Noto Serif KR', serif; font-size: 17pt; color: #2b2820;
    margin: 34px 0 14px; padding-bottom: 8px; border-bottom: 2px solid #2b2820; page-break-after: avoid;
  }
  .content h3 {
    display: inline-block; font-family: 'Noto Serif KR', serif; font-size: 13pt; font-weight: bold;
    color: #ffffff; background: #2b2820; padding: 4px 14px; margin: 20px 0 8px; page-break-after: avoid;
  }
  .content p { margin: 6px 0 16px; }
  .content ul { margin: 6px 0 16px; padding-left: 22px; }
  .content li { margin-bottom: 6px; }
  .content strong { color: inherit; }

  .pillars-table { width: 100%; border-collapse: collapse; margin: 10px 0 20px; }
  .pillars-table th { background: #ece3cd; border: 1px solid #2b2820; padding: 8px 4px; font-size: 12pt; color: #4a4536; }
  .pillars-table td { border: 1px solid #c9b98a; text-align: center; padding: 16px 6px; }
  .cheongan-row td { border-bottom: none; padding-bottom: 6px; }
  .jiji-row td { border-top: none; padding-top: 2px; }
  .hanja { font-family: 'Noto Serif KR', serif; font-size: 22pt; line-height: 1.3; }
  .hangul { font-size: 11pt; color: #4a4536; margin-top: 2px; }
  .jiji-main { font-family: 'Noto Serif KR', serif; font-size: 22pt; }
  .jijanggan { font-family: 'Noto Serif KR', serif; font-size: 13pt; color: #6b6450; }

  .gyeokguk-box { background: #eef1ea; border: 1px solid #6b8f5c; padding: 16px 20px; margin: 14px 0 20px; }
  .gyeokguk-box h3 { background: #3f6b4a; display: block; width: fit-content; }

  .daewoon-block { border: 1px solid #c9b98a; border-left: 5px solid; padding: 12px 18px; margin-bottom: 14px; background: #ffffff; page-break-inside: avoid; }
  .daewoon-block .age-range { font-family: 'Noto Serif KR', serif; font-size: 14pt; font-weight: bold; margin-bottom: 4px; }
  .daewoon-block .pillar-tag { display: inline-block; font-size: 11pt; background: #ece3cd; padding: 2px 10px; border-radius: 10px; margin-left: 6px; }
  .dw-mok { border-left-color: #3f6b4a; } .dw-hwa { border-left-color: #a83a2e; } .dw-to { border-left-color: #b8862f; }
  .dw-geum{ border-left-color: #8c8676; } .dw-su { border-left-color: #28374f; }

  .warning-box { background: #fbeceb; border: 1px solid #c9645c; padding: 16px 20px; margin-top: 10px; }
  .warning-box h3 { background: #8c2d24; }
`;

/**
 * 전체 리포트 HTML을 생성합니다.
 * @param {Object} data
 * @param {string} data.name - 불릴 이름
 * @param {string} data.birthInfoText - 예: "2004년 5월 31일 사시(巳時) 生 · 남자 · 양력"
 * @param {string} data.ganDate - 예: "2026년 9월 15일"
 * @param {Object} data.pillars - buildPillarsTable 참고
 * @param {Array}  data.daewoonList - buildDaewoonBlocks 참고 (없으면 생략 가능)
 * @param {string} data.interpretationMarkdown - Claude가 생성한 해석 본문 (마크다운)
 */
function buildReportHTML(data) {
  const cover = buildCoverPage({
    name: data.name,
    birthInfoText: data.birthInfoText,
    ganDate: data.ganDate
  });

  const pillarsHtml = buildPillarsTable(data.pillars);

  const daewoonHtml = (data.daewoonList && data.daewoonList.length)
    ? `<h2 class="section-title">대운의 흐름 (10년 단위, 세는나이 기준)</h2>${buildDaewoonBlocks(data.daewoonList)}`
    : '';

  const interpretationHtml = renderInterpretationMarkdown(data.interpretationMarkdown || '');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600;700&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
${cover}
<h2 class="section-title">사주 원국</h2>
${pillarsHtml}
${daewoonHtml}
<div class="content">
${interpretationHtml}
</div>
</body>
</html>`;
}

module.exports = { buildReportHTML, escapeHtml };
