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
// 신살별 실질적 의미 (짧은 한 줄 요약 - 표 아래 해설용)
const SINSAL_MEANINGS = {
  '역마살': '이동·타지 인연이 활발합니다.',
  '화개살': '철학·예술적 감수성이 깊고, 혼자만의 시간에서 힘을 얻는 성향입니다.',
  '도화살': '대인관계에서 매력과 인기가 따르는 편입니다.',
  '괴강살': '강한 카리스마와 결단력을 지니되, 극단으로 치우치지 않게 스스로를 다스리는 노력이 필요합니다.',
  '양인살': '추진력과 결단력이 강하지만, 그만큼 감정 기복이나 과단한 행동을 주의할 필요가 있습니다.',
  '천을귀인': '인생의 고비마다 결정적인 도움을 주는 사람이나 기회를 만날 가능성이 있습니다.',
  '원진살': '배우자·가까운 사람과의 관계에서 은근히 쌓이는 감정을 미리 대화로 풀어두는 게 좋습니다.'
};

function buildSinsalExplanation(pillars) {
  const found = new Set();
  ['hour', 'day', 'month', 'year'].forEach(pos => {
    const p = pillars[pos];
    if (p && p.sinsal) p.sinsal.forEach(s => found.add(s));
  });
  if (found.size === 0) return '';
  const items = Array.from(found).map(s =>
    `<li><b>${escapeHtml(s)}</b> — ${escapeHtml(SINSAL_MEANINGS[s] || '')}</li>`
  ).join('');
  return `<div class="sinsal-explain"><span class="sinsal-explain-title">신살 해설</span><ul>${items}</ul></div>`;
}

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
  const sinsalCells = order.map(([, p]) => {
    const list = (p && p.sinsal) ? p.sinsal : [];
    if (!list.length) return `<td class="sinsal-cell">-</td>`;
    const tags = list.map(s => `<span class="sinsal-tag">${escapeHtml(s)}</span>`).join('');
    return `<td class="sinsal-cell">${tags}</td>`;
  }).join('');

  return `
  <table class="pillars-table">
    <tr>${headerCells}</tr>
    <tr class="cheongan-row">${stemCells}</tr>
    <tr class="jiji-row">${branchCells}</tr>
    <tr class="sinsal-row">${sinsalCells}</tr>
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
  @page { size: A4; margin: 13mm 15mm 13mm 15mm; } /* 상하 13mm, 좌우 15mm */
  * { box-sizing: border-box; }
  body {
    font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    font-size: 14pt; line-height: 2; color: #2b2820; background: #fdfbf5;
    margin: 0;
    text-align: justify; /* 문단 양쪽 정렬 - 좌우 끝이 가지런하게 */
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
  .sinsal-row td { border-top: 1px dashed #c9b98a; padding: 6px 4px 10px; }
  .sinsal-cell { text-align: center; }
  .sinsal-tag { display: inline-block; font-size: 9pt; color: #8c2d24; background: #fbeceb; border: 1px solid #e3b8b3; border-radius: 8px; padding: 1px 6px; margin: 1px 2px; }

  .sinsal-explain { background: #fbeceb; border: 1px solid #e3b8b3; padding: 10px 16px; margin: 4px 0 20px; }
  .sinsal-explain-title { font-family: 'Noto Serif KR', serif; font-weight: bold; font-size: 11.5pt; color: #8c2d24; }
  .sinsal-explain ul { margin: 6px 0 0; padding-left: 18px; }
  .sinsal-explain li { font-size: 11pt; line-height: 1.6; margin-bottom: 3px; }
  .hanja { font-family: 'Noto Serif KR', serif; font-size: 22pt; line-height: 1.3; }
  .hangul { font-size: 11pt; color: #4a4536; margin-top: 2px; }
  .jiji-main { font-family: 'Noto Serif KR', serif; font-size: 22pt; }
  .jijanggan { font-family: 'Noto Serif KR', serif; font-size: 13pt; color: #6b6450; }

  .gyeokguk-box { background: #eef1ea; border: 1px solid #6b8f5c; padding: 16px 20px; margin: 14px 0 20px; }
  .gyeokguk-box h3 { background: #3f6b4a; display: block; width: fit-content; }

  .daewoon-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin-bottom: 20px; }
  .daewoon-block { border: 1px solid #c9b98a; border-left: 5px solid; padding: 10px 14px; margin-bottom: 0; background: #ffffff; page-break-inside: avoid; }
  .daewoon-block .age-range { font-family: 'Noto Serif KR', serif; font-size: 13pt; font-weight: bold; margin-bottom: 4px; }
  .daewoon-block .pillar-tag { display: inline-block; font-size: 10pt; background: #ece3cd; padding: 2px 8px; border-radius: 10px; margin-left: 4px; }
  .daewoon-block p { font-size: 11pt; line-height: 1.6; margin: 4px 0 0; }
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
  const sinsalExplainHtml = buildSinsalExplanation(data.pillars);

  const daewoonHtml = (data.daewoonList && data.daewoonList.length)
    ? `<h2 class="section-title">대운의 흐름 (10년 단위, 세는나이 기준)</h2><div class="daewoon-grid">${buildDaewoonBlocks(data.daewoonList)}</div>`
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
${sinsalExplainHtml}
${daewoonHtml}
<div class="content">
${interpretationHtml}
</div>
</body>
</html>`;
}

module.exports = { buildReportHTML, escapeHtml };
