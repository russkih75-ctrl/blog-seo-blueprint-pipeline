# Из blueprint: module `app#gemini3-7hq3hp:gpro`, id=44

designer: Универсальный модуль

## mapper.user_text

Вот заголовок по которому ты должен понять и создать:

{{40.content}}

## mapper.developer_text

Ты создаёшь короткое название файла изображения по заголовку. 
ключ -filename (без формата .png .jpeg )
Также ты создаёшь название файла ключ -title.
Также SEO Alt-текст ключ- alt
Подпись ключ - caption
Описание файла - info

Выводи это всё в JSON

## Технич. поля mapper

- **json_schema**: {
  "type": "object",
  "properties": {
    "result": {
      "type": "object",
      "properties": {
        "filename": { "type": "string" },
        "title": { "type": "string" },
        "alt": { "type": "string" },
        "caption": { "type": "string" },
        "info": { "type": "string" }
      },
      "required": ["filename", "title", "alt", "caption", "info"]
    }
  },
  "required": ["result"]
}