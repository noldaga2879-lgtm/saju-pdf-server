// api/generate-pdf.js
//
// 이 함수는 사주 데이터 + 해석 텍스트를 JSON으로 받아서
// PDFShift(전문 HTML→PDF 변환 API)를 통해 고품질 PDF를 생성합니다.
//
// 왜 Puppeteer 대신 PDFShift인가:
// Vercel 같은 서버리스 환경에서 Chromium을 직접 실행하는 방식(@sparticuz/chromium)은
// "libnss3.so 없음" 같은 공유 라이브러리 오류가 플랫폼·버전에 따라 계속 발생하는
// 것으로 악명 높습니다(2022년부터 지금까지 커뮤니티에서 반복적으로 보고됨).
// PDFShift는 이 크로미움 실행 환경 자체를 대신 관리해주는 전문 서비스라,
// 이런 인프라 문제 없이 안정적으로 예쁜 PDF를 받을 수 있습니다.
//
// 사전 준비:
// 1. https://pdfshift.io 가입 (무료 티어로 시작 가능)
// 2. API 키 발급
// 3. Vercel 프로젝트 설정 → Environment Variables 에 PDFSHIFT_API_KEY 로 등록
//
// 배포: Vercel에 이 프로젝트를 그대로 올리면 /api/generate-pdf 로 호출 가능합니다.
//
// 요청 예시 (POST, Content-Type: application/json):
// {
//   "name": "홍길동",
//   "birthInfoText": "2004년 5월 31일 사시(巳時) 生 · 남자 · 양력",
//   "ganDate": "2026년 9월 15일",
//   "pillars": { "year": {...}, "month": {...}, "day": {...}, "hour": {...} },
//   "daewoonList": [ {...} ],
//   "interpretationMarkdown": "## 신강신약\n...(Claude가 생성한 본문)..."
// }
//
// 응답: application/pdf 바이너리

const { buildReportHTML } = require('../lib/reportTemplate');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const apiKey = process.env.PDFSHIFT_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'PDFSHIFT_API_KEY 환경변수가 설정되어 있지 않습니다. Vercel 프로젝트 설정에서 등록해주세요.' });
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

  try {
    const html = buildReportHTML(data);

    // PDFShift API 호출 (X-API-Key 헤더 방식)
    const response = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: html,
        format: 'A4',
        use_print: false,
        // 여백은 HTML의 @page CSS(상하 13mm, 좌우 15mm)에서 이미 지정했으므로
        // PDFShift 자체 margin은 0으로 둬서 중복 적용을 막습니다.
        margin: '0',
       delay: 3000
     })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`PDFShift 오류 (HTTP ${response.status}): ${errText.substring(0, 300)}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    const fileName = encodeURIComponent(`${data.name}_사주해설서.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${fileName}`);
    res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('PDF 생성 오류:', err);
    res.status(500).json({ error: 'PDF 생성 중 오류가 발생했습니다.', detail: err.message });
  }
};
