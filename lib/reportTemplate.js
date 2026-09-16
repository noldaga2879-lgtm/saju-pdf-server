// lib/reportTemplate.js
// 사주 해설서 HTML 템플릿을 만드는 모듈.
// Puppeteer/Chromium이 이 HTML을 그대로 렌더링해서 PDF로 찍기 때문에,
// wkhtmltopdf에서 발생했던 한자 인코딩 깨짐 문제가 근본적으로 없습니다
// (실제 크롬 엔진이 폰트와 텍스트 인코딩을 정상적으로 처리합니다).

const { marked } = require('marked');

// 운명마스터 직인 이미지 (PNG, base64) - Apps Script 쪽 상수와 동일한 이미지입니다.
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

// 신살별 실질적 의미 (표 아래 해설용)
// 부정적인 면만 나열하지 않고 발전·전환 가능성까지 함께 담습니다.
const SINSAL_MEANINGS = {
  // --- 12신살 ---
  '겁살': '예기치 않은 손실이나 경쟁을 겪을 수 있지만, 그 과정에서 위기 감지 능력과 승부처를 읽는 눈이 길러집니다.',
  '재살': '송사·구설처럼 매이는 일이 생길 수 있는 자리입니다. 문서와 약속을 꼼꼼히 챙기면 오히려 신뢰를 얻는 계기가 됩니다.',
  '천살': '내 뜻대로 되지 않는 일을 만나며 겸손을 배우는 자리입니다. 큰 흐름을 받아들일 때 길이 다시 열립니다.',
  '지살': '한곳에 머물기보다 옮기고 넓히며 기회를 잡는 성향입니다. 이사·전학·전직·출장처럼 자리를 바꾸는 변화가 잦고, 그 변화가 발전의 계기가 되는 경우가 많습니다.',
  '도화살': '대인관계에서 매력과 인기가 따르는 편입니다. 사람을 끌어당기는 힘이 강해 표현·예술·영업 분야에서 특히 빛납니다.',
  '월살': '기운이 잠시 메마르고 일이 더디게 풀리는 시기를 뜻합니다. 무리해서 벌이기보다 안으로 실력을 쌓아두면 다음 국면에서 크게 쓰입니다.',
  '망신살': '감추고 싶던 일이 드러나기 쉬운 자리입니다. 처음부터 떳떳하게 처리하는 습관을 들이면 오히려 평판이 단단해집니다.',
  '장성살': '조직에서 앞에 나서고 주도하는 힘이 강합니다. 리더 자리가 잘 어울리되, 혼자 짊어지려 하지 않는 것이 좋습니다.',
  '반안살': '윗사람의 인정과 후원을 받아 자리가 올라가는 기운입니다. 승진·발탁처럼 안정된 기반 위에서 한 단계 올라서는 흐름을 뜻하며, 사람에게 잘 받쳐주는 힘이 있습니다.',
  '역마살': '이동·타지 인연이 활발합니다. 여행·출장·해외·이직처럼 움직임 속에서 기회를 만나는 유형입니다.',
  '육해살': '몸과 마음이 쉽게 지치고 자잘한 소모가 따를 수 있습니다. 쉬는 시간을 일정에 미리 넣어두는 것이 최선의 대비입니다.',
  '화개살': '철학·예술적 감수성이 깊고, 혼자만의 시간에서 힘을 얻는 성향입니다. 학문·종교·창작 쪽 재능이 있습니다.',

  // --- 길신 ---
  '천을귀인': '인생의 고비마다 결정적인 도움을 주는 사람이나 기회를 만날 가능성이 있습니다.',
  '문창귀인': '글과 공부에 재능이 있고 이해가 빠릅니다. 시험·자격·집필처럼 배움을 성과로 바꾸는 일에 유리합니다.',

  // --- 흉살 계열 ---
  '괴강살': '강한 카리스마와 결단력을 지니되, 극단으로 치우치지 않게 스스로를 다스리는 노력이 필요합니다.',
  '양인살': '추진력과 결단력이 강하지만, 그만큼 감정 기복이나 과단한 행동을 주의할 필요가 있습니다.',
  '백호대살': '한번 움직이면 결과가 크게 나는 강한 기운입니다. 무리한 속도와 안전사고만 조심하면 큰 일을 해내는 힘이 됩니다.',
  '원진살': '배우자·가까운 사람과의 관계에서 은근히 쌓이는 감정을 미리 대화로 풀어두는 게 좋습니다.',
  '귀문관살': '직관과 촉이 매우 예민합니다. 남이 놓치는 것을 알아채는 강점이 되지만, 생각이 과해질 때는 의식적으로 쉬어가야 합니다.',
  '공망': '해당 자리의 기운이 비어 있어 기대만큼 채워지지 않을 수 있습니다. 집착을 내려놓을수록 오히려 편안해지고, 정신적·종교적 영역에서는 도리어 힘이 됩니다.'
};

