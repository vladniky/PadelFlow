import re
from pathlib import Path
text = Path('index.html').read_text('utf-8')
script = re.search(r'<script>([\s\S]*?)</script>', text)
print('script found' if script else 'script missing')
if not script:
    raise SystemExit(1)
code = script.group(1)
for name in ['buildGroupStageText','buildDayText','buildCompactShareText','buildHistoryGroupStatsHtml','buildHistoryDetailHtml','getPlayoffFinalists']:
    print(name, 'OK' if name in code else 'MISSING')
print('buildDayText contains playoff emoji heading', '🏆' in code and 'buildDayText' in code)
print('buildDayText pair 6 check', 'pairCount === 6' in code)
print('buildDayText max final places check', 'Итоги плей-офф' in code)
print('remaining grouped emoji', any(x in code for x in ['📊 Итоги группового этапа', '🏆 Плей-офф', '🥇','🥈','🥉','4️⃣','5️⃣','6️⃣']))
