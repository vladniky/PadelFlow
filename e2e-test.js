const { chromium } = require('playwright');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, 'index.html');
let pass = 0, fail = 0;
const fails = [];

function check(name, cond, extra){
  if(cond){ pass++; }
  else { fail++; fails.push(name + (extra !== undefined ? ` [${JSON.stringify(extra)}]` : '')); }
}

async function fillPairs(page, n){
  for(let i=1;i<=n;i++){
    await page.fill(`#team${i}a`, `A${i}`);
    await page.fill(`#team${i}b`, `B${i}`);
  }
}

async function showTournament(page){
  await page.evaluate(()=>{
    if(typeof hideHomeScreen === 'function') hideHomeScreen();
    switchTab('tournament');
  });
}

async function setupPairsTournament(page, {pairs=4, circles=2, courts=2, limit='21'}={}){
  await showTournament(page);
  await page.selectOption('#tournamentFormat', 'pairs');
  await page.selectOption('#pairCount', String(pairs));
  await page.selectOption('#roundCount', String(circles));
  await page.selectOption('#courtCount', String(courts));
  await page.selectOption('#roundLimit', limit);
  await page.fill('#tournamentDate', '2026-10-14');
  await fillPairs(page, pairs);
  await page.evaluate(()=>updateStartTournamentState());
}

async function enterAllScores(page){
  const ids = await page.evaluate(()=>
    Array.from(document.querySelectorAll('#matches input[id^="a-"]')).map(el=>el.id)
  );
  for(const id of ids){
    const r = id.slice(2);
    await page.fill(`#a-${r}`, '21');
    await page.fill(`#b-${r}`, '15');
  }
  return ids.length;
}