function buildSinsalExplanation(pillars) {
  const found = new Set();
  ['hour', 'day', 'month', 'year'].forEach(pos => {
    const p = pillars[pos];
    if (p && p.sinsal) p.sinsal.forEach(s => found.add(s));
  });
  if (found.size === 0) return '';
  // 해설 문구가 있는 항목만 표시 (빈 줄 방지)
  const items = Array.from(found)
    .filter(s => SINSAL_MEANINGS[s])
    .map(s => `<li><b>${escapeHtml(s)}</b> — ${escapeHtml(SINSAL_MEANINGS[s])}</li>`)
    .join('');
  if (!items) return '';
  return `<div class="sinsal-explain"><span class="sinsal-explain-title">신살 해설</span><ul>${items}</ul></div>`;
}


// 지장간 해설 박스
// pillars[pos].hiddenStems = [{hanja, hangul, element, tenGod}, ...]
// tonggeun = [{position, stem, element, rooted, roots}, ...]
const POS_LABEL = { year: '년주', month: '월주', day: '일주', hour: '시주' };

function buildHiddenStemsExplanation(pillars, tonggeun) {
  const rows = [];
  ['year', 'month', 'day', 'hour'].forEach(pos => {
    const p = pillars[pos];
    if (!p || !p.hiddenStems || !p.hiddenStems.length) return;
    const inner = p.hiddenStems.map(h =>
      `<span class="hs-item"><b>${escapeHtml(h.hanja)}</b> ${escapeHtml(h.hangul)}` +
      `<span class="hs-meta">${escapeHtml(h.element)}\u00b7${escapeHtml(h.tenGod || '')}</span></span>`
    ).join('<span class="hs-sep">/</span>');
    rows.push(
      `<li><span class="hs-pos">${POS_LABEL[pos]} ${escapeHtml(p.branchHanja)}` +
      `(${escapeHtml(p.branchHangul)})</span> 속에 <span class="hs-line">${inner}</span></li>`
    );
  });
  if (!rows.length) return '';

  let rootHtml = '';
  if (tonggeun && tonggeun.length) {
    const items = tonggeun.map(t => {
      const mark = t.rooted
        ? `<span class="hs-ok">뿌리 있음</span>`
        : `<span class="hs-no">드러나지 않아 약함</span>`;
      return `<li>${escapeHtml(t.position)} <b>${escapeHtml(t.stem)}</b>` +
             `(${escapeHtml(t.element)}) — ${mark}</li>`;
    }).join('');
    rootHtml = `<div class="hs-sub">뿌리(통근) 판정</div><ul class="hs-root">${items}</ul>`;
  }

  return `<div class="hidden-explain">
    <span class="hidden-explain-title">지장간 해설</span>
    <p class="hs-intro">지지(아래 네 글자) 안에는 겉으로 드러나지 않은 천간이 숨어 있습니다.
    이를 지장간이라 하며, 겉으로 보이지 않는 기질과 숨은 재능을 읽는 자리입니다.
    같은 글자라도 지장간에 뿌리를 두었는지에 따라 힘이 크게 달라집니다.</p>
    <ul class="hs-list">${rows.join('')}</ul>
    ${rootHtml}
  </div>`;
}

