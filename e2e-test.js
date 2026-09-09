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
  check('поля пар скрыты, пока формат не выбран', !(await page.isVisible('#pairCountField')));
  await page.selectOption('#tournamentFormat','pairs');
  await page.waitForTimeout(200);
  check('после выбора парного формата появился выбор пар', await page.isVisible('#pairCountField'));
  check('поля игроков скрыты в парном формате', !(await page.isVisible('#playerCountField')));
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
  check('кнопок бэкапа больше нет',
        (await page.locator('button:has-text("Скачать бэкап")').count()) === 0 &&
        (await page.locator('button:has-text("Восстановить из файла")').count()) === 0);
  check('нет упоминания плей-офф там, где его не было',
        !detailText.includes('Плей-офф') && !detailText.includes('плей-офф'), detailText.slice(0,400));

  console.log('\n== 10. Индивидуальный турнир: 8 игроков, 5 раундов ==');
  await page.click('.tab-button[data-tab="tournament"]');
  await page.waitForTimeout(300);
  await page.click('#goHomeBar button:has-text("На главную")');
  await page.waitForTimeout(300);
  await page.click('#homeScreen button:has-text("Начать турнир")');
  await page.waitForTimeout(400);
  await page.fill('#tournamentName','Американо соло');
  await page.fill('#tournamentDate','2026-09-10');
  await page.selectOption('#tournamentFormat','individual');
  await page.waitForTimeout(300);
  check('появился выбор количества игроков', await page.isVisible('#playerCountField'));
  check('выбор пар скрыт', !(await page.isVisible('#pairCountField')));
  check('появился выбор раундов', await page.isVisible('#individualRoundCountField'));
  check('выбор кругов скрыт', !(await page.isVisible('#roundCountField')));
  await page.selectOption('#playerCount','8');
  await page.waitForTimeout(300);
  const courtOpts = await page.evaluate(()=>Array.from(document.getElementById('courtCount').options)
      .filter(o=>o.value).map(o=>({v:o.value, off:o.disabled || o.hidden})));
  check('при 8 игроках 3 корта недоступны',
        courtOpts.find(o=>o.v==='3')?.off === true, JSON.stringify(courtOpts));
  check('1 и 2 корта доступны',
        courtOpts.find(o=>o.v==='1')?.off === false && courtOpts.find(o=>o.v==='2')?.off === false);
  await page.selectOption('#individualRoundCount','5');
  await page.selectOption('#roundLimit','24');
  await page.selectOption('#courtCount','2');
  await page.fill('#court1','2'); await page.fill('#court2','6');
  await page.waitForTimeout(300);
  check('подпись поля стала "Игрок 1"', (await page.getAttribute('#team1a','placeholder')) === 'Игрок 1');
  check('подпись поля стала "Игрок 8"', (await page.getAttribute('#team4b','placeholder')) === 'Игрок 8');
  check('блок 5-й пары скрыт (8 игроков = 4 блока)', !(await page.isVisible('#team5')));

  const solo = ['Никита','Олег','Александр','Константин','Сергей','Станислав','Михаил','Алена'];
  for(let i=0;i<8;i++){
    const block = Math.floor(i/2)+1, side = i%2===0 ? 'a' : 'b';
    await page.fill(`#team${block}${side}`, solo[i]);
  }
  await page.waitForTimeout(400);
  check('кнопка старта активна', !(await page.isDisabled('#startTournamentBtn')));

  // проверка запрета дублей
  await page.fill('#team1b','Никита');
  await page.waitForTimeout(300);
  check('дубль имени блокирует старт', await page.isDisabled('#startTournamentBtn'));
  check('и сообщает почему', (await page.locator('#startStatus').innerText()).includes('повторяться'));
  await page.fill('#team1b','Олег');
  await page.waitForTimeout(300);

  await page.click('#startTournamentBtn');
  await page.waitForTimeout(500);
  const soloMatches = await page.locator('#matches .match').count();
  check('создано 10 матчей (5 раундов x 2 корта)', soloMatches === 10, 'получено ' + soloMatches);
  const firstCard = await page.locator('#matches .match').first().innerText();
  check('в карточке двое против двоих', (firstCard.match(/ · /g) || []).length === 2, firstCard.replace(/\n/g,' | '));

  // каждый игрок ровно 5 матчей, партнёры не повторяются
  const rotation = await page.evaluate(()=>{
    const names = getTeams();
    const played = {}, partners = {};
    rounds.forEach(rd=>rd.forEach(m=>{
      [m[0],m[1]].forEach(side=>{
        side.forEach(i=>{ played[names[i]] = (played[names[i]]||0)+1; });
        const key = side.slice().sort((a,b)=>a-b).join('-');
        partners[key] = (partners[key]||0)+1;
      });
    }));
    return {played, dupPartners: Object.values(partners).filter(v=>v>1).length, names};
  });
  const counts = Object.values(rotation.played);
  check('каждый игрок играет ровно 5 матчей',
        counts.length === 8 && counts.every(c=>c===5), JSON.stringify(rotation.played));
  check('ни одной повторной пары партнёров', rotation.dupPartners === 0, 'повторов ' + rotation.dupPartners);

  const soloInputs = await page.evaluate(()=>Array.from(document.querySelectorAll('#matches input[id^="a-"]')).map(e=>e.id));
  let sSeed = 0;
  for(const aid of soloInputs){
    await page.fill('#' + aid, String(13 + (sSeed % 4)));
    sSeed++;
  }
  await page.waitForTimeout(700);
  check('autoFill в индивидуальном (13 -> 11 при лимите 24)', (await page.inputValue('#b-0-0')) === '11',
        'получено ' + (await page.inputValue('#b-0-0')));

  await page.click('#calculateResultsBtn');
  await page.waitForTimeout(600);
  const soloRows = await page.locator('#results .tourney-table tbody tr').count();
  check('в таблице 8 строк — по игроку', soloRows === 8, 'получено ' + soloRows);
  const resultsText = await page.locator('#results').innerText();
  check('заголовок "Итоги турнира"', resultsText.includes('Итоги турнира'));
  check('в итогах нет эмодзи', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u.test(resultsText),
        (resultsText.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu)||[]).join(''));
  check('колонка называется "Игрок"', resultsText.includes('Игрок'));
  check('нет кнопки плей-офф', (await page.locator('button:has-text("Играть плей-офф")').count()) === 0);
  check('есть кнопка "Завершить турнир"', (await page.locator('button:has-text("Завершить турнир")').count()) === 1);
  const sumScored = await page.evaluate(()=>{
    const d = computeGroupStats();
    return d.sorted.reduce((acc,x)=>acc+x[1].scored,0);
  });
  check('сумма очков всех игроков = 10 матчей x 24 x 2 игрока', sumScored === 10*24*2, 'получено ' + sumScored);

  console.log('\n== 11. Индивидуальный: перезагрузка и восстановление ==');
  const soloFirst = await page.inputValue('#a-0-0');
  await page.reload();
  await page.waitForTimeout(800);
  await page.click('#continueDraftHomeBtn');
  await page.waitForTimeout(1000);
  check('формат восстановлен как индивидуальный',
        (await page.evaluate(()=>document.getElementById('tournamentFormat').value)) === 'individual');
  check('количество игроков восстановлено',
        (await page.evaluate(()=>document.getElementById('playerCount').value)) === '8');
  check('количество раундов восстановлено',
        (await page.evaluate(()=>document.getElementById('individualRoundCount').value)) === '5');
  check('счёт первого матча восстановлен', (await page.inputValue('#a-0-0')) === soloFirst);
  check('матчей по-прежнему 10', (await page.locator('#matches .match').count()) === 10);
  check('таблица пересчиталась на 8 строк',
        (await page.locator('#results .tourney-table tbody tr').count()) === 8);
  const cardAfter = await page.locator('#matches .match').first().innerText();
  check('расписание совпало с исходным', cardAfter === firstCard, cardAfter.replace(/\n/g,' | '));

  console.log('\n== 12. Индивидуальный: сохранение в историю ==');
  await page.click('button:has-text("Завершить турнир")');
  await page.waitForTimeout(1800);
  await page.click('.tab-button[data-tab="history"]');
  await page.waitForTimeout(800);
  const cards = await page.locator('#historyContainer .history-card').count();
  check('в истории ровно два турнира, без дублей', cards === 2, 'получено ' + cards);
  const soloCount = await page.locator('#historyContainer .history-card', {hasText:'Американо соло'}).count();
  check('индивидуальный турнир записан один раз', soloCount === 1, 'получено ' + soloCount);
  const unfinished = await page.locator('#historyContainer .history-card-meta', {hasText:'Не завершен'}).count();
  check('нет зависших записей "Не завершен"', unfinished === 0, 'получено ' + unfinished);
  await page.locator('#historyContainer .history-card', {hasText:'Американо соло'}).first().click();
  await page.waitForTimeout(600);
  const soloDetail = await page.locator('#historyContainer .history-detail').innerText();
  check('карточка открылась с названием', soloDetail.includes('Американо соло'));
  check('в истории заголовок "Итоги турнира"', soloDetail.includes('Итоги турнира'));
  check('в истории игр видны временные пары', (soloDetail.match(/ · /g) || []).length > 4);
  check('в итогах перечислены игроки', soloDetail.includes('Никита') && soloDetail.includes('Алена'));

  console.log('\n== 13. Индивидуальный на одном корте: 8 игроков, 4 играют, 4 отдыхают ==');
  await page.click('.tab-button[data-tab="tournament"]');
  await page.waitForTimeout(300);
  await page.click('#goHomeBar button:has-text("На главную")');
  await page.waitForTimeout(300);
  await page.click('#homeScreen button:has-text("Начать турнир")');
  await page.waitForTimeout(400);
  await page.fill('#tournamentName','Соло один корт');
  await page.fill('#tournamentDate','2026-09-11');
  await page.selectOption('#tournamentFormat','individual');
  await page.selectOption('#playerCount','8');
  await page.selectOption('#individualRoundCount','6');
  await page.selectOption('#roundLimit','21');
  await page.selectOption('#courtCount','1');
  await page.fill('#court1','2');
  for(let i=0;i<8;i++){
    const block = Math.floor(i/2)+1, side = i%2===0 ? 'a' : 'b';
    await page.fill(`#team${block}${side}`, solo[i]);
  }
  await page.waitForTimeout(400);
  const checklist = await page.locator('#preStartChecklist').innerText();
  check('чеклист говорит сколько матчей у каждого', checklist.includes('каждый сыграет 3 матчей'), checklist.replace(/\n/g,' | '));
  check('чеклист говорит про отдых', checklist.includes('отдыхают по 4 за раунд'), checklist.replace(/\n/g,' | '));

  await page.click('#startTournamentBtn');
  await page.waitForTimeout(500);
  check('6 раундов по одному матчу = 6 матчей',
        (await page.locator('#matches .match').count()) === 6);
  const restLines = await page.locator('#matches .resting').count();
  check('в каждом раунде показано кто отдыхает', restLines === 6, 'получено ' + restLines);
  const firstRest = await page.locator('#matches .resting').first().innerText();
  check('отдыхают ровно четверо', firstRest.replace('Отдыхают: ','').split(',').length === 4, firstRest);

  const soloPlan = await page.evaluate(()=>{
    const names = getTeams();
    const played = {};
    rounds.forEach(rd=>rd.forEach(m=>[...m[0],...m[1]].forEach(i=>{played[names[i]]=(played[names[i]]||0)+1;})));
    return played;
  });
  const pc = Object.values(soloPlan);
  check('каждый из восьмерых сыграет по 3 матча',
        pc.length === 8 && pc.every(v=>v===3), JSON.stringify(soloPlan));

  console.log('\n== 14. Мобильная вёрстка 390px ==');
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('нет горизонтального скролла', overflow <= 0, 'overflow ' + overflow + 'px');

  await browser.close();
  server.close();
  console.log('\n===== ' + (fails.length ? 'ПРОВАЛЕНО: ' + fails.length : 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ') + ' =====');
  if(fails.length) { fails.forEach(f=>console.log(' - ' + f)); process.exit(1); }
})().catch(e=>{ console.error(e); server.close(); process.exit(1); });
