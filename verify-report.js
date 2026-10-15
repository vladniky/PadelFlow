const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if(!scriptMatch) throw new Error('No script tag found');
// Тест проверяет только построение отчётов: запуск приложения (SW + initApp) в упрощённой
// модели страницы не нужен и падает на отсутствующих DOM-API — отрезаем его.
const BOOT_CALLS = /registerServiceWorker\(\);\s*initApp\(\);\s*$/;
if(!BOOT_CALLS.test(scriptMatch[1])) throw new Error('Boot calls not found at the end of the script — update verify-report.js');
const script = scriptMatch[1].replace(BOOT_CALLS, '');
const sandbox = {
  window: { addEventListener(){} },
  document: { _elems: {}, getElementById(id){ return this._elems[id] || null; }, createElement(){ return {}; } },
  localStorage: { data: {}, getItem(k){ return this.data[k] || null; }, setItem(k,v){ this.data[k]=String(v); }, removeItem(k){ delete this.data[k]; } },
  navigator: { share: undefined },
  alert: ()=>{},
  confirm: ()=>false,
  prompt: ()=>null,
  console,
  Date,
  Number,
  String,
  Array,
  Object,
  Math,
  JSON,
  Boolean,
};
vm.createContext(sandbox);
vm.runInContext(script, sandbox);
function setId(id, value){ sandbox.document._elems[id] = { value: String(value) }; }
function setup(pairCount){
  sandbox.document._elems = {};
  setId('pairCount', pairCount);
  setId('roundCount', 2);
  setId('courtCount', 2);
  setId('roundLimit', '32');
  setId('playoffLimit', '27');
  setId('tournamentName', 'Тест');
  setId('tournamentDate', '2026-06-01');
  for(let i=1;i<=pairCount;i++){
    setId(`team${i}a`, `A${i}`);
    setId(`team${i}b`, `B${i}`);
  }
  const rounds = sandbox.refreshRounds();
  for(let r=0;r<rounds.length;r++){
    for(let m=0;m<rounds[r].length;m++){
      setId(`a-${r}-${m}`, 10+r+m);
      setId(`b-${r}-${m}`, 5+r+m);
    }
  }
}
for(const n of [2,3,4,5,6]){
  setup(n);
  try{
    const text = sandbox.buildDayText();
    console.log('PAIR',n,'OK');
    console.log(text.split('\n').slice(0,12).join('\n'));
    console.log('---');
  }catch(e){
    console.log('PAIR',n,'ERROR',e.stack || e.message);
  }
}