function buildPillarsTable(pillars) {
  const order = [
    ['시주', pillars.hour],
    ['일주', pillars.day],
    ['월주', pillars.month],
    ['년주', pillars.year]
  ];

  const headerCells = order.map(([label]) => `<th>${label}</th>`).join('');

  // 천간: 한자 + 한글을 한 줄에 나란히 (한글이 한자 오른쪽)
  const stemCells = order.map(([, p]) => {
    if (!p) return `<td><span class="hanja">-</span></td>`;
    return `<td><span class="hanja">${escapeHtml(p.stemHanja)}</span><span class="hangul-side">${escapeHtml(p.stemHangul)}</span></td>`;
  }).join('');

  // 지지: 한자 + 한글을 한 줄에 나란히
  const branchCells = order.map(([, p]) => {
    if (!p) return `<td><span class="jiji-main">-</span><div class="hangul-note">시각미상</div></td>`;
    return `<td><span class="jiji-main">${escapeHtml(p.branchHanja)}</span><span class="hangul-side">${escapeHtml(p.branchHangul)}</span></td>`;
  }).join('');

  // 지장간: 지지 바로 아래, 괄호로 묶어 글자 하나씩 세로로 나열
  const hiddenCells = order.map(([, p]) => {
    if (!p || !p.hiddenStemsHanja) return `<td></td>`;
    const chars = Array.from(p.hiddenStemsHanja)
      .map(c => `<div class="hidden-stem-char">${escapeHtml(c)}</div>`)
      .join('');
    return `<td class="hidden-stems-cell">
      <div class="hidden-stems-wrap">
        <span class="paren paren-top">(</span>
        <div class="hidden-stem-col">${chars}</div>
        <span class="paren paren-bottom">)</span>
      </div>
    </td>`;
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
    <tr class="hidden-stems-row">${hiddenCells}</tr>
    <tr class="sinsal-row">${sinsalCells}</tr>
  </table>`;
}

// 대운 블록 HTML 생성
// daewoonList = [{ ageRange, ganji, hanja, tenGods, branchLetter, descriptionHtml }, ...]
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
  @page { size: A4; margin: 13mm 15mm 13mm 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    font-size: 14pt; line-height: 2; color: #2b2820; background: #fdfbf5;
    margin: 0;
    text-align: justify;
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

  .pillars-table { width: 100%; border-collapse: collapse; margin: 10px 0 20px; text-align: center; }
  .pillars-table th { background: #ece3cd; border: 1px solid #2b2820; padding: 8px 4px; font-size: 12pt; color: #4a4536; text-align: center; }
  .pillars-table td { border: 1px solid #c9b98a; text-align: center; padding: 10px 6px; }
  .cheongan-row td { border-bottom: none; padding-bottom: 4px; }
  .jiji-row td { border-top: none; border-bottom: none; padding-top: 2px; padding-bottom: 2px; }
  .hidden-stems-row td { border-top: none; padding-top: 0; padding-bottom: 10px; }
  .sinsal-row td { border-top: 1px dashed #c9b98a; padding: 6px 4px 10px; }
  .sinsal-cell { text-align: center; }
  .sinsal-tag { display: inline-block; font-size: 9pt; color: #8c2d24; background: #fbeceb; border: 1px solid #e3b8b3; border-radius: 8px; padding: 1px 6px; margin: 1px 2px; }

  .person-label {
    font-family: 'Noto Serif KR', serif; font-size: 13pt; font-weight: bold; color: #ffffff;
    background: #4a4536; display: inline-block; padding: 3px 16px; margin: 18px 0 4px;
  }
  .person-label.partner { background: #8c6d2f; }

  .sinsal-explain { background: #fbeceb; border: 1px solid #e3b8b3; padding: 10px 16px; margin: 4px 0 20px; }
  .sinsal-explain-title { font-family: 'Noto Serif KR', serif; font-weight: bold; font-size: 11.5pt; color: #8c2d24; }
  .sinsal-explain ul { margin: 6px 0 0; padding-left: 18px; }
  .sinsal-explain li { font-size: 11pt; line-height: 1.6; margin-bottom: 3px; }

  .hanja { font-family: 'Noto Serif KR', serif; font-size: 22pt; line-height: 1.3; }
  .hangul-side { font-family: 'Noto Sans KR', sans-serif; font-size: 12pt; color: #4a4536; margin-left: 6px; vertical-align: middle; }
  .hangul-note { font-size: 11pt; color: #4a4536; margin-top: 2px; }
  .jiji-main { font-family: 'Noto Serif KR', serif; font-size: 22pt; }

  /* 지장간 : 지지 바로 아래, 괄호로 감싼 세로 나열 */
  .hidden-stems-cell { padding-top: 0 !important; }
  .hidden-stems-wrap {
    display: inline-flex; flex-direction: column; align-items: center; line-height: 1;
  }
  .hidden-stem-col { display: flex; flex-direction: column; align-items: center; margin: 1px 0; }
  .hidden-stem-char {
    font-family: 'Noto Serif KR', serif; font-size: 12pt; color: #6b6450; line-height: 1.25;
  }
  .paren {
    font-family: 'Noto Serif KR', serif; font-size: 13pt; color: #9a927c; line-height: 1;
    display: block; transform: rotate(90deg);
  }

  .hidden-explain { background: #eef1ea; border: 1px solid #9cb391; padding: 10px 16px; margin: 4px 0 18px; }
  .hidden-explain-title { font-family: 'Noto Serif KR', serif; font-weight: bold; font-size: 11.5pt; color: #3f6b4a; }
  .hs-intro { font-size: 10.5pt; line-height: 1.6; color: #4a4536; margin: 6px 0 8px; }
  .hs-list { margin: 0; padding-left: 18px; }
  .hs-list li { font-size: 11pt; line-height: 1.7; margin-bottom: 3px; }
  .hs-pos { font-family: 'Noto Serif KR', serif; font-weight: bold; color: #2b2820; }
  .hs-item { white-space: nowrap; }
  .hs-meta { font-size: 9pt; color: #6b6450; margin-left: 3px; }
  .hs-sep { color: #9cb391; margin: 0 6px; }
  .hs-sub { font-family: 'Noto Serif KR', serif; font-weight: bold; font-size: 10.5pt; color: #3f6b4a; margin: 10px 0 2px; }
  .hs-root { margin: 0; padding-left: 18px; }
  .hs-root li { font-size: 10.5pt; line-height: 1.6; margin-bottom: 2px; }
  .hs-ok { color: #3f6b4a; font-weight: bold; }
  .hs-no { color: #8c6d2f; }

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
 */
function buildReportHTML(data) {
  const cover = buildCoverPage({
    name: data.name,
    birthInfoText: data.birthInfoText,
    ganDate: data.ganDate
  });

  const hasPartner = !!(data.partnerPillars);
  const meLabel = data.personLabel || '';
  const youLabel = data.partnerLabel || '상대방';

  function personBlock(label, cls, pillars, tonggeun) {
    const tag = label
      ? `<div class="person-label ${cls}">${escapeHtml(label)}</div>`
      : '';
    return tag
      + buildPillarsTable(pillars)
      + buildHiddenStemsExplanation(pillars, tonggeun)
      + buildSinsalExplanation(pillars);
  }

  const pillarsHtml = hasPartner
    ? personBlock(meLabel, 'me', data.pillars, data.tonggeun)
      + personBlock(youLabel, 'partner', data.partnerPillars, data.partnerTonggeun)
    : buildPillarsTable(data.pillars)
      + buildHiddenStemsExplanation(data.pillars, data.tonggeun)
      + buildSinsalExplanation(data.pillars);

  const hiddenExplainHtml = '';
  const sinsalExplainHtml = '';

  function daewoonSection(label, cls, list) {
    if (!list || !list.length) return '';
    const tag = label ? `<div class="person-label ${cls}">${escapeHtml(label)}</div>` : '';
    return tag + `<div class="daewoon-grid">${buildDaewoonBlocks(list)}</div>`;
  }

  let daewoonHtml = '';
  if (hasPartner) {
    const a = daewoonSection(meLabel, 'me', data.daewoonList);
    const b = daewoonSection(youLabel, 'partner', data.partnerDaewoonList);
    if (a || b) {
      daewoonHtml = `<h2 class="section-title">대운의 흐름 (10년 단위, 세는나이 기준)</h2>` + a + b;
    }
  } else if (data.daewoonList && data.daewoonList.length) {
    daewoonHtml = `<h2 class="section-title">대운의 흐름 (10년 단위, 세는나이 기준)</h2>`
      + `<div class="daewoon-grid">${buildDaewoonBlocks(data.daewoonList)}</div>`;
  }

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
${hiddenExplainHtml}
${sinsalExplainHtml}
${daewoonHtml}
<div class="content">
${interpretationHtml}
</div>
</body>
</html>`;
}

module.exports = { buildReportHTML, escapeHtml };
