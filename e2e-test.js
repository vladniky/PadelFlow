// Регрессионный прогон PadelFlow в headless Chromium.
// Сценарий: создать турнир -> ввести счета -> перезагрузить -> проверить восстановление
// -> посчитать группу -> плей-офф -> перезагрузка -> отмена плей-офф.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.png':'image/png' };

const server = http.createServer((req,res)=>{
  const url = req.url.split('?')[0];
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.writeHead(404); res.end('nf'); return;
  }
  res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'});
  res.end(fs.readFileSync(file));
});

const fails = [];
function check(name, cond, extra){
  if(cond) console.log('  OK   ' + name);
  else { console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); fails.push(name); }
}

(async ()=>{
  await new Promise(r=>server.listen(8099, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport:{width:390,height:844} });
  const page = await ctx.newPage();
  page.on('pageerror', e=>{ console.log('  PAGEERROR: ' + e.message); fails.push('pageerror: '+e.message); });
  page.on('dialog', d=>d.accept());

  await page.goto('http://localhost:8099/index.html');
  await page.waitForTimeout(800);

  console.log('\n== 1. Создание турнира ==');
  await page.click('#homeScreen button:has-text("Начать турнир")');
  await page.fill('#tournamentName','Тестовый турнир');
  await page.fill('#tournamentDate','2026-09-09');
  await page.selectOption('#pairCount','4');
  await page.selectOption('#roundCount','2');
  await page.selectOption('#roundLimit','32');
  await page.selectOption('#courtCount','2');
  await page.fill('#court1','2'); await page.fill('#court2','6');
  const names = [['Алена А','Шагинуров Олег'],['Сотников Александр','Курятников Константин'],
                 ['Владимиров Никита','Боев Сергей'],['Жаткин Александр','Гейер Станислав']];
  for(let i=0;i<4;i++){
    await page.fill(`#team${i+1}a`, names[i][0]);
    await page.fill(`#team${i+1}b`, names[i][1]);
  }
  await page.waitForTimeout(200);
  check('кнопка "Начать турнир" активна', !(await page.isDisabled('#startTournamentBtn')));
  await page.click('#startTournamentBtn');
  await page.waitForTimeout(300);
  const matchCount = await page.locator('#matches .match').count();
  check('создано 12 матчей (4 пары x 2 круга)', matchCount === 12, 'получено ' + matchCount);

  console.log('\n== 2. Ввод счетов + автосохранение ==');
  const scoreInputs = await page.evaluate(()=>Array.from(document.querySelectorAll('#matches input[id^="a-"]')).map(el=>el.id));
  let seed = 0;
  for(const aid of scoreInputs){
    const bid = aid.replace(/^a-/, 'b-');
    const a = 18 + (seed % 5);
    await page.fill('#' + aid, String(a));
    await page.fill('#' + bid, String(32 - a));
    seed++;
  }
  const lastA = scoreInputs[scoreInputs.length-1];
  await page.waitForTimeout(600);
  const draftRaw = await page.evaluate(()=>localStorage.getItem('padelFlowCurrentDraft'));
  check('черновик записан в localStorage', !!draftRaw);
  const draft = JSON.parse(draftRaw);
  check('счета попали в черновик', draft.snapshot.scores['a-0-0'] === '18', JSON.stringify(draft.snapshot.scores['a-0-0']));
  check('все 12 матчей в черновике', Object.keys(draft.snapshot.scores).filter(k=>k.startsWith('a-')).length === 12);
  const hist = await page.evaluate(()=>JSON.parse(localStorage.getItem('padelFlowTournamentHistory')||'[]'));
  check('турнир автосохранён в историю как in_progress',
        hist.length === 1 && hist[0].status === 'in_progress', JSON.stringify(hist.map(h=>h.status)));

  console.log('\n== 3. Перезагрузка страницы (recovery) ==');
  await page.reload();
  await page.waitForTimeout(800);
  check('на главной есть кнопка "Продолжить турнир"',
        await page.isVisible('#continueDraftHomeBtn'));
  await page.click('#continueDraftHomeBtn');
  await page.waitForTimeout(600);
  check('счёт a-0-0 восстановлен', (await page.inputValue('#a-0-0')) === '18');
  check('счёт последнего матча восстановлен', (await page.inputValue('#' + lastA)).length > 0);
  check('название восстановлено', (await page.inputValue('#tournamentName')) === 'Тестовый турнир');
  check('дата восстановлена', (await page.inputValue('#tournamentDate')) === '2026-09-09');
  check('корт 1 восстановлен', (await page.inputValue('#court1')) === '2');
  check('таблица группы посчитана автоматически',
        (await page.locator('#results .tourney-table tbody tr').count()) === 4);

  console.log('\n== 4. Плей-офф до 21 ==');
  await page.click('button:has-text("Играть плей-офф")');
  await page.waitForTimeout(400);
  await page.selectOption('#playoffLimit','21');
  await page.waitForTimeout(200);
  await page.fill('#playoff-a-sf1','13');   // autoFill должен поставить 8
  await page.fill('#playoff-a-sf2','9');    // autoFill должен поставить 12
  await page.waitForTimeout(500);
  check('autoFill плей-офф сработал (13 -> 8)', (await page.inputValue('#playoff-b-sf1')) === '8',
        'получено ' + (await page.inputValue('#playoff-b-sf1')));
  check('финал отрисован', await page.isVisible('#playoff-a-final'));
  await page.fill('#playoff-a-final','14');
  await page.fill('#playoff-a-3rd','11');
  await page.waitForTimeout(600);
  check('таблица итогов плей-офф отрисована',
        (await page.locator('#tournament-table .tourney-table tbody tr').count()) === 4);

  console.log('\n== 5. Перезагрузка внутри плей-офф ==');
  await page.reload();
  await page.waitForTimeout(800);
  await page.click('#continueDraftHomeBtn');
  await page.waitForTimeout(1200);
  check('счёт полуфинала восстановлен', (await page.inputValue('#playoff-a-sf1')) === '13',
        'получено ' + (await page.inputValue('#playoff-a-sf1')));
  check('счёт финала восстановлен', (await page.inputValue('#playoff-a-final')) === '14',
        'получено ' + (await page.inputValue('#playoff-a-final')));
  check('итоговая таблица плей-офф восстановлена',
        (await page.locator('#tournament-table .tourney-table tbody tr').count()) === 4);
  const restoredLimit = await page.evaluate(()=>document.getElementById('playoffLimit')?.value);
  check('ЛИМИТ плей-офф восстановлен (21)', restoredLimit === '21', 'получено ' + restoredLimit);
  const maxAttr = await page.getAttribute('#playoff-a-final','max');
  check('max поля финала = 21', maxAttr === '21', 'получено ' + maxAttr);

  console.log('\n== 6. Отмена плей-офф ==');
  await page.click('button:has-text("Отменить плей-офф")');
  await page.waitForTimeout(600);
  check('группа сохранена после отмены',
        (await page.locator('#results .tourney-table tbody tr').count()) === 4);
  check('счёт группы не пострадал', (await page.inputValue('#a-0-0')) === '18');
  const draft2 = await page.evaluate(()=>JSON.parse(localStorage.getItem('padelFlowCurrentDraft')));
  check('playoffStarted сброшен в черновике', draft2.snapshot.playoffStarted === false);
  const poLeft = Object.entries(draft2.snapshot.scores).filter(([k,v])=>k.startsWith('playoff-') && v !== '');
  check('данные плей-офф очищены в черновике', poLeft.length === 0, JSON.stringify(poLeft));

  console.log('\n== 7. Service worker ==');
  const swState = await page.evaluate(async ()=>{
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? (reg.active ? 'active' : 'registered') : 'none';
  });
  check('service worker зарегистрирован', swState !== 'none', swState);

  console.log('\n== 8. Рейтинг удалён ==');
  const tabCount = await page.locator('#tabsBar .tab-button').count();
  check('во вкладках осталось 2 кнопки (Турнир, История)', tabCount === 2, 'получено ' + tabCount);
  check('нет вкладки Рейтинг', (await page.locator('[data-tab="rating"]').count()) === 0);
  check('нет контейнера рейтинга', (await page.locator('#ratingContainer').count()) === 0);
  const ratingFns = await page.evaluate(()=>['renderRating','getRatingStats','sortRatingList','buildRatingText','getPlayerBadge']
      .filter(n=>typeof window[n] === 'function'));
  check('функции рейтинга удалены', ratingFns.length === 0, JSON.stringify(ratingFns));
  await page.click('#goHomeBar button:has-text("На главную")');
  await page.waitForTimeout(300);
  check('на главной нет кнопки Рейтинг',
        (await page.locator('#homeScreen button:has-text("Рейтинг")').count()) === 0);
  await page.click('#continueDraftHomeBtn');
  await page.waitForTimeout(800);

  console.log('\n== 9. Сохранение турнира и История ==');
  await page.click('button:has-text("Сохранить турнир")');
  await page.waitForTimeout(1500);
  await page.click('.tab-button[data-tab="history"]');
  await page.waitForTimeout(800);
  check('турнир появился в Истории',
        (await page.locator('#historyContainer .history-card').count()) >= 1);
  await page.click('#historyContainer .history-card');
  await page.waitForTimeout(500);
  const detailText = await page.locator('#historyContainer .history-detail').innerText();
  check('в карточке истории есть название', detailText.includes('Тестовый турнир'));
  check('в карточке истории есть итоги группы', detailText.includes('Итоги группового этапа'));
  check('кнопки бэкапа истории на месте',
        (await page.locator('button:has-text("Скачать бэкап")').count()) === 1 &&
        (await page.locator('button:has-text("Восстановить из файла")').count()) === 1);

  console.log('\n== 10. Мобильная вёрстка 390px ==');
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('нет горизонтального скролла', overflow <= 0, 'overflow ' + overflow + 'px');

  await browser.close();
  server.close();
  console.log('\n===== ' + (fails.length ? 'ПРОВАЛЕНО: ' + fails.length : 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ') + ' =====');
  if(fails.length) { fails.forEach(f=>console.log(' - ' + f)); process.exit(1); }
})().catch(e=>{ console.error(e); server.close(); process.exit(1); });
