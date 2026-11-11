/* 자동 점검: node tests/site.test.js  (사전에 `python3 -m http.server 8765` 실행, playwright 필요)
   결과는 PASS/FAIL로 출력하고, 실패가 있으면 종료 코드 1 */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const BASE = process.env.BASE || "http://localhost:8765/index.html";
const root = path.join(__dirname, "..");
const out = []; let fail = 0;
const t = (name, ok, note="") => { out.push(`${ok?"PASS":"FAIL"} | ${name}${note?" | "+note:""}`); if(!ok) fail++; };

(async () => {
  /* --- 정적 점검 --- */
  const reg = JSON.parse(fs.readFileSync(path.join(root,"data/regulations.json"),"utf8"));
  const hist = JSON.parse(fs.readFileSync(path.join(root,"data/historical-visual-examples.json"),"utf8"));
  t("기준 데이터: 모든 규칙에 출처·조문·확인일", reg.rules.every(r => reg.sources[r.source] && r.article!==undefined && r.checked));
  t("기준 데이터: 미확인 규칙에는 판정식 없음", reg.rules.filter(r=>r.status==="unverified").every(r=>!r.check));
  t("기준 데이터: 판정식 있는 규칙은 확인된 상태", reg.rules.filter(r=>r.check).every(r=>["verified","verified-secondary"].includes(r.status)));
  t("과거 자료: 전 항목 historical·미검증 표시", hist.items.every(i=>i.historical_reference===true && i.current_legal_status==="unverified"));
  const code = ["index.html","js/visual.js","scripts/update_biz.py"].map(f=>fs.readFileSync(path.join(root,f),"utf8")).join("\n");
  t("API 키·토큰 문자열 없음", !/(sk-ant-|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*["'][^"']{8,})/i.test(code));
  const vjs = fs.readFileSync(path.join(root,"js/visual.js"),"utf8");
  t("visual.js: 과거 자료를 판정에 쓰지 않음", !/hist[^;\n]*\.check|H\.items[^;\n]*check/.test(vjs));
  const imgs = []; (function walk(d){ for(const f of fs.readdirSync(d)){ if(f===".git"||f==="node_modules") continue; const p=path.join(d,f); fs.statSync(p).isDirectory()?walk(p):/\.(jpe?g|png|gif|webp|pdf)$/i.test(f)&&imgs.push(path.relative(root,p)); } })(root);
  const allowed = new Set(["assets/nyj-ci-symbol.png","qrcode.png","qr-poster.png","qr-poster.pdf"]);
  t("저장소에 카페 사진·PDF 원본 없음", imgs.every(f=>allowed.has(f.replace(/\\/g,"/")) || f.startsWith("docs/challenge/img/")), imgs.join(", "));

  /* --- 브라우저 점검 --- */
  const b = await chromium.launch();
  const errs = [];
  const mk = async opt => { const c = await b.newContext(opt); const p = await c.newPage(); p.on("pageerror",e=>errs.push(e.message)); return p; };
  const p = await mk({viewport:{width:1200,height:900}});
  await p.goto(BASE); await p.waitForSelector(".card");
  t("첫 화면: 메뉴 카드 9개", (await p.locator(".card").count())===9);
  t("첫 화면: 주요 버튼 '내 간판 설치기준 알아보기'", await p.getByText("내 간판 설치기준 알아보기").isVisible());
  for (const h of ["diagnose","standards","documents","process","fees","biz","faq","contact","ai"]) {
    await p.goto(BASE+"#"+h); await p.waitForTimeout(250);
    t(`기존 화면 #${h} 열림`, (await p.locator("#app h2").count())>0);
  }
  // 수수료 계산기 회귀: 가로형 5.8×1.5m = 8.7㎡ → 6,000원 (조례 별표 3)
  await p.goto(BASE+"#fees"); await p.waitForSelector(".calc");
  const ins = p.locator(".calc input[type=number]"); await ins.nth(0).fill("5.8"); await ins.nth(1).fill("1.5"); await p.waitForTimeout(200);
  t("수수료 계산기 회귀(8.7㎡)", /6,000/.test(await p.locator(".calc-out").innerText()));

  // 그림 안내
  await p.goto(BASE+"#visual"); await p.waitForSelector(".vg-sim");
  const verdict = () => p.locator("#vgResult .big").innerText();
  const set = (o) => p.evaluate(o => { Object.assign(window.__VG.V, o); window.drawVisual(document.getElementById("panel")); }, o);
  await p.click('[data-pre="0"]'); t("벽면 예시1 → 부합", (await verdict())==="확인된 기준에 부합");
  await p.click('[data-pre="1"]'); t("벽면 예시2 → 제한·위반 가능성", /제한 또는 위반/.test(await verdict()));
  t("벽면 예시2 → 빨간 표시 3건", (await p.locator(".vg-row.bad").count())===3);
  await p.click('[data-pre="2"]'); t("벽면 예시3(창문 없음) → 추가 확인", /추가 조건/.test(await verdict()));
  await set({type:"wall",region:"general",floors:3,floor:1,bldgW:8,bandH:100,noWindow:false,signW:6,signH:80,signD:20,form:"panel"});
  const svg1 = await p.locator(".vg-pics").innerHTML();
  await p.locator('[data-k="signH"]').fill("150"); await p.locator('[data-k="signH"]').dispatchEvent("change");
  t("입력값 바꾸면 그림과 판정이 바뀜", (await p.locator(".vg-pics").innerHTML())!==svg1 && /제한 또는 위반/.test(await verdict()));
  await set({signH:80,region:"zone-new",form:"panel"}); t("신택지지구 + 판류형 → 제한", /제한 또는 위반/.test(await verdict()));
  await set({form:"solid",signH:60}); t("신택지지구 + 입체형 60cm → 부합", (await verdict())==="확인된 기준에 부합");
  await set({signH:65}); t("신택지지구 글자 65cm(1층) → 제한", /제한 또는 위반/.test(await verdict()));
  await set({region:"zone-pilot"}); t("정비시범구역(미확인) → 판정 불가", /판정 불가/.test(await verdict()));
  t("미확인 구역에서 '맞음' 표시 없음", (await p.locator(".vg-row.ok").count())===0);
  await set({region:"unknown",form:"panel",signH:80}); t("구역 모름 → 부합으로 단정하지 않음", /추가 조건/.test(await verdict()));
  await set({region:"general",signW:0}); t("잘못된 입력(0) → 판정 숨기고 안내", (await p.locator("#vgResult").count())===0 && await p.locator(".vg-empty").isVisible());
  await set({signW:6,floor:5,floors:3}); t("층 입력 오류 → 안내", await p.locator(".vg-empty").isVisible());
  await set({type:"proj",region:"general",floors:4,pFloor:2,bottom:3.5,sidewalk:"yes",out:100,len:3,thick:30,zone:"other"});
  t("돌출 기본 → 부합", (await verdict())==="확인된 기준에 부합");
  await set({sidewalk:"no"}); t("돌출: 인도 없음 3.5m → 제한(4m 이상)", /제한 또는 위반/.test(await verdict()));
  await set({sidewalk:"yes",out:130}); t("돌출 130cm → 제한(1.2m)", /제한 또는 위반/.test(await verdict()));
  await set({out:100});
  t("모든 판정 줄에 근거 링크·확인일", await p.evaluate(()=>[...document.querySelectorAll("#vgSummary .vg-row")].every(li=>li.querySelector(".vg-src a[href^='http']") && /확인일 \d{4}-\d\d-\d\d/.test(li.textContent))));
  t("허가증이 아니라는 문구", /허가증이나 적합 확인서가 아닙니다/.test(await p.locator("#vgSummary").innerText()));
  await p.locator("#vgQ").fill("입체형"); await p.waitForTimeout(600);
  t("검색: '입체형' 결과 있음", (await p.locator("#vgHits .vg-row").count())>0);
  await p.locator("#vgQ").fill("주차장"); await p.waitForTimeout(600);
  t("검색: 근거 없으면 답하지 않음", /찾지 못했습니다/.test(await p.locator("#vgHits").innerText()));
  t("'AI 챗봇이 아닙니다' 표시", /AI 챗봇이 아닙니다/.test(await p.locator("#app").innerText()));
  // 원안·수정안 비교
  await p.goto(BASE+"#visual"); await p.waitForSelector(".vg-sim");
  await p.evaluate(()=>window.__VG.drop()); await set({type:"wall",region:"general"});
  await p.click('[data-pre="1"]'); await p.click("#vgKeep");
  await set({signW:6,signH:80,signD:20});
  t("비교: 원안(제한)·수정안(부합) 나란히 표시", await p.evaluate(()=>{ const f=[...document.querySelectorAll("#vgCompare figure")]; return f.length===2 && /제한 또는 위반/.test(f[0].textContent) && /기준에 부합/.test(f[1].textContent) && f.every(x=>x.querySelector("svg")); }));
  t("비교: 바뀐 값 3개 표시", (await p.locator(".vg-diff li").count())===3);
  await p.click("#vgBack"); t("비교: 원안 값으로 되돌리기", await p.evaluate(()=>window.__VG.V.signH===140));
  await p.click("#vgDrop"); t("비교: 끝내기", (await p.locator("#vgCompare").count())===0);
  // 인쇄 화면
  await p.emulateMedia({media:"print"});
  t("인쇄: 입력란 숨김·결과와 그림 표시", await p.evaluate(()=>getComputedStyle(document.querySelector(".vg-in")).display==="none" && getComputedStyle(document.querySelector("#vgSummary")).display!=="none" && getComputedStyle(document.querySelector(".vg-pics")).display!=="none" && getComputedStyle(document.querySelector("header")).display==="none"));
  await p.emulateMedia({media:"screen"});
  // 지역 규칙 바꿔 끼우기(가상 지역)
  const s2 = await mk({viewport:{width:1100,height:900}});
  await s2.goto(BASE+"?rules=sample#visual"); await s2.waitForSelector(".vg-sim");
  t("가상 지역: 예시 안내 문구 표시", /가상 지역 예시 화면/.test(await s2.locator("#vgSample").innerText()));
  t("가상 지역: 구역 버튼이 규칙 파일대로 바뀜", /가상 경관구역 A/.test(await s2.locator(".vg-reg").innerText()) && !/신택지/.test(await s2.locator(".vg-reg").innerText()));
  await s2.evaluate(()=>{ Object.assign(window.__VG.V,{type:"wall",region:"general",floors:3,floor:1,bldgW:8,bandH:100,noWindow:false,signW:6,signH:80,signD:28,form:"panel"}); window.drawVisual(document.getElementById("panel")); });
  t("가상 지역: 같은 코드로 다른 기준 적용(돌출 28cm → 제한)", /제한 또는 위반/.test(await s2.locator("#vgResult .big").innerText()));
  t("가상 지역: 결과에 '가상 예시' 표시", /가상 예시\(실제 기준 아님\)/.test(await s2.locator("#vgSummary").innerText()));
  await set({type:"wall",region:"general",floors:3,floor:1,bldgW:8,bandH:100,noWindow:false,signW:6,signH:80,signD:28,form:"panel"});
  t("남양주 기준: 같은 입력(돌출 28cm) → 부합", (await verdict())==="확인된 기준에 부합");
  const s3 = await mk({viewport:{width:800,height:800}});
  await s3.goto(BASE+"?rules=../../x#visual"); await s3.waitForSelector(".vg-sim");
  t("규칙 파일 이름에 경로 문자를 넣으면 기본 파일 사용", await s3.evaluate(()=>window.__VG.file==="data/regulations.json"));
  const sm = JSON.parse(fs.readFileSync(path.join(root,"data/regulations.sample.json"),"utf8"));
  t("가상 지역 파일: sample 표시와 '실제 아님' 문구", sm.meta.sample===true && sm.rules.every(r=>r.status==="sample" && /가상/.test(r.rule)));
  // 접근성 기본
  t("그림에 대체 설명(role=img + aria-label)", await p.evaluate(()=>[...document.querySelectorAll(".vg-pics svg")].every(s=>s.getAttribute("role")==="img" && (s.getAttribute("aria-label")||"").length>10)));
  t("입력란 전부 이름표 있음", await p.evaluate(()=>[...document.querySelectorAll(".vg-in input,.vg-in select,#vgQ")].every(n=>n.closest("label")||n.getAttribute("aria-label"))));
  await p.goto(BASE+"#visual"); await p.waitForSelector(".vg-sim");
  await p.locator('[data-type="proj"]').focus(); await p.keyboard.press("Enter"); await p.waitForTimeout(200);
  t("키보드(Enter)로 간판 종류 선택", await p.evaluate(()=>window.__VG.V.type==="proj"));
  // 반응형
  for (const [n,w,h] of [["휴대폰",360,740],["태블릿",768,1024],["PC",1280,800]]) {
    const q = await mk({viewport:{width:w,height:h}});
    for (const hsh of ["","#visual"]) { await q.goto(BASE+hsh); await q.waitForTimeout(500);
      const over = await q.evaluate(()=>document.documentElement.scrollWidth - window.innerWidth);
      t(`${n}(${w}px) ${hsh||"첫 화면"} 가로 넘침 없음`, over<=1, "넘침 "+over+"px"); }
    await q.context().close();
  }
  // 기준 자료 실패 시
  const r = await mk({viewport:{width:800,height:800}});
  await r.route("**/data/regulations.json*", x=>x.abort());
  await r.goto(BASE+"#visual"); await r.waitForTimeout(800);
  t("기준 자료를 못 불러오면 판정 없이 안내", /불러오지 못했습니다/.test(await r.locator("#app").innerText()) && (await r.locator("#vgResult").count())===0);
  t("화면 오류(JS 예외) 없음", errs.length===0, errs.join(" / "));
  await b.close();
  console.log(out.join("\n")); console.log(`\n합계 ${out.length}건 · 통과 ${out.length-fail} · 실패 ${fail}`);
  process.exit(fail?1:0);
})();
