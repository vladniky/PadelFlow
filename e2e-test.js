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
  const externalRequests = [];
  page.on('request', r=>{ if(!r.url().startsWith('http://localhost:8099')) externalRequests.push(r.url()); });
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

  console.log('\n== 8. Навигация без дублей ==');
  check('верхних табов нет', (await page.locator('#tabsBar').count()) === 0);
  check('кнопки "На главную" на странице турнира нет', (await page.locator('#goHomeBar').count()) === 0);
  check('нижний остров виден на телефоне', await page.isVisible('.mobile-nav'));
  check('в острове ровно 3 кнопки', (await page.locator('.mobile-nav button').count()) === 3);
  check('сайдбар на телефоне скрыт', !(await page.isVisible('.app-sidebar')));
  check('чеклиста перед стартом нет', (await page.locator('#preStartChecklist').count()) === 0);
  check('нет вкладки Рейтинг', (await page.locator('[data-tab="rating"]').count()) === 0);
  const strayHome = await page.locator('button:has-text("На главную")').count();
  check('кнопка "На главную" нигде не дублируется', strayHome === 0, 'найдено ' + strayHome);

  console.log('\n== 8b. Критерий определения мест ==');
  const byDelta = await page.evaluate(()=>computeGroupStats().sorted.map(x=>x[0]));
  await page.selectOption('#rankingMode','wins');
  await page.waitForTimeout(600);
  const winsOrderOk = await page.evaluate(()=>{
    const st = computeGroupStats().sorted.map(x=>x[1]);
    return st.every((v,i)=> i===0 || st[i-1].wins >= v.wins);
  });
  check('порядок по победам корректен', winsOrderOk);
  check('подпись под таблицей говорит критерий',
        (await page.locator('.ranking-note').innerText()).includes('побед'));
  await page.selectOption('#rankingMode','delta');
  await page.waitForTimeout(600);
  const backToDelta = await page.evaluate(()=>computeGroupStats().sorted.map(x=>x[0]));
  check('возврат к разнице очков восстанавливает порядок',
        JSON.stringify(backToDelta) === JSON.stringify(byDelta));
  check('подпись вернулась к разнице',
        (await page.locator('.ranking-note').innerText()).includes('разнице'));

  console.log('\n== 8c. Шапка убрана, история только локальная ==');
  check('шапки с названием нет', (await page.locator('.app-header').count()) === 0);
  const pageText = await page.locator('.app-main').innerText();
  check('слогана "Турниры без лишней суеты" нет', !pageText.includes('лишней суеты'), pageText.slice(0,200));
  check('надписи "Данные сохраняются автоматически" нет', !pageText.includes('сохраняются автоматически'));
  check('статус хранения говорит про устройство',
        (await page.locator('#storageNote').innerText()).includes('устройстве'));
  const cloudRefs = await page.evaluate(()=>({
    client: typeof window.supabaseClient,
    save: typeof window.saveTournamentToCloud,
    push: typeof window.pushProgressToCloud,
    status: document.getElementById('cloudStatus') ? 'есть' : 'нет'
  }));
  check('облачного кода в приложении не осталось',
        cloudRefs.client === 'undefined' && cloudRefs.save === 'undefined' &&
        cloudRefs.push === 'undefined' && cloudRefs.status === 'нет', JSON.stringify(cloudRefs));
  check('ни одного запроса наружу за сессию', externalRequests.length === 0, JSON.stringify(externalRequests));

  console.log('\n== 8d. Нижний остров не перекрывает контент ==');
  await page.evaluate(()=>window.scrollTo({top: document.body.scrollHeight, behavior:'instant'}));
  await page.waitForTimeout(500);
  const clash = await page.evaluate(()=>{
    const nav = document.querySelector('.mobile-nav');
    if(!nav || getComputedStyle(nav).display === 'none') return {skip:true};
    const navTop = nav.getBoundingClientRect().top;
    let worst = null;
    document.querySelectorAll('.app-main button, .app-main input, .app-main select').forEach(el=>{
      if(el.closest('.mobile-nav')) return;   // сам остров, очевидно, поверх
      const r = el.getBoundingClientRect();
      if(r.height === 0) return;
      const over = r.bottom - navTop;
      if(over > 0 && (!worst || over > worst.over)){
        worst = {over: Math.round(over), what: (el.textContent||el.id||el.tagName).trim().slice(0,30)};
      }
    });
    return {skip:false, worst};
  });
  check('в самом низу страницы ничего не уходит под остров',
        clash.skip || !clash.worst, JSON.stringify(clash));

  console.log('\n== 8e. Размер текста на кнопках ==');
  const fonts = await page.evaluate(()=>{
    const px = sel => { const el = document.querySelector(sel); return el ? parseFloat(getComputedStyle(el).fontSize) : 0; };
    return {nav: px('.mobile-nav button'), start: px('#startTournamentBtn'), any: px('.button-row button')};
  });
  check('кнопки нижнего острова не меньше 13px', fonts.nav >= 13, JSON.stringify(fonts));
  check('обычные кнопки не меньше 15px', fonts.any >= 15, JSON.stringify(fonts));

  console.log('\n== 8f. Поле счёта без мигающей каретки ==');
  const caret = await page.evaluate(()=>getComputedStyle(document.querySelector('.score input')).caretColor);
  check('каретка спрятана', /transparent|rgba\(0, 0, 0, 0\)/.test(caret), caret);

  await page.click('.mobile-nav button:has-text("Главная")');
  await page.waitForTimeout(300);
  check('на главной нет кнопки История (она в навигации)',
        (await page.locator('#homeScreen button:has-text("История")').count()) === 0);
  check('на главной заголовок — просто название',
        (await page.locator('#homeScreen h1').innerText()).trim() === 'PadelFlow');
  const homeText = await page.locator('#homeScreen').innerText();
  check('слоганов на главной нет',
        !homeText.includes('Чёткий ритм') && !homeText.includes('Игра начинается здесь'), homeText.replace(/\n/g,' | '));
  check('про офлайн в описании не обещаем', !homeText.includes('интернет'));
  check('описания на главной нет', (await page.locator('#homeScreen p').count()) === 0);
  await page.click('#continueDraftHomeBtn');
  await page.waitForTimeout(800);

  console.log('\n== 8g. Лишнее убрано ==');
  const resultsKicker = await page.evaluate(()=>{
    const h = document.querySelector('#results > h2');
    return h ? getComputedStyle(h,'::before').content : 'нет заголовка';
  });
  check('надписи "Результаты" над итогами нет', !/Результаты/.test(resultsKicker), resultsKicker);
  check('кнопки "Изменить настройки" нет', (await page.locator('#editSettingsBtn').count()) === 0);
  check('базы имён нет: datalist удалён', (await page.locator('#playersList').count()) === 0);
  check('меню автодополнения нет', (await page.locator('#playerAutocompleteMenu').count()) === 0);
  const nameFns = await page.evaluate(()=>['getAllPlayers','loadPlayersList','savePlayersFromFields','setupPlayerAutocomplete']
      .filter(n=>typeof window[n] === 'function'));
  check('функции базы имён удалены', nameFns.length === 0, JSON.stringify(nameFns));
  check('ключ playersList не остаётся в хранилище',
        (await page.evaluate(()=>localStorage.getItem('playersList'))) === null);

  console.log('\n== 8h. Заголовок раунда показывает корт ==');
  const headingSpan = await page.locator('#matches .round-heading span').first().innerText();
  check('справа от "Раунд 1" — корт', headingSpan.includes('Корт'), headingSpan);
  check('старого "N игр · до X" нет', !headingSpan.includes('до '), headingSpan);
  const headSizes = await page.evaluate(()=>{
    const h = document.querySelector('.round-heading h2'), s = document.querySelector('.round-heading span');
    return {h: getComputedStyle(h).fontSize, s: getComputedStyle(s).fontSize};
  });
  check('шрифт корта как у "Раунд 1"', headSizes.h === headSizes.s, JSON.stringify(headSizes));

  console.log('\n== 9. Одна кнопка завершения и История ==');
  check('кнопки "Сохранить турнир" рядом с завершением нет',
        (await page.locator('#group-action-buttons button:has-text("Сохранить турнир")').count()) === 0);
  const finishBtns = await page.locator('#group-action-buttons button').allInnerTexts();
  check('в ряду только плей-офф и завершение', finishBtns.length === 2, JSON.stringify(finishBtns));
  await page.click('button:has-text("Завершить без плей-офф")');
  await page.waitForTimeout(1500);
  check('после завершения сразу открыта вкладка История',
        await page.isVisible('#tab-history'));
  check('вкладка турнира закрыта', !(await page.isVisible('#tab-tournament')));
  check('турнир появился в Истории',
        (await page.locator('#historyContainer .history-card').count()) >= 1);
  check('карточка сразу раскрыта, без лишнего тапа',
        (await page.locator('#historyContainer .history-detail').count()) === 1);
  check('раскрыт именно завершённый турнир',
        (await page.locator('#historyContainer .history-card-open').count()) === 1);
  check('страница прокручена к началу', (await page.evaluate(()=>window.scrollY)) < 30);
  const detailText = await page.locator('#historyContainer .history-detail').innerText();
  check('в карточке истории есть название', detailText.includes('Тестовый турнир'));
  check('в карточке истории есть итоги группы', detailText.includes('Итоги группового этапа'));
  check('кнопок бэкапа больше нет',
        (await page.locator('button:has-text("Скачать бэкап")').count()) === 0 &&
        (await page.locator('button:has-text("Восстановить из файла")').count()) === 0);
  check('нет упоминания плей-офф там, где его не было',
        !detailText.includes('Плей-офф') && !detailText.includes('плей-офф'), detailText.slice(0,400));

  console.log('\n== 10. Индивидуальный: 8 игроков, 2 корта, 1 круг ==');
  await page.click('.mobile-nav button:has-text("Турнир")');
  await page.waitForTimeout(300);
  await page.click('.mobile-nav button:has-text("Главная")');
  await page.waitForTimeout(300);
  await page.click('#homeScreen button:has-text("Начать турнир")');
  await page.waitForTimeout(400);
  await page.fill('#tournamentName','Американо соло');
  await page.fill('#tournamentDate','2026-09-10');
  await page.selectOption('#tournamentFormat','individual');
  await page.waitForTimeout(300);
  check('появился выбор количества игроков', await page.isVisible('#playerCountField'));
  check('выбор пар скрыт', !(await page.isVisible('#pairCountField')));
  check('появился выбор кругов', await page.isVisible('#individualCircleCountField'));
  check('парный выбор кругов скрыт', !(await page.isVisible('#roundCountField')));
  await page.selectOption('#playerCount','8');
  await page.waitForTimeout(300);
  const courtOpts = await page.evaluate(()=>Array.from(document.getElementById('courtCount').options)
      .filter(o=>o.value).map(o=>({v:o.value, off:o.disabled || o.hidden})));
  check('при 8 игроках 3 корта недоступны',
        courtOpts.find(o=>o.v==='3')?.off === true, JSON.stringify(courtOpts));
  check('1 и 2 корта доступны',
        courtOpts.find(o=>o.v==='1')?.off === false && courtOpts.find(o=>o.v==='2')?.off === false);
  const circleLabels = await page.evaluate(()=>Array.from(document.getElementById('individualCircleCount').options)
      .filter(o=>o.value).map(o=>o.textContent));
  check('в кругах видно число игр', circleLabels[0] === '1 круг · 7 игр', JSON.stringify(circleLabels));
  check('склонение работает', circleLabels[1] === '2 круга · 14 игр', JSON.stringify(circleLabels));
  await page.selectOption('#individualCircleCount','1');
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
  check('1 круг на 8 игроков / 2 корта = 7 раундов = 14 матчей', soloMatches === 14, 'получено ' + soloMatches);
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
  check('каждый сыграл ровно 7 матчей — круг закрыт',
        counts.length === 8 && counts.every(c=>c===7), JSON.stringify(rotation.played));
  check('каждый сыграл в паре с каждым ровно раз', rotation.dupPartners === 0, 'повторов ' + rotation.dupPartners);

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
  check('сумма очков всех игроков = 14 матчей x 24 x 2 игрока', sumScored === 14*24*2, 'получено ' + sumScored);

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
  check('количество кругов восстановлено',
        (await page.evaluate(()=>document.getElementById('individualCircleCount').value)) === '1');
  check('счёт первого матча восстановлен', (await page.inputValue('#a-0-0')) === soloFirst);
  check('матчей по-прежнему 14', (await page.locator('#matches .match').count()) === 14);
  check('таблица пересчиталась на 8 строк',
        (await page.locator('#results .tourney-table tbody tr').count()) === 8);
  const cardAfter = await page.locator('#matches .match').first().innerText();
  check('расписание совпало с исходным', cardAfter === firstCard, cardAfter.replace(/\n/g,' | '));

  console.log('\n== 12. Индивидуальный: сохранение в историю ==');
  await page.click('button:has-text("Завершить турнир")');
  await page.waitForTimeout(1800);
  check('индивидуальный турнир тоже уводит в Историю', await page.isVisible('#tab-history'));
  check('и его карточка раскрыта',
        (await page.locator('#historyContainer .history-card-open').count()) === 1);
  const cards = await page.locator('#historyContainer .history-card').count();
  check('в истории ровно два турнира, без дублей', cards === 2, 'получено ' + cards);
  const soloCount = await page.locator('#historyContainer .history-card', {hasText:'Американо соло'}).count();
  check('индивидуальный турнир записан один раз', soloCount === 1, 'получено ' + soloCount);
  const unfinished = await page.locator('#historyContainer .history-card-meta', {hasText:'Не завершен'}).count();
  check('нет зависших записей "Не завершен"', unfinished === 0, 'получено ' + unfinished);
  // не только вид, но и сам статус в хранилище: отложенный автосейв не должен его переписать
  const statuses = await page.evaluate(()=>JSON.parse(localStorage.getItem('padelFlowTournamentHistory')||'[]')
      .map(t=>({name:t.name, status:t.status})));
  check('статус в хранилище — completed у обоих',
        statuses.length === 2 && statuses.every(t=>t.status === 'completed'), JSON.stringify(statuses));
  const firstCardText = await page.locator('#historyContainer .history-card').first().innerText();
  check('сверху последний турнир (10.09)', firstCardText.includes('Американо соло'), firstCardText.replace(/\n/g,' | '));
  // карточка уже раскрыта после завершения — второй клик её бы свернул
  const soloDetail = await page.locator('#historyContainer .history-detail').innerText();
  check('карточка открылась с названием', soloDetail.includes('Американо соло'));
  check('в истории заголовок "Итоги турнира"', soloDetail.includes('Итоги турнира'));
  check('в истории игр видны временные пары', (soloDetail.match(/ · /g) || []).length > 4);
  check('в итогах перечислены игроки', soloDetail.includes('Никита') && soloDetail.includes('Алена'));

  console.log('\n== 13. Индивидуальный на одном корте: 8 игроков, 4 играют, 4 отдыхают ==');
  await page.click('.mobile-nav button:has-text("Турнир")');
  await page.waitForTimeout(300);
  await page.click('.mobile-nav button:has-text("Главная")');
  await page.waitForTimeout(300);
  await page.click('#homeScreen button:has-text("Начать турнир")');
  await page.waitForTimeout(400);
  await page.fill('#tournamentName','Соло один корт');
  await page.fill('#tournamentDate','2026-09-11');
  await page.selectOption('#tournamentFormat','individual');
  await page.selectOption('#playerCount','8');
  await page.selectOption('#individualCircleCount','1');
  await page.selectOption('#roundLimit','21');
  await page.selectOption('#courtCount','1');
  await page.fill('#court1','2');
  for(let i=0;i<8;i++){
    const block = Math.floor(i/2)+1, side = i%2===0 ? 'a' : 'b';
    await page.fill(`#team${block}${side}`, solo[i]);
  }
  await page.waitForTimeout(400);

  await page.click('#startTournamentBtn');
  await page.waitForTimeout(500);
  check('14 раундов по одному матчу = 14 матчей',
        (await page.locator('#matches .match').count()) === 14);
  const restLines = await page.locator('#matches .resting').count();
  check('в каждом раунде показано кто отдыхает', restLines === 14, 'получено ' + restLines);
  check('при одном матче корт не дублируется в карточке',
        (await page.locator('#matches .match .court').count()) === 0);
  const firstRest = await page.locator('#matches .resting').first().innerText();
  check('отдыхают ровно четверо', firstRest.replace('Отдыхают: ','').split(',').length === 4, firstRest);

  const soloPlan = await page.evaluate(()=>{
    const names = getTeams();
    const played = {};
    rounds.forEach(rd=>rd.forEach(m=>[...m[0],...m[1]].forEach(i=>{played[names[i]]=(played[names[i]]||0)+1;})));
    return played;
  });
  const pc = Object.values(soloPlan);
  check('на одном корте круг тот же: по 7 матчей каждому',
        pc.length === 8 && pc.every(v=>v===7), JSON.stringify(soloPlan));

  console.log('\n== 13b. Четыре игрока: круг = 3 игры ==');
  await page.click('.mobile-nav button:has-text("Главная")');
  await page.waitForTimeout(300);
  await page.click('#homeScreen button:has-text("Начать турнир")');
  await page.waitForTimeout(400);
  await page.selectOption('#tournamentFormat','individual');
  await page.selectOption('#playerCount','4');
  await page.waitForTimeout(300);
  const fourLabels = await page.evaluate(()=>Array.from(document.getElementById('individualCircleCount').options)
      .filter(o=>o.value).map(o=>o.textContent));
  check('1 круг = 3 игры', fourLabels[0] === '1 круг · 3 игры', JSON.stringify(fourLabels));
  check('2 круга = 6 игр', fourLabels[1] === '2 круга · 6 игр', JSON.stringify(fourLabels));
  check('3 круга = 9 игр', fourLabels[2] === '3 круга · 9 игр', JSON.stringify(fourLabels));
  const fourCourts = await page.evaluate(()=>Array.from(document.getElementById('courtCount').options)
      .filter(o=>o.value).map(o=>({v:o.value, off:o.disabled || o.hidden})));
  check('при 4 игроках доступен только 1 корт',
        fourCourts.filter(o=>!o.off).length === 1 && fourCourts.find(o=>o.v==='1').off === false,
        JSON.stringify(fourCourts));

  console.log('\n== 14. Мобильная вёрстка 390px ==');
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('нет горизонтального скролла', overflow <= 0, 'overflow ' + overflow + 'px');

  await browser.close();
  server.close();
  console.log('\n===== ' + (fails.length ? 'ПРОВАЛЕНО: ' + fails.length : 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ') + ' =====');
  if(fails.length) { fails.forEach(f=>console.log(' - ' + f)); process.exit(1); }
})().catch(e=>{ console.error(e); server.close(); process.exit(1); });
