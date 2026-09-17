# -*- coding: utf-8 -*-
"""Собирает превью PadelFlow для публикации артефактом.
Отличия от боевого index.html:
  - нет Supabase (в песочнице артефакта запросы к supabase.co всё равно заблокированы),
  - нет service worker и манифеста,
  - логотип вшит как data URI (относительные пути не резолвятся),
  - сверху плашка, что это песочница.
Запуск: python3 build-preview.py
"""
import io, re, base64
from PIL import Image

SRC = 'index.html'
DST = 'padelflow-preview.html'
ICON = '/mnt/user-data/uploads/PadelFlow/icon-192.png'

src = io.open(SRC, encoding='utf-8').read()

# --- логотип в data URI, ужатый до 96px ---
im = Image.open(ICON).convert('RGB')
im.thumbnail((96, 96), Image.LANCZOS)
buf = io.BytesIO()
im.save(buf, format='WEBP', quality=82, method=6)
logo = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()
print('логотип: %d байт -> %d символов data URI' % (len(open(ICON,'rb').read()), len(logo)))

def must(old, new, tag):
    global src
    assert src.count(old) == 1, 'не найдено (%s): %r' % (tag, old[:70])
    src = src.replace(old, new, 1)

def drop(pattern, tag):
    '''Убирает по регулярке — терпит правки вёрстки между сборками.'''
    global src
    src, n = re.subn(pattern, '', src)
    if not n:
        print('  пропущено (%s): не найдено' % tag)

# --- срезаем каркас документа: артефакт оборачивает содержимое сам ---
src = re.sub(r'^<!DOCTYPE html>\s*<html lang="ru">\s*<head>\s*', '', src)
must('</head>\n<body>\n', '', 'head-body')
src = re.sub(r'\s*</body>\s*</html>\s*$', '\n', src)
must('<meta charset="UTF-8">\n', '', 'charset')
must('<meta name="viewport" content="width=device-width, initial-scale=1.0">\n', '', 'viewport')

# --- в песочнице артефакта запросы к supabase.co блокирует CSP: убираем совсем ---
drop(r'<script src="https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@2"></script>\n?', 'supabase-cdn')

# --- PWA-обвязка превью не нужна ---
drop(r'<link rel="manifest"[^>]*>\n?', 'manifest')
drop(r'<meta name="theme-color"[^>]*>\n?', 'theme-color')
drop(r'<link rel="apple-touch-icon"[^>]*>\n?', 'apple-icon')
drop(r'registerServiceWorker\(\);\n', 'sw-call')

# --- логотип ---
# Логотип-картинка есть не во всех версиях вёрстки — заменяем, если нашли.
if '<img src="icon-192.png"' in src:
    src = src.replace('<img src="icon-192.png"', '<img src="%s"' % logo)
    print('логотип вшит')
else:
    print('логотипа-картинки в вёрстке нет — пропускаю')

# --- плашка песочницы, в тех же цветах что и приложение ---
banner = '''<style>
.preview-note{background:#06214a;border:1px solid #14407f;border-radius:14px;padding:12px 14px;
  margin-bottom:18px;color:#c6d0dd;font-size:14px;line-height:1.5}
.preview-note b{color:#d0ff41}
</style>
<div class="preview-note">
  <b>Превью для проверки.</b> Результаты сохраняются только в этом окне и не попадают
  ни в облако, ни в историю боевого приложения. Реальные турниры — на padel-flow-two.vercel.app.
</div>
'''
# Плашку ставим первым элементом внутри основной колонки.
must('<main class="app-main">\n', '<main class="app-main">\n' + banner, 'banner')

io.open(DST, 'w', encoding='utf-8').write(src)
print('готово: %s, %d символов' % (DST, len(src)))
