# 운명마스터 - 사주 해설서 PDF 서버

Puppeteer(실제 크롬 엔진)로 사주 해설서 PDF를 만드는 서버입니다.
기존 Apps Script의 `generateStyledPDF`(구글 문서 기반, 디자인 단순)를 대신해서,
지금까지 만든 예쁜 디자인(카드형 레이아웃, 오행 색상 구분, 직인)을 그대로 살리고
**한자 인코딩 깨짐 문제도 해결**된 버전입니다.

## 폴더 구성

```
saju-pdf-server/
├── package.json
├── vercel.json          # Vercel 함수 메모리/시간 제한 설정
├── lib/
│   └── reportTemplate.js  # HTML 리포트 템플릿 생성 로직
└── api/
    └── generate-pdf.js    # PDF 생성 서버리스 함수 (실제 진입점)
```

## 1. 배포 방법 (Vercel 기준)

1. [vercel.com](https://vercel.com) 가입 (깃허브 계정으로 가입하면 편합니다)
2. 이 폴더를 본인 깃허브 저장소에 올립니다 (또는 Vercel CLI로 직접 배포 가능)
3. Vercel 대시보드에서 "New Project" → 방금 올린 저장소 선택 → Deploy
4. 배포가 끝나면 `https://your-project.vercel.app` 같은 주소가 생깁니다.
   PDF 생성 주소는 `https://your-project.vercel.app/api/generate-pdf` 입니다.

CLI로 직접 배포하고 싶으시면 (Node.js 설치되어 있어야 함):
```bash
npm install -g vercel
cd saju-pdf-server
vercel --prod
```

## 2. 직인(로고) 이미지 등록 (선택)

직인 이미지를 실제로 넣고 싶으시면, Vercel 프로젝트 설정의 "Environment Variables"에
`SEAL_IMAGE_BASE64` 라는 이름으로 직인 PNG의 base64 문자열을 등록하세요.
(Apps Script 코드의 `SEAL_IMAGE_BASE64` 상수와 같은 값을 쓰시면 됩니다.)
등록하지 않으면 텍스트로 된 기본 직인 모양이 대신 표시됩니다.

## 3. 로컬에서 테스트하는 법

```bash
cd saju-pdf-server
npm install
node -e "
const { buildReportHTML } = require('./lib/reportTemplate');
const fs = require('fs');
const html = buildReportHTML({
  name: '홍길동',
  birthInfoText: '2004년 5월 31일 사시(巳時) 生 · 남자 · 양력',
  ganDate: '2026년 9월 15일',
  pillars: {
    year:  { stemHanja:'甲', stemHangul:'갑', branchHanja:'申', branchHangul:'신', hiddenStemsHanja:'戊壬庚' },
    month: { stemHanja:'己', stemHangul:'기', branchHanja:'巳', branchHangul:'사', hiddenStemsHanja:'戊庚丙' },
    day:   { stemHanja:'庚', stemHangul:'경', branchHanja:'戌', branchHangul:'술', hiddenStemsHanja:'辛丁戊' },
    hour:  { stemHanja:'辛', stemHangul:'신', branchHanja:'巳', branchHangul:'사', hiddenStemsHanja:'戊庚丙' }
  },
  interpretationMarkdown: '## 신강신약\n네 지지 모두 통근처. **전체적으로 신강한 사주입니다.**'
});
fs.writeFileSync('test.html', html);
"
# test.html을 브라우저로 열어서 디자인 확인
```

## 4. Google Apps Script에서 이 서버 호출하기

기존 `사주_자동발송_AppsScript_v2.gs`의 `generateStyledPDF` 함수를 아래처럼 바꾸면,
구글 문서 대신 이 서버가 만든 예쁜 PDF를 받아서 그대로 이메일에 첨부할 수 있습니다.

```javascript
// 기존 generateStyledPDF(...) 함수를 아래 함수로 교체
function generateStyledPDF(name, saju, gender, unknownTime, interpretationText, items) {
  const PDF_SERVER_URL = 'https://your-project.vercel.app/api/generate-pdf'; // 배포 후 실제 주소로 교체

  const payload = {
    name: name,
    birthInfoText: `${saju.solarDate.y}년 ${saju.solarDate.m}월 ${saju.solarDate.d}일 ` +
      (unknownTime ? '(시각 미상)' : `${saju.solarDate.hour}시 ${saju.solarDate.minute}분`) + ` · ${gender} · 양력`,
    ganDate: Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy'년 'M'월 'd'일'"),
    pillars: {
      year:  pillarToPayload(saju.yearP),
      month: pillarToPayload(saju.monthP),
      day:   pillarToPayload(saju.dayP),
      hour:  saju.hourP ? pillarToPayload(saju.hourP) : null
    },
    daewoonList: saju.daewoon.list.map(item => ({
      ageRange: item.age + '세~',
      ganji: item.pillar.hangul,
      hanja: item.pillar.hanja,
      tenGods: '', // 필요시 십성 텍스트를 채워 넣으세요
      branchLetter: item.pillar.hangul[1],
      descriptionHtml: '' // 필요시 대운별 설명을 채워 넣으세요
    })),
    interpretationMarkdown: interpretationText // Claude API 응답 (마크다운) 그대로 전달
  };

  const response = UrlFetchApp.fetch(PDF_SERVER_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('PDF 서버 오류: ' + response.getContentText());
  }

  const pdfBlob = response.getBlob();
  pdfBlob.setName(`${name}_사주해설서.pdf`);
  return pdfBlob;
}

function pillarToPayload(p) {
  return {
    stemHanja: p.hanja[0], stemHangul: p.hangul[0],
    branchHanja: p.hanja[1], branchHangul: p.hangul[1],
    hiddenStemsHanja: p.hiddenStems.join('')
  };
}
```

## 5. 비용

- Vercel 무료 티어: 월 100GB 대역폭, 함수 실행시간 넉넉 — 소규모 신청량(하루 수십 건 이하)이면 무료로 충분합니다.
- 신청량이 크게 늘면 (하루 수백 건 이상) 유료 플랜(월 $20~) 전환을 고려하시면 됩니다.

## 6. 문제 해결

- **"Chromium을 찾을 수 없다" 오류**: `@sparticuz/chromium` 버전과 `puppeteer-core` 버전이 서로 호환되는지 확인하세요 (package.json의 버전 조합을 그대로 쓰면 문제없습니다).
- **한글 폰트가 깨져 보임**: Vercel 서버리스 환경엔 한글 폰트가 기본 설치되어 있지 않을 수 있습니다. 이 경우 `@sparticuz/chromium`의 폰트 번들 옵션을 확인하거나, 웹폰트(Google Fonts CDN)를 HTML에 `<link>`로 추가하는 방법도 있습니다.