(async ()=>{
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: {width:390, height:844} });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());

  // ============================================ 1. BASELINE START
  await page.goto(URL);
  await page.evaluate(()=>localStorage.clear());
  await page.goto(URL);
  await page.evaluate(()=>{ if(typeof hideHomeScreen==='function') hideHomeScreen(); switchTab('tournament'); });

  await setupPairsTournament(page);
  check('1.1 start button enabled after filling form',
    await page.evaluate(()=>!document.getElementById('startTournamentBtn').disabled));

  await page.evaluate(()=>startTournament());
  const r0 = await page.evaluate(()=>rounds.length);
  check('1.2 schedule built (4 pairs x 2 circles = 6 rounds)', r0 === 6, r0);
  check('1.3 settings locked during tournament',
    await page.evaluate(()=>document.getElementById('pairCount').disabled));
  check('1.4 score inputs present with expected ids',
    await page.evaluate(()=>Boolean(document.getElementById('a-0-0') && document.getElementById('b-0-0'))));

  // ============================================ 2. BUG A: EXTEND RUNNING TOURNAMENT
  check('2.1 "Добавить круг" button rendered while tournament runs',
    await page.evaluate(()=>Boolean(document.getElementById('addCircleBtn'))));

  // fill circle 1 + 2 fully
  const totalBefore = await enterAllScores(page);
  check('2.2 all scores entered', totalBefore === 12, totalBefore);

  const snapBefore = await page.evaluate(()=>{
    const m = {};
    document.querySelectorAll('#matches input[id^="a-"], #matches input[id^="b-"]').forEach(el=>m[el.id]=el.value);
    return m;
  });
  const matchupsBefore = await page.evaluate(()=>
    rounds.map(r=>r.map(m=>JSON.stringify(m)).join('|')).join(';')
  );

  await page.evaluate(()=>addTournamentCircle());
  const r1 = await page.evaluate(()=>rounds.length);
  check('2.3 circle added (6 -> 9 rounds)', r1 === 9, r1);
  check('2.4 circle select bumped to 3',
    await page.evaluate(()=>document.getElementById('roundCount').value) === '3');

  const matchupsAfter = await page.evaluate(()=>
    rounds.slice(0,6).map(r=>r.map(m=>JSON.stringify(m)).join('|')).join(';')
  );
  check('2.5 first 6 rounds unchanged (prefix-stable schedule)',
    matchupsAfter === matchupsBefore);

  const snapAfter = await page.evaluate(()=>{
    const m = {};
    document.querySelectorAll('#matches input[id^="a-"], #matches input[id^="b-"]').forEach(el=>{
      if(el.value !== '') m[el.id]=el.value;
    });
    return m;
  });
  let preserved = true;
  for(const [id,v] of Object.entries(snapBefore)){
    if(snapAfter[id] !== v) preserved = false;
  }
  check('2.6 every previously entered score preserved', preserved,
    Object.keys(snapBefore).length + ' vs ' + Object.keys(snapAfter).length);
  check('2.7 new rounds are empty',
    await page.evaluate(()=>document.getElementById('a-6-0').value === ''));
  check('2.8 calculate button disabled again (new rounds unfilled)',
    await page.evaluate(()=>document.getElementById('calculateResultsBtn').disabled));

  // extend persists through reload
  await page.evaluate(()=>saveData());
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate(()=>continueDraftFromHome());
  await page.waitForTimeout(200);
  const rReload = await page.evaluate(()=>rounds.length);
  check('2.9 extended schedule survives reload', rReload === 9, rReload);
  const snapReload = await page.evaluate(()=>{
    const m = {};
    document.querySelectorAll('#matches input[id^="a-"], #matches input[id^="b-"]').forEach(el=>{
      if(el.value !== '') m[el.id]=el.value;
    });
    return m;
  });
  let preserved2 = true;
  for(const [id,v] of Object.entries(snapBefore)){
    if(snapReload[id] !== v) preserved2 = false;
  }
  check('2.10 scores survive reload after extending', preserved2);

  check('2.11 button hidden at max circles',
    await page.evaluate(()=>!canExtendTournament()));

  // ============================================ 3. FINISH + BUG B
  await enterAllScores(page);
  await page.evaluate(()=>calculateResults());
  check('3.1 results rendered',
    await page.evaluate(()=>document.getElementById('results').innerHTML.includes('Итоги')));
  check('3.2 finish-without-playoff action available',
    await page.evaluate(()=>document.getElementById('results').innerHTML.includes('finishWithoutPlayoff')));

  await page.evaluate(()=>startFreshTournament());
  const unlocked = await page.evaluate(()=>
    ['pairCount','roundCount','roundLimit','roundLimitCustom','courtCount']
      .map(id=>({id, disabled: document.getElementById(id).disabled}))
      .filter(x=>x.disabled).map(x=>x.id)
  );
  check('3.3 BUG B: all settings re-enabled after finishing', unlocked.length === 0, unlocked);

  await setupPairsTournament(page, {pairs:4, circles:1, courts:1, limit:'21'});
  check('3.4 BUG B: start button enables on the second tournament',
    await page.evaluate(()=>!document.getElementById('startTournamentBtn').disabled));
  await page.evaluate(()=>startTournament());
  check('3.5 second tournament schedule built',
    await page.evaluate(()=>rounds.length) === 3);

  // ============================================ 3b. HIS EXACT PATH:
  // finish via "Завершить турнир" -> create a new tournament with the same settings
  await page.goto(URL);
  await page.evaluate(()=>localStorage.clear());
  await page.goto(URL);
  await setupPairsTournament(page, {pairs:4, circles:2, courts:2});
  await page.evaluate(()=>startTournament());
  await enterAllScores(page);
  await page.evaluate(()=>calculateResults());
  await page.evaluate(()=>finishWithoutPlayoff());
  await page.waitForTimeout(600);
  const hist = await page.evaluate(()=>{
    const h = JSON.parse(localStorage.getItem('padelFlowTournamentHistory') || '[]');
    return { len: h.length, statuses: h.map(x=>x.status), finished: h.map(x=>isHistoryFinished(x)) };
  });
  check('3b.1 tournament landed in history as finished',
    hist.len === 1 && hist.finished[0] === true, hist);
  const lockedAfterFinish = await page.evaluate(()=>
    ['pairCount','roundCount','roundLimit','roundLimitCustom','courtCount']
      .filter(id=>document.getElementById(id).disabled)
  );
  check('3b.2 BUG B: settings usable right after finishing', lockedAfterFinish.length === 0, lockedAfterFinish);

  await setupPairsTournament(page, {pairs:4, circles:2, courts:2});
  check('3b.3 BUG B: same settings accepted again',
    await page.evaluate(()=>({
      pairs: getPairCount(), circles: getRoundCount(), courts: getCourtCount(), limit: getRoundLimit()
    })).then(v=>v.pairs===4 && v.circles===2 && v.courts===2 && v.limit===21));
  check('3b.4 BUG B: start button clickable on the follow-up tournament',
    await page.evaluate(()=>!document.getElementById('startTournamentBtn').disabled));
  await page.evaluate(()=>startTournament());
  check('3b.5 follow-up tournament runs',
    await page.evaluate(()=>rounds.length) === 6);

  // ============================================ 4. INDIVIDUAL FORMAT
  await page.goto(URL);
  await page.evaluate(()=>localStorage.clear());
  await page.goto(URL);
  await page.evaluate(()=>{ if(typeof hideHomeScreen==='function') hideHomeScreen(); switchTab('tournament'); });
  await page.selectOption('#tournamentFormat', 'individual');
  await page.selectOption('#playerCount', '8');
  await page.selectOption('#individualCircleCount', '1');
  await page.selectOption('#courtCount', '2');
  await page.selectOption('#roundLimit', '21');
  await page.fill('#tournamentDate', '2026-10-14');
  await fillPairs(page, 4);
  await page.evaluate(()=>updateStartTournamentState());
  check('4.1 individual start enabled',
    await page.evaluate(()=>!document.getElementById('startTournamentBtn').disabled));
  await page.evaluate(()=>startTournament());
  const ri0 = await page.evaluate(()=>rounds.length);
  check('4.2 individual 8p/2c/1circle = 7 rounds', ri0 === 7, ri0);

  await enterAllScores(page);
  const indSnap = await page.evaluate(()=>{
    const m = {};
    document.querySelectorAll('#matches input[id^="a-"], #matches input[id^="b-"]').forEach(el=>m[el.id]=el.value);
    return m;
  });
  await page.evaluate(()=>addTournamentCircle());
  const ri1 = await page.evaluate(()=>rounds.length);
  check('4.3 individual circle added (7 -> 14)', ri1 === 14, ri1);
  check('4.4 individual circle select bumped',
    await page.evaluate(()=>document.getElementById('individualCircleCount').value) === '2');
  const indAfter = await page.evaluate(()=>{
    const m = {};
    document.querySelectorAll('#matches input[id^="a-"], #matches input[id^="b-"]').forEach(el=>{
      if(el.value !== '') m[el.id]=el.value;
    });
    return m;
  });
  let indPreserved = true;
  for(const [id,v] of Object.entries(indSnap)) if(indAfter[id] !== v) indPreserved = false;
  check('4.5 individual scores preserved after extending', indPreserved);

  await page.evaluate(()=>startFreshTournament());
  const unlocked2 = await page.evaluate(()=>
    ['pairCount','roundCount','roundLimit','roundLimitCustom','courtCount']
      .filter(id=>document.getElementById(id).disabled)
  );
  check('4.6 settings re-enabled after individual tournament', unlocked2.length === 0, unlocked2);

  // ============================================ 5. PLAYOFF GUARD
  await page.goto(URL);
  await page.evaluate(()=>localStorage.clear());
  await page.goto(URL);
  await page.evaluate(()=>{ if(typeof hideHomeScreen==='function') hideHomeScreen(); switchTab('tournament'); });
  await setupPairsTournament(page, {pairs:4, circles:1, courts:2});
  await page.evaluate(()=>startTournament());
  await enterAllScores(page);
  await page.evaluate(()=>calculateResults());
  await page.evaluate(()=>{ if(typeof startPlayoff==='function') startPlayoff(); });
  check('5.1 extending blocked once playoff started',
    await page.evaluate(()=>!canExtendTournament()));

  // ============================================ 6. NO JS ERRORS
  check('6.1 no uncaught page errors', errors.length === 0, errors.slice(0,3));

  await browser.close();
  console.log(`\n${'='.repeat(50)}\nPASS: ${pass}   FAIL: ${fail}\n${'='.repeat(50)}`);
  if(fails.length){ console.log('\nFailures:'); fails.forEach(f=>console.log('  x ' + f)); }
  process.exit(fail ? 1 : 0);
})();
