# GNOME-Tahoe

Скрипт для установки и удаления конфигурации GNOME Shell в стиле macOS Tahoe.

## Структура

```
GNOME-Tahoe/
├── install.sh          - скрипт установки
├── uninstall.sh        - скрипт удаления
├── extensions/         - расширения GNOME Shell
├── config/
│   └── gnome.dconf     - конфигурация dconf
└── assets/
    ├── icons/          - значки
    └── wallpapers/     - обои
```

## Установка

```bash
chmod +x install.sh
./install.sh
```

## Удаление

```bash
chmod +x uninstall.sh
./uninstall.sh
```

## Описание

- install.sh создаёт бекап текущих расширений, устанавливает новые, применяет конфиг dconf и устанавливает значки
- uninstall.sh восстанавливает расширения и конфигурацию из бекапа
