// api/generate-pdf.js
//
// 이 함수는 사주 데이터 + 해석 텍스트를 JSON으로 받아서
// Puppeteer(실제 크롬 엔진)로 렌더링한 PDF를 돌려줍니다.
// wkhtmltopdf와 달리 실제 브라우저 엔진을 쓰기 때문에 한자·한글 텍스트가
// PDF 안에 정상적으로 저장됩니다 (복사·검색·화면낭독 전부 정상 작동).
//
// 배포: Vercel에 이 프로젝트를 그대로 올리면 /api/generate-pdf 로 호출 가능합니다.
//
// 요청 예시 (POST, Content-Type: application/json):
// {
//   "name": "홍길동",
//   "birthInfoText": "2004년 5월 31일 사시(巳時) 生 · 남자 · 양력",
//   "ganDate": "2026년 9월 15일",
//   "pillars": {
//     "year":  { "stemHanja":"甲","stemHangul":"갑","branchHanja":"申","branchHangul":"신","hiddenStemsHanja":"戊壬庚" },
//     "month": { "stemHanja":"己","stemHangul":"기","branchHanja":"巳","branchHangul":"사","hiddenStemsHanja":"戊庚丙" },
//     "day":   { "stemHanja":"庚","stemHangul":"경","branchHanja":"戌","branchHangul":"술","hiddenStemsHanja":"辛丁戊" },
//     "hour":  { "stemHanja":"辛","stemHangul":"신","branchHanja":"巳","branchHangul":"사","hiddenStemsHanja":"戊庚丙" }
//   },
//   "daewoonList": [
//     { "ageRange":"3~12세", "ganji":"경오", "hanja":"庚午", "tenGods":"비견 + 편관", "branchLetter":"오",
//       "descriptionHtml":"조후가 가장 어려운 시기. <b>신강함과 편관이 부딪히며 규율 속에서 단련되는 유년기입니다.</b>" }
//   ],
//   "interpretationMarkdown": "## 신강신약\n...(Claude가 생성한 본문, **볼드**는 실질적 결과 문장)..."
// }
//
// 응답: application/pdf 바이너리

const path = require('path');
const { buildReportHTML } = require('../lib/reportTemplate');

// Vercel 서버리스 환경에서는 puppeteer-core + @sparticuz/chromium 조합을 씁니다.
// (일반 puppeteer 패키지는 크로미움 전체를 포함해서 서버리스 배포 용량 제한에 걸립니다.)
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  let data;
  try {
    data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    res.status(400).json({ error: '요청 본문이 올바른 JSON이 아닙니다.' });
    return;
  }

  if (!data || !data.name || !data.pillars) {
    res.status(400).json({ error: 'name, pillars 등 필수 필드가 누락되었습니다.' });
    return;
  }

  let browser;
  try {
    const html = buildReportHTML(data);

    const executablePath = await chromium.executablePath();
    // libnss3.so 등 공유 라이브러리를 크로미움 실행파일과 같은 폴더에서 찾도록
    // 명시적으로 지정합니다 (이게 없으면 파일은 있어도 못 찾는 경우가 흔합니다).
    process.env.LD_LIBRARY_PATH = [path.dirname(executablePath), process.env.LD_LIBRARY_PATH || '']
      .filter(Boolean).join(':');

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless
    });

    const page = await browser.newPage();
    // 폰트 로딩 등을 위해 networkidle0까지 대기
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' } // 여백은 HTML @page에서 지정
    });

    await browser.close();

    const fileName = encodeURIComponent(`${data.name}_사주해설서.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${fileName}`);
    res.status(200).send(pdfBuffer);
  } catch (err) {
    if (browser) { try { await browser.close(); } catch (_) {} }
    console.error('PDF 생성 오류:', err);
    res.status(500).json({ error: 'PDF 생성 중 오류가 발생했습니다.', detail: err.message });
  }
};
