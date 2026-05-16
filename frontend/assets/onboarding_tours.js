(function () {
    'use strict';

    window.ACTRA_ONBOARDING_TOURS = [
        {
            tourId: 'main-dashboard-work-contour',
            version: 1,
            referenceCategory: 'Знакомимся с проектом',
            referenceTags: ["главная","быстрый доступ","комплексы","старт"],
            referenceOrder: 10,
            route: ['/main'],
            autoStart: true,
            autoStartDelay: 1500,
            totalStates: 3,
            title: 'Главная: основной рабочий контур',
            summary: 'Первое знакомство с блоками, через которые пользователь начинает обучение.',
            steps: [
                {
                    id: 'work-contour',
                    targets: [
                        '[data-onboarding-target="main-catalog-card"]',
                        '[data-onboarding-target="main-complexes-card"]',
                        '[data-onboarding-target="main-microcards-card"]',
                        '[data-global-nav="/catalog"]',
                        '[data-global-nav="/complexes"]'
                    ],
                    placement: 'bottom',
                    kicker: 'С чего начать',
                    callouts: [
                        {
                            target: '[data-onboarding-target="main-catalog-card"]',
                            placement: 'bottom',
                            keepPlacement: true,
                            offsetX: -80,
                            offsetY: 10,
                            title: 'Каталог учебных материалов',
                            body: 'Здесь можно смотреть открытые материалы других авторов, выбирать подходящие комплексы или теорию и добавлять их в свою библиотеку.'
                        },
                        {
                            target: '[data-onboarding-target="main-complexes-card"]',
                            placement: 'bottom',
                            offsetX: 60,
                            offsetY: 18,
                            title: 'Проходить комплексы',
                            body: 'Это основной рабочий раздел: здесь видно, какие комплексы уже есть в библиотеке, что можно запустить, продолжить или повторить.'
                        },
                        {
                            target: '[data-onboarding-target="main-microcards-card"]',
                            placement: 'right',
                            offsetX: 24,
                            offsetY: -10,
                            title: 'Микрокарточки',
                            body: 'Быстрый режим повторения через карточки и пары вроде "термин - определение". Раздел ещё дорабатывается.'
                        }
                    ]
                },
                {
                    id: 'author-tools',
                    targets: [
                        '[data-onboarding-target="main-author-task-editor-card"]',
                        '[data-onboarding-target="main-author-complex-editor-card"]',
                        '[data-onboarding-target="main-author-theory-center-card"]',
                        '[data-global-nav="/theory-center"]',
                        '[data-global-nav="/editor"]'
                    ],
                    placement: 'bottom',
                    kicker: 'Инструменты авторов',
                    callouts: [
                        {
                            target: '[data-onboarding-target="main-author-task-editor-card"]',
                            placement: 'bottom',
                            rowGroup: 'main-author-tools',
                            rowInset: 12,
                            width: 260,
                            offsetX: 0,
                            offsetY: 20,
                            title: 'Редактор заданий',
                            body: 'В редакторе заданий создаются учебные задачи: тесты, клики, открытые ответы и другие форматы для будущих комплексов.'
                        },
                        {
                            target: '[data-onboarding-target="main-author-complex-editor-card"]',
                            placement: 'bottom',
                            rowGroup: 'main-author-tools',
                            rowInset: 12,
                            width: 225,
                            offsetX: 0,
                            offsetY: 20,
                            title: 'Редактор комплексов',
                            body: 'Редактор комплексов собирает задания в полноценный сценарий обучения: порядок, повторы, связанная теория и публикация.'
                        },
                        {
                            target: '[data-onboarding-target="main-author-theory-center-card"]',
                            placement: 'bottom',
                            rowGroup: 'main-author-tools',
                            rowInset: 12,
                            width: 270,
                            offsetX: 18,
                            offsetY: 20,
                            title: 'Центр теории',
                            body: 'Центр теории помогает хранить материалы, связывать их с темами и прикреплять к комплексам как учебный контекст.'
                        }
                    ]
                },
                {
                    id: 'activity-widgets',
                    targets: [
                        '[data-onboarding-target="main-quick-access-card"]',
                        '[data-onboarding-target="main-calendar-card"]',
                        '[data-onboarding-target="main-stats-card"]'
                    ],
                    placement: 'bottom',
                    kicker: 'После первых действий',
                    callouts: [
                        {
                            target: '[data-onboarding-target="main-stats-card"]',
                            placement: 'left',
                            offsetX: 36,
                            offsetY: -136,
                            body: 'Календарь и статистика оживают после учебной активности: здесь появятся план на день, повторы, точность, динамика и слабые места.'
                        },
                        {
                            target: '[data-onboarding-target="main-quick-access-card"]',
                            placement: 'left',
                            keepPlacement: true,
                            width: 320,
                            offsetX: 36,
                            offsetY: -18,
                            body: 'Быстрый доступ собирает комплексы, к которым пользователь возвращается чаще всего: закреплённые, недавние и активные.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'complexes-library-navigation',
            version: 1,
            referenceCategory: 'Проходим и повторяем',
            referenceTags: ["комплексы","поиск","фильтры","библиотека"],
            referenceOrder: 20,
            route: ['/complexes'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 3,
            title: 'Комплексы: поиск и фильтрация',
            summary: 'Первое знакомство с библиотекой комплексов: поиск, фильтры, сортировка и текущая сводка.',
            steps: [
                {
                    id: 'search-and-filters',
                    targets: [
                        '[data-onboarding-target="complexes-library-navigation"]'
                    ],
                    placement: 'bottom',
                    kicker: 'Навигация по комплексам',
                    callouts: [
                        {
                            target: '[data-onboarding-target="complexes-search"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: -18,
                            gap: 22,
                            title: 'Поиск по библиотеке',
                            body: 'Поиск помогает быстро найти комплекс по названию, описанию или конкретному заданию внутри него.'
                        },
                        {
                            target: '.cx-controls-section--combined',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 18,
                            title: 'Фильтры и сортировка',
                            body: 'Оставьте нужные комплексы: авторские, из каталога, на паузе или для повтора. Рядом сортировка и сводка результата.'
                        }
                    ]
                },
                {
                    id: 'complex-card-actions',
                    targets: [
                        '[data-onboarding-target="complexes-card"]'
                    ],
                    placement: 'bottom',
                    scrollTarget: '[data-onboarding-target="complexes-card"]',
                    scrollBlock: 'center',
                    scrollBehavior: 'smooth',
                    scrollWaitMs: 420,
                    scrollOffsetY: 20,
                    forceAutoScroll: true,
                    kicker: 'Карточка комплекса',
                    calloutGap: 70,
                    callouts: [
                        {
                            target: '[data-onboarding-target="complexes-card"]',
                            placement: 'top',
                            offsetX: -240,
                            offsetY: 0,
                            gap: 24,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            title: 'Учебный сценарий',
                            body: 'Карточка показывает, что это за комплекс: описание, количество заданий, статус обучения, пауза и связь с теорией.'
                        },
                        {
                            target: '[data-onboarding-target="complexes-start-action"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 22,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            title: 'Запуск или продолжение',
                            body: 'Главная кнопка запускает новый прогон. Если комплекс уже на паузе, она возвращает пользователя в сохранённую сессию.'
                        },
                        {
                            target: '[data-onboarding-target="complexes-card-secondary-actions"]',
                            placement: 'bottom-end',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 22,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            title: 'Рабочие действия',
                            body: 'Здесь комплекс можно закрепить в быстром доступе, экспортировать, открыть для редактирования или удалить из библиотеки.'
                        }
                    ]
                },
                {
                    id: 'complex-library-actions',
                    targets: [
                        '[data-onboarding-target="complexes-toolbar-actions"]'
                    ],
                    placement: 'bottom',
                    kicker: 'Пополнение библиотеки',
                    callouts: [
                        {
                            target: '[data-onboarding-target="complexes-create"]',
                            placement: 'bottom',
                            offsetX: 48,
                            offsetY: 18,
                            title: 'Создать комплекс',
                            body: 'Создание открывает редактор комплексов, где задания собираются в учебный маршрут с теорией, порядком прохождения и публикацией.'
                        },
                        {
                            target: '[data-onboarding-target="complexes-add-by-code"]',
                            placement: 'bottom',
                            offsetX: -320,
                            offsetY: 56,
                            title: 'Импорт и код доступа',
                            body: 'Импорт переносит комплекс из файла. Код доступа добавляет закрытую публикацию из каталога прямо в библиотеку.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'complex-editor-authoring',
            version: 1,
            referenceCategory: 'Объединяем задания в комплексы',
            referenceTags: ["редактор комплексов","комплекс","теория","публикация"],
            referenceOrder: 70,
            route: ['/complexes/create'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 5,
            persistControl: true,
            title: 'Редактор комплексов: сценарий обучения',
            summary: 'Как собрать комплекс из заданий, добавить теорию, настроить порядок прохождения, связать задания в сцепки, проверить готовность и сохранить результат.',
            steps: [
                {
                    id: 'complex-editor-core-info',
                    targets: [
                        '[data-onboarding-target="complex-editor-header"]',
                        '[data-onboarding-target="complex-editor-info"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    skipAutoScroll: true,
                    kicker: 'Основа комплекса',
                    callouts: [
                        {
                            target: '[data-onboarding-target="complex-editor-info"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 24,
                            keepPlacement: true,
                            title: 'Название и описание',
                            body: 'Это карточка сценария: название помогает найти комплекс в библиотеке, а описание объясняет, чему он учит и когда его запускать.'
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-header"]',
                            placement: 'bottom',
                            offsetX: 520,
                            offsetY: 36,
                            gap: 22,
                            keepPlacement: true,
                            title: 'Панель редактора',
                            body: 'Верхняя панель показывает статус работы, готовность состава, публикацию и сохранение текущей версии комплекса.'
                        }
                    ]
                },
                {
                    id: 'complex-editor-theory-context',
                    targets: [
                        '[data-onboarding-target="complex-editor-theory"]',
                        '[data-onboarding-target="complex-editor-theory-source"]',
                        '[data-onboarding-target="complex-editor-theory-content"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    scrollTarget: '[data-onboarding-target="complex-editor-theory"]',
                    scrollBlock: 'center',
                    kicker: 'Теория как контекст',
                    callouts: [
                        {
                            target: '[data-onboarding-target="complex-editor-theory"]',
                            placement: 'right',
                            offsetX: 24,
                            offsetY: -76,
                            gap: 24,
                            title: 'Связанная теория',
                            body: 'Комплекс может наследовать теорию из тем, привязать существующий материал или создать отдельный текст. Это даёт ученику контекст для задач.'
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-theory-source"]',
                            placement: 'right',
                            offsetX: 24,
                            offsetY: 0,
                            gap: 24,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            title: 'Источник теории',
                            body: 'Здесь выбирается, откуда брать теорию: из тем комплекса, из существующего материала или из нового текста внутри редактора.'
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-theory-content"]',
                            placement: 'right',
                            offsetX: 24,
                            offsetY: 18,
                            gap: 24,
                            keepPlacement: true,
                            title: 'Содержимое теории',
                            body: 'В демо показан вариант с новой теорией: можно задать заголовок, оформить текст, добавить изображения и сохранить всё вместе с комплексом.'
                        }
                    ]
                },
                {
                    id: 'complex-editor-task-selection',
                    targets: [
                        '[data-onboarding-target="complex-editor-selected-tasks"]',
                        '[data-onboarding-target="complex-editor-task-library"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'top-left',
                    controlPlacementLocked: true,
                    scrollTarget: '[data-onboarding-target="complex-editor-selected-tasks"]',
                    scrollBlock: 'center',
                    forceAutoScroll: true,
                    kicker: 'Сборка задач',
                    callouts: [
                        {
                            target: '[data-onboarding-target="complex-editor-selected-tasks"]',
                            placement: 'top',
                            offsetX: -240,
                            offsetY: 10,
                            gap: 28,
                            keepPlacement: true,
                            title: 'Задания в комплексе',
                            body: 'Здесь собирается рабочий маршрут. Порядок и состав важны: комплекс должен вести ученика от проверки базовых вещей к закреплению.'
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-complexes-tab"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 44,
                            keepPlacement: true,
                            width: 560,
                            body: 'Во вкладке «Комплексы» можно выбрать уже созданный комплекс и открыть его для редактирования.'
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-task-library"]',
                            placement: 'left',
                            offsetX: 28,
                            offsetY: -250,
                            gap: 28,
                            keepPlacement: true,
                            title: 'Библиотека заданий',
                            body: 'Справа выбираются задания из рабочей библиотеки. Поиск помогает быстро найти нужный модуль, тему, ID или тег.'
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-add-selected"]',
                            placement: 'left',
                            offsetX: 30,
                            offsetY: 250,
                            gap: 28,
                            keepPlacement: true,
                            title: 'Добавить выбранные',
                            body: 'После выбора задания попадают в комплекс. Счётчик показывает, сколько элементов будет добавлено за один шаг.'
                        }
                    ],
                    beacons: [
                        {
                            target: '[data-onboarding-target="complex-editor-test-mode-control"]',
                            stepVariant: 'test-mode-control',
                            label: 'Показать подсказку про режим тестового задания',
                            placement: 'right',
                            gap: 10,
                            offsetX: 4,
                            offsetY: 0
                        }
                    ],
                    targetVariants: {
                        'test-mode-control': [
                            '[data-onboarding-target="complex-editor-test-mode-control"]'
                        ]
                    },
                    variantBackVariants: ['test-mode-control'],
                    variantBackLabel: 'К сборке',
                    calloutVariants: {
                        'test-mode-control': [
                            {
                                target: '[data-onboarding-target="complex-editor-test-mode-control"]',
                                placement: 'top',
                                offsetX: -120,
                                offsetY: -4,
                                gap: 28,
                                keepPlacement: true,
                                width: 430,
                                title: 'Вместе / Вразброс',
                                body: '«Вместе» означает, что все вопросы тестового задания будут идти рядом друг с другом. «Вразброс» замешивает вопросы теста между другими заданиями комплекса. Если тест входит в сцепку, вопросы принудительно идут вместе, чтобы связанный блок не распадался.'
                            }
                        ]
                    }
                },
                {
                    id: 'complex-editor-chains',
                    targets: [
                        '[data-onboarding-target="complex-editor-selected-tasks"]',
                        '[data-onboarding-target="complex-editor-chains"]'
                    ],
                    placement: 'top',
                    controlPlacement: 'top-left',
                    controlPlacementLocked: true,
                    scrollTarget: '[data-onboarding-target="complex-editor-chains"]',
                    scrollBlock: 'center',
                    kicker: 'Сцепки',
                    callouts: [
                        {
                            target: '[data-onboarding-target="complex-editor-selected-tasks"]',
                            placement: 'right',
                            offsetX: 18,
                            offsetY: -80,
                            gap: 26,
                            keepPlacement: true,
                            width: 420,
                            title: 'Связанные задания',
                            body: 'Сцепка влияет не только на разметку в редакторе: при запуске комплекса эти задания попадут в очередь как один блок, а не как разрозненные элементы.'
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-chains"]',
                            placement: 'right',
                            offsetX: 24,
                            offsetY: 0,
                            gap: 24,
                            keepPlacement: true,
                            width: 430,
                            title: 'Порядок внутри сцепки',
                            body: 'Генератор очереди сначала группирует сцепку в chunk, а уже потом балансирует очередь. Поэтому порядок внутри блока сохраняется при прохождении.'
                        }
                    ]
                },
                {
                    id: 'complex-editor-readiness-and-release',
                    targets: [
                        '[data-onboarding-target="complex-editor-quality"]',
                        '[data-onboarding-target="complex-editor-publish"]',
                        '[data-onboarding-target="complex-editor-save"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    skipAutoScroll: true,
                    kicker: 'Готовность и выпуск',
                    callouts: [
                        {
                            target: '[data-onboarding-target="complex-editor-quality"]',
                            placement: 'bottom',
                            offsetX: -220,
                            offsetY: 12,
                            gap: 22,
                            title: 'Готовность состава',
                            body: 'Индикатор проверяет, достаточно ли заданий, типов и структуры для нормального прохождения. Это быстрый контроль перед сохранением.'
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-publish"]',
                            placement: 'bottom',
                            offsetX: -80,
                            offsetY: 12,
                            gap: 22,
                            title: 'Публикация',
                            body: 'Публикация делает комплекс доступным через каталог или выбранный режим доступа. Черновик можно продолжать редактировать отдельно.'
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-save"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 12,
                            gap: 22,
                            title: 'Сохранение',
                            body: 'Сохранение фиксирует текущую версию редактора: название, теорию, выбранные задания, порядок и сцепки.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'calendar-daily-plan',
            version: 1,
            referenceCategory: 'Проходим и повторяем',
            referenceTags: ["календарь","план","повторение","память"],
            referenceOrder: 30,
            route: ['/calendar'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 3,
            persistControl: true,
            title: 'Календарь: план обучения',
            summary: 'Как читать дневной план, расписание, активность и здоровье памяти.',
            steps: [
                {
                    id: 'calendar-today-plan',
                    targets: [
                        '[data-onboarding-target="calendar-daily-mix-card"]',
                        '[data-onboarding-target="calendar-main-focus-card"]',
                        '[data-onboarding-target="calendar-time-controller"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: 'Что делать сегодня',
                    callouts: [
                        {
                            target: '[data-onboarding-target="calendar-daily-mix-card"]',
                            placement: 'bottom',
                            offsetX: -32,
                            offsetY: 18,
                            title: 'Daily Mix',
                            body: 'Короткая подборка повторов: ошибки, слабые места и материал, который пора освежить.'
                        },
                        {
                            target: '[data-onboarding-target="calendar-main-focus-card"]',
                            placement: 'bottom',
                            offsetX: 20,
                            offsetY: 18,
                            title: 'Фокус дня',
                            body: 'Главный комплекс на сегодня. Он помогает не выбирать вручную, что учить дальше.'
                        },
                        {
                            target: '[data-onboarding-target="calendar-time-controller"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 18,
                            title: 'Лимит времени',
                            body: 'План подстраивается под доступные минуты и не предлагает больше, чем реально пройти.'
                        }
                    ]
                },
                {
                    id: 'calendar-rhythm',
                    targets: [
                        '[data-onboarding-target="calendar-schedule-panel"]',
                        '[data-onboarding-target="calendar-activity-panel"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: 'Ритм недели',
                    callouts: [
                        {
                            target: '[data-onboarding-target="calendar-schedule-panel"]',
                            placement: 'top',
                            offsetX: 260,
                            offsetY: 22,
                            title: 'Ближайшие дни',
                            body: 'Лента показывает, где стоят повторы и сколько учебных действий запланировано на неделю.'
                        },
                        {
                            target: '[data-onboarding-target="calendar-activity-panel"]',
                            placement: 'right',
                            offsetX: 28,
                            offsetY: -6,
                            title: 'Активность',
                            body: 'Тепловая карта быстро показывает регулярность: где был темп, а где появились пропуски.'
                        }
                    ]
                },
                {
                    id: 'calendar-memory-health',
                    targets: [
                        '[data-onboarding-target="calendar-memory-notification"]',
                        '[data-onboarding-target="calendar-memory-health-panel"]'
                    ],
                    placement: 'top',
                    controlPlacement: 'bottom-left',
                    controlPlacementLocked: true,
                    kicker: 'Что проседает',
                    callouts: [
                        {
                            target: '[data-onboarding-target="calendar-memory-notification"]',
                            placement: 'top',
                            offsetX: -120,
                            offsetY: 18,
                            title: 'Сигнал к повтору',
                            body: 'Если комплекс проседает, календарь сразу показывает, что лучше освежить сегодня.'
                        },
                        {
                            target: '[data-onboarding-target="calendar-memory-health-panel"]',
                            placement: 'left',
                            offsetX: 24,
                            offsetY: 0,
                            gap: 28,
                            keepPlacement: true,
                            title: 'Здоровье памяти',
                            body: 'Здесь видно, какие комплексы держатся уверенно, а какие лучше повторить первыми.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'statistics-learning-signals',
            version: 1,
            referenceCategory: 'Смотрим статистику',
            referenceTags: ["статистика","метрики","ритм","прогресс"],
            referenceOrder: 40,
            route: ['/statistics'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 3,
            persistControl: true,
            title: 'Статистика: сигналы обучения',
            summary: 'Как читать общие метрики и отличать полезные учебные сигналы от справочных цифр.',
            steps: [
                {
                    id: 'statistics-overall-metrics',
                    targets: [
                        '[data-onboarding-target="statistics-overall-metrics"]',
                        '[data-onboarding-target="statistics-metric-tasks"]',
                        '[data-onboarding-target="statistics-metric-time"]',
                        '[data-onboarding-target="statistics-metric-microcards"]',
                        '[data-onboarding-target="statistics-metric-streak"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: 'Общие метрики',
                    callouts: [
                        {
                            target: '[data-onboarding-target="statistics-metrics-progress-anchor"]',
                            placement: 'bottom',
                            offsetX: -80,
                            offsetY: 18,
                            title: 'Сколько уже сделано',
                            body: 'Здесь видно, сколько задач освоено и сколько времени ушло на обучение. Это общий прогресс, но он сам по себе не говорит, что учить дальше.'
                        },
                        {
                            target: '[data-onboarding-target="statistics-metrics-repeat-anchor"]',
                            placement: 'bottom',
                            offsetX: 80,
                            offsetY: 18,
                            title: 'Как держится ритм',
                            body: 'Карточки показывают точность коротких повторов, а серия - занимались ли вы регулярно. Эти метрики помогают понять, где стоит освежить материал.'
                        }
                    ]
                },
                {
                    id: 'statistics-time-dynamics',
                    targets: [
                        '[data-onboarding-target="statistics-time-dynamics-card"]',
                        '[data-onboarding-target="statistics-chart-canvas"]',
                        '[data-onboarding-target="statistics-chart-controls"]'
                    ],
                    placement: 'top',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: 'Динамика времени',
                    callouts: [
                        {
                            target: '[data-onboarding-target="statistics-time-dynamics-card"]',
                            placement: 'right',
                            offsetX: 0,
                            offsetY: 80,
                            gap: 28,
                            title: 'Ритм по дням',
                            body: 'График показывает, в какие дни было обучение. Смотрите на регулярность, а не только на самый высокий столбик.'
                        },
                        {
                            target: '[data-onboarding-target="statistics-chart-controls"]',
                            placement: 'top',
                            offsetX: 70,
                            offsetY: 18,
                            title: 'Переключатели графика',
                            body: 'Здесь можно выбрать, что смотреть: время или активность, а потом сравнить период за 7, 30 или 90 дней.'
                        }
                    ]
                },
                {
                    id: 'statistics-performance-and-complexes',
                    targets: [
                        '[data-onboarding-target="statistics-performance-card"]',
                        '[data-onboarding-target="statistics-recent-complex-card"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: 'Детальная статистика',
                    callouts: [
                        {
                            target: '[data-onboarding-target="statistics-performance-card"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -72,
                            gap: 28,
                            title: 'Производительность',
                            body: 'Здесь видно, какие типы задач даются легче или сложнее. Низкий процент подсказывает, что этот формат стоит потренировать.'
                        },
                        {
                            target: '[data-onboarding-target="statistics-recent-complex-card"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 34,
                            gap: 28,
                            title: 'Последние комплексы',
                            body: 'Здесь видны недавние прохождения комплексов. Так проще понять, что закрепилось, а к чему стоит вернуться.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'catalog-discovery-library',
            version: 3,
            referenceCategory: 'Находим материалы',
            referenceTags: ["каталог","поиск","материалы","библиотека"],
            referenceOrder: 50,
            route: ['/catalog'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 2,
            persistControl: true,
            title: 'Каталог: поиск и отбор материалов',
            summary: 'Как найти публикацию, отсортировать выдачу, оценить детали и добавить подходящий материал в свою библиотеку.',
            steps: [
                {
                    id: 'catalog-search-and-filters',
                    targets: [
                        '[data-onboarding-target="catalog-search-block"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="catalog-detail-panel"] .catalog-detail__breakdown',
                    kicker: 'Поиск, фильтры и порядок',
                    callouts: [
                        {
                            target: '[data-onboarding-target="catalog-search"]',
                            placement: 'top',
                            keepPlacement: true,
                            offsetX: 0,
                            offsetY: 0,
                            gap: 22,
                            title: 'Поиск по каталогу',
                            body: 'Введите название, тему или автора. Поиск сужает выдачу без смены раздела: удобно быстро проверить, есть ли готовый материал под текущую задачу.'
                        },
                        {
                            target: '[data-onboarding-target="catalog-filters"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 12,
                            gap: 26,
                            title: 'Тип материала',
                            body: 'Фильтры разделяют все публикации, комплексы, теории и уже сохранённые материалы. Это первый грубый отсев перед сортировкой и просмотром карточек.'
                        },
                        {
                            target: '[data-onboarding-target="catalog-sort-toggle"]',
                            placement: 'bottom-end',
                            offsetX: 0,
                            offsetY: 12,
                            arrowOffsetX: 70,
                            gap: 26,
                            title: 'Сортировка',
                            body: 'Сортировка меняет порядок карточек: сначала новые, по алфавиту, по типу контента или по объёму. Рядом сводка показывает, сколько публикаций осталось после поиска и фильтров.'
                        }
                    ]
                },
                {
                    id: 'catalog-card-and-detail',
                    targets: [
                        '[data-onboarding-target="catalog-selected-card"]',
                        '[data-onboarding-target="catalog-detail-panel"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="catalog-detail-panel"] .catalog-detail__breakdown',
                    scrollOffsetY: 150,
                    kicker: 'Выбор',
                    callouts: [
                        {
                            target: '[data-onboarding-target="catalog-selected-card"]',
                            placement: 'right',
                            offsetX: 0,
                            offsetY: -24,
                            gap: 28,
                            centerBetweenTarget: '[data-onboarding-target="catalog-detail-panel"]',
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="catalog-detail-panel"]',
                                    placement: 'right',
                                    sameAxis: true,
                                    offsetY: 0
                                }
                            ],
                            title: 'Карточка и детали',
                            body: 'Карточка даёт быстрый обзор, а панель деталей показывает состав, связанные материалы и помогает решить, стоит ли сохранять публикацию.'
                        },
                        {
                            target: '[data-onboarding-target="catalog-add-action"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 12,
                            gap: 24,
                            title: 'Добавить в библиотеку',
                            body: 'Каталог не запускает обучение напрямую. Сначала сохраните материал: комплекс появится в комплексах, а теория - в центре теории.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'theory-center-library',
            version: 1,
            referenceCategory: 'Работаем с теорией',
            referenceTags: ["теория","центр теории","связи","материалы"],
            referenceOrder: 60,
            route: ['/theory-center', '/editor/Theory_Center.html'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 2,
            persistControl: true,
            title: 'Центр теории: библиотека и связи',
            summary: 'Как найти теорию, проверить привязки к темам и комплексам и быстро открыть нужный материал.',
            steps: [
                {
                    id: 'theory-center-find-and-filter',
                    targets: [
                        '[data-onboarding-target="theory-summary-block"]',
                        '[data-onboarding-target="theory-controls-block"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="theory-selected-row"] [data-onboarding-target="theory-open-action"]',
                    scrollOffsetY: 0,
                    kicker: 'Поиск и срезы',
                    callouts: [
                        {
                            target: '[data-onboarding-target="theory-summary-grid"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 18,
                            title: 'Быстрые подборки',
                            body: 'Верхний блок собирает проблемные и полезные срезы: темы без теории, комплексы с одной теорией, подборки и материалы без привязки.'
                        },
                        {
                            target: '[data-onboarding-target="theory-search"]',
                            placement: 'bottom',
                            offsetX: 12,
                            offsetY: 12,
                            gap: 24,
                            title: 'Поиск по центру',
                            body: 'Поиск работает по названиям тем, комплексов и теорий. Это самый быстрый способ проверить, есть ли уже нужный материал.'
                        },
                        {
                            target: '[data-onboarding-target="theory-scope-filters"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 12,
                            gap: 24,
                            title: 'Разделы и фильтры',
                            body: 'Переключатели меняют тип выдачи: все теории, темы, комплексы, материалы без привязки и теории только с заголовком.'
                        }
                    ]
                },
                {
                    id: 'theory-center-card-and-actions',
                    targets: [
                        '[data-onboarding-target="theory-selected-row"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="theory-selected-row"] [data-onboarding-target="theory-open-action"]',
                    scrollOffsetY: 210,
                    kicker: 'Карточка теории',
                    callouts: [
                        {
                            target: '[data-onboarding-target="theory-selected-row"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 8,
                            gap: 28,
                            title: 'Связи и статус',
                            body: 'Карточка показывает автора, публикацию в каталоге, связи с темами и комплексами, а также дату обновления.'
                        },
                        {
                            target: '[data-onboarding-target="theory-open-action"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 24,
                            title: 'Открыть материал',
                            body: 'Кнопка открывает теорию: свои материалы попадают в редактор, а теории других авторов из каталога открываются в режиме просмотра.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'theory-editor-authoring',
            version: 1,
            referenceCategory: 'Работаем с теорией',
            referenceTags: ["редактор теории","материал","изображения","публикация"],
            referenceOrder: 80,
            route: ['/theory-editor', '/editor/Theory_Editor.html'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 3,
            persistControl: true,
            title: 'Редактор теории: создание материала',
            summary: 'Как выбрать теорию, оформить текст, добавить изображения, сохранить и подготовить материал к публикации.',
            steps: [
                {
                    id: 'theory-editor-library-and-title',
                    targets: [
                        '[data-onboarding-target="theory-editor-header"]',
                        '[data-onboarding-target="theory-editor-library-panel"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="theory-editor-active-library-item"]',
                    skipAutoScroll: true,
                    scrollY: 0,
                    kicker: 'Выбор материала',
                    callouts: [
                        {
                            target: '[data-onboarding-target="theory-editor-library-panel"]',
                            placement: 'right',
                            offsetX: 0,
                            offsetY: -24,
                            gap: 26,
                            title: 'Библиотека теорий',
                            body: 'Слева список ваших теорий. Можно быстро найти материал по названию или ID и переключиться между сохранёнными теориями.'
                        },
                        {
                            target: '[data-onboarding-target="theory-editor-header"]',
                            placement: 'bottom',
                            offsetX: 360,
                            offsetY: 10,
                            gap: 22,
                            title: 'Статусы выбранной теории',
                            body: 'Верхняя панель относится к теории, выбранной в библиотеке: здесь видны публикация, лимит библиотеки, быстрые переходы, создание новой теории и сохранение.'
                        }
                    ]
                },
                {
                    id: 'theory-editor-body-and-text-tools',
                    targets: [
                        '[data-onboarding-target="theory-editor-toolbar"]',
                        '[data-onboarding-target="theory-editor-content"]'
                    ],
                    placement: 'top',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="theory-editor-toolbar"]',
                    scrollTarget: '[data-onboarding-target="theory-editor-content"]',
                    scrollBlock: 'nearest',
                    scrollOffsetY: 80,
                    kicker: 'Текст теории',
                    variantBackVariants: ['image-tools'],
                    callouts: [
                        {
                            target: '[data-onboarding-target="theory-editor-toolbar"]',
                            placement: 'left',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 24,
                            title: 'Инструменты текста',
                            body: 'Пока выбран текст, здесь доступны жирность, курсив, заголовки, списки, выравнивание, цвет и кнопка добавления изображения.'
                        },
                        {
                            target: '[data-onboarding-target="theory-editor-content"]',
                            placement: 'left',
                            offsetX: 0,
                            offsetY: -10,
                            gap: 28,
                            title: 'Текстовое поле',
                            body: 'В этой области пишется основной материал. В тексте можно смешивать заголовки, списки, пояснения и изображения теории.'
                        }
                    ],
                    calloutVariants: {
                        'image-tools': [
                            {
                                target: '[data-onboarding-target="theory-editor-selected-image"]',
                                placement: 'left',
                                offsetX: 0,
                                offsetY: -8,
                                arrowLengthExtra: 18,
                                gap: 28,
                                title: 'Выбранное изображение',
                                body: 'После клика изображение получает рамку выделения. Теперь изменения из панели инструментов применяются именно к нему.'
                            },
                            {
                                target: '[data-onboarding-target="theory-editor-image-controls"]',
                                placement: 'top',
                                offsetX: 0,
                                offsetY: 0,
                                gap: 24,
                                title: 'Инструменты изображения',
                                body: 'Здесь можно менять размер, выравнивание, обтекание, поворот и отражение изображения прямо внутри материала.'
                            }
                        ]
                    }
                },
                {
                    id: 'theory-editor-save-and-publish',
                    targets: [
                        '[data-onboarding-target="theory-editor-save-action"]',
                        '[data-onboarding-target="theory-editor-publish-action"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="theory-editor-save-action"]',
                    scrollY: 0,
                    kicker: 'Сохранение',
                    callouts: [
                        {
                            target: '[data-onboarding-target="theory-editor-save-action"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 14,
                            gap: 24,
                            title: 'Сохранить',
                            body: 'Сохранение обновляет личную версию теории. Если есть несохранённые изменения, кнопка заметно подсвечивается.'
                        },
                        {
                            target: '[data-onboarding-target="theory-editor-publish-action"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 14,
                            gap: 24,
                            title: 'Публикация',
                            body: 'После сохранения можно управлять публикацией: оставить теорию личной, открыть для всех или выдать доступ по коду.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'test-editor-authoring',
            version: 1,
            referenceCategory: 'Создаем задания',
            referenceTags: ["тест","вопросы","ответы","редактор заданий"],
            referenceOrder: 100,
            route: [
                '/editor/Test%20Task%20Editor%20Multiple%20Choice.html',
                '/editor/Test Task Editor Multiple Choice.html',
                '/editor/Test_Task_Editor_Multiple_Choice.html',
                '/Editor/Test%20Task%20Editor%20Multiple%20Choice.html',
                '/Editor/Test Task Editor Multiple Choice.html',
                '/Editor/Test_Task_Editor_Multiple_Choice.html'
            ],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 5,
            persistControl: true,
            title: 'Редактор теста: вопросы и ответы',
            summary: 'Как собрать тест: добавить вопросы, написать формулировку, отметить правильные ответы, настроить обратную связь и сохранить.',
            steps: [
                {
                    id: 'test-editor-question-structure',
                    targets: [
                        '[data-onboarding-target="test-editor-left-sidebar"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="test-editor-active-question"]',
                    skipAutoScroll: true,
                    kicker: 'Структура теста',
                    variantBackVariants: ['import-tools'],
                    variantBackLabel: 'Вернуться к 1/5',
                    callouts: [
                        {
                            target: '[data-onboarding-target="test-editor-active-question"]',
                            placement: 'right',
                            offsetX: 14,
                            offsetY: 0,
                            gap: 24,
                            variant: 'test-editor-compact',
                            title: 'Список вопросов',
                            body: 'Слева видны все вопросы теста. Активный вопрос открыт в рабочей области, а индикатор показывает готовность ответа.'
                        },
                        {
                            target: '[data-onboarding-target="test-editor-add-question"], [data-onboarding-target="test-editor-import-export"]',
                            targetAll: true,
                            placement: 'right',
                            offsetX: 14,
                            offsetY: 6,
                            gap: 24,
                            variant: 'test-editor-compact',
                            title: 'Добавление и импорт',
                            body: 'Новый вопрос добавляется вручную. Импорт открывает окно загрузки вопросов из файла или текста. Экспорт без отдельного окна сразу сохраняет текущее тестовое задание в файл.'
                        }
                    ],
                    calloutVariants: {
                        'import-tools': [
                            {
                                target: '[data-onboarding-target="test-editor-import-modal-title"], [data-onboarding-target="test-editor-import-source"]',
                                targetAll: true,
                                placement: 'right',
                                offsetX: 20,
                                offsetY: 4,
                                gap: 28,
                                variant: 'test-editor-import-branch',
                                title: 'Способ импорта',
                                body: 'Вверху выберите источник: файл с вопросами или текстовую заготовку. Активная вкладка подсвечивает, какой сценарий сейчас открыт.'
                            },
                            {
                                target: '[data-onboarding-target="test-editor-import-parse-panel"], [data-onboarding-target="test-editor-import-choose-file"]',
                                targetAll: true,
                                placement: 'right',
                                offsetX: 20,
                                offsetY: -6,
                                gap: 28,
                                variant: 'test-editor-import-branch',
                                title: 'Проверка данных',
                                body: 'Здесь показываются выбранный файл, количество найденных вопросов, статус разбора и предпросмотр. Кнопка «Выбрать файл» запускает загрузку.'
                            },
                            {
                                target: '[data-onboarding-target="test-editor-import-preview"], [data-onboarding-target="test-editor-import-mode"], [data-onboarding-target="test-editor-import-modal-actions"]',
                                targetAll: true,
                                placement: 'right',
                                offsetX: 20,
                                offsetY: 4,
                                gap: 28,
                                variant: 'test-editor-import-branch',
                                title: 'Применение к тесту',
                                body: 'После проверки выберите, добавить вопросы к текущим или заменить тест целиком, затем подтвердите импорт нижней кнопкой.'
                            }
                        ]
                    },
                    targetVariants: {
                        'import-tools': [
                            '[data-onboarding-target="test-editor-import-modal-panel"]'
                        ]
                    }
                },
                {
                    id: 'test-editor-question-body',
                    targets: [
                        '[data-onboarding-target="test-editor-question-card"]',
                        '[data-onboarding-target="test-editor-question-text"]',
                        '[data-onboarding-target="test-editor-question-image"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="test-editor-question-text"]',
                    scrollTarget: '[data-onboarding-target="test-editor-question-card"]',
                    scrollBlock: 'nearest',
                    kicker: 'Формулировка вопроса',
                    callouts: [
                        {
                            target: '[data-onboarding-target="test-editor-question-text"]',
                            positionTarget: '[data-onboarding-target="test-editor-question-card"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 24,
                            variant: 'test-editor-wide',
                            title: 'Текст вопроса',
                            body: 'Здесь пишется сама формулировка. Лучше делать её короткой и проверять один конкретный факт, правило или различие.'
                        },
                        {
                            target: '[data-onboarding-target="test-editor-question-image"]',
                            positionTarget: '[data-onboarding-target="test-editor-question-card"]',
                            placement: 'bottom-end',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 24,
                            variant: 'test-editor-compact',
                            title: 'Изображение к вопросу',
                            body: 'К вопросу можно прикрепить до трёх иллюстраций. Они относятся только к текущему вопросу.'
                        }
                    ]
                },
                {
                    id: 'test-editor-options',
                    targets: [
                        '[data-onboarding-target="test-editor-options-card"]',
                        '[data-onboarding-target="test-editor-first-option"]',
                        '[data-onboarding-target="test-editor-correct-toggle"]',
                        '[data-onboarding-target="test-editor-add-option"]',
                        '[data-onboarding-target="test-editor-image-bank"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="test-editor-first-option"]',
                    scrollTarget: '[data-onboarding-target="test-editor-options-card"]',
                    scrollBlock: 'nearest',
                    kicker: 'Варианты ответа',
                    callouts: [
                        {
                            target: '[data-onboarding-target="test-editor-first-option"]',
                            placement: 'top-start',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 76,
                            variant: 'test-editor-wide',
                            title: 'Варианты ответа',
                            body: 'Каждая строка — отдельный вариант ответа. Вариант может содержать текст, изображение или оба элемента сразу; кнопка справа добавляет изображение именно к этому варианту.'
                        },
                        {
                            target: '[data-onboarding-target="test-editor-correct-toggle"]',
                            placement: 'top-start',
                            offsetX: -120,
                            offsetY: 4,
                            gap: 84,
                            variant: 'test-editor-compact',
                            title: 'Правильный ответ',
                            body: 'Нажатие на букву варианта делает его правильным или снимает отметку. Если отметить несколько букв, вопрос автоматически становится вопросом с несколькими правильными ответами.'
                        },
                        {
                            target: '[data-onboarding-target="test-editor-add-option"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 8,
                            gap: 20,
                            variant: 'test-editor-compact',
                            title: 'Добавить вариант',
                            body: 'Эта кнопка добавляет ещё один вариант ответа к текущему вопросу.'
                        },
                        {
                            target: '[data-onboarding-target="test-editor-image-bank"]',
                            placement: 'top-end',
                            offsetX: 22,
                            offsetY: 0,
                            gap: 18,
                            variant: 'test-editor-compact',
                            title: 'Банк изображений',
                            body: 'Здесь собраны изображения задания. Уже загруженную картинку можно повторно использовать в других вопросах и вариантах.'
                        }
                    ]
                },
                {
                    id: 'test-editor-inspector',
                    targets: [
                        '[data-onboarding-target="test-editor-answer-type"]',
                        '[data-onboarding-target="test-editor-feedback"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="test-editor-answer-type"]',
                    scrollTarget: '[data-onboarding-target="test-editor-answer-type"]',
                    scrollBlock: 'center',
                    kicker: 'Инспектор вопроса',
                    callouts: [
                        {
                            target: '[data-onboarding-target="test-editor-answer-type"]',
                            placement: 'left',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 28,
                            variant: 'test-editor-compact',
                            title: 'Тип ответа',
                            body: 'Определяется автоматически: один правильный вариант — одиночный выбор, несколько — множественный.'
                        },
                        {
                            target: '[data-onboarding-target="test-editor-feedback"]',
                            placement: 'left',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 28,
                            variant: 'test-editor-compact',
                            title: 'Обратная связь',
                            body: 'Комментарий показывается после ответа и помогает объяснить, почему ответ верный.'
                        }
                    ],
                    calloutVariants: {
                        'inspector-side': [
                            {
                                target: '[data-onboarding-target="test-editor-answer-type"]',
                                placement: 'left',
                                offsetX: 8,
                                offsetY: 0,
                                gap: 30,
                                variant: 'test-editor-compact',
                                title: 'Тип ответа',
                                body: 'Один правильный вариант — одиночный выбор, несколько — множественный.'
                            },
                            {
                                target: '[data-onboarding-target="test-editor-feedback"]',
                                placement: 'left',
                                offsetX: 8,
                                offsetY: 0,
                                gap: 30,
                                variant: 'test-editor-compact',
                                title: 'Обратная связь',
                                body: 'Комментарий показывается после ответа и объясняет, почему ответ верный.'
                            }
                        ]
                    }
                },
                {
                    id: 'test-editor-save',
                    targets: [
                        '[data-onboarding-target="test-editor-header"]',
                        '[data-onboarding-target="test-editor-history-actions"]',
                        '[data-onboarding-target="test-editor-save-action"]',
                        '[data-onboarding-target="test-editor-save-status"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="test-editor-save-action"]',
                    scrollY: 0,
                    kicker: 'Сохранение',
                    callouts: [
                        {
                            target: '[data-onboarding-target="test-editor-history-actions"]',
                            placement: 'bottom',
                            offsetX: -210,
                            offsetY: 14,
                            gap: 24,
                            variant: 'test-editor-save-row',
                            hideArrow: true,
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="test-editor-history-actions"]',
                                    placement: 'line',
                                    targetAnchorX: 'left',
                                    targetAnchorY: 'bottom',
                                    startX: 260,
                                    startY: -6
                                }
                            ],
                            title: 'Отмена и повтор',
                            body: 'Кнопки работают с историей редактора: можно откатить добавленные элементы и вернуть отменённое действие.'
                        },
                        {
                            target: '[data-onboarding-target="test-editor-save-action"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 14,
                            gap: 24,
                            variant: 'test-editor-save-row',
                            title: 'Сохранить тест',
                            body: 'Перед сохранением редактор проверит, что есть текст вопроса, минимум два варианта и хотя бы один правильный ответ.'
                        },
                        {
                            target: '[data-onboarding-target="test-editor-save-status"]',
                            placement: 'bottom',
                            offsetX: 210,
                            offsetY: 14,
                            gap: 24,
                            variant: 'test-editor-save-row',
                            hideArrow: true,
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="test-editor-save-status"]',
                                    placement: 'line',
                                    targetAnchorX: 'right',
                                    targetAnchorY: 'bottom',
                                    startX: 32,
                                    startY: -6
                                }
                            ],
                            title: 'Статус изменений',
                            body: 'Индикатор показывает, сохранён ли тест или есть несохранённые правки.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'open-answer-authoring',
            version: 1,
            referenceCategory: 'Создаем задания',
            referenceTags: ["открытый ответ","эталон","ключевые слова","редактор заданий"],
            referenceOrder: 110,
            route: ['/editor/Open%20Answer%20Editor%20Textual%20Reasoning.html'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 5,
            persistControl: true,
            title: 'Редактор открытого ответа',
            summary: 'Как собрать задание со свободным ответом: вопрос, эталон, ключевые слова, подсказка, требования и изображения.',
            steps: [
                {
                    id: 'open-answer-header-save',
                    targets: [
                        '[data-onboarding-target="open-answer-header"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="open-answer-save-action"]',
                    scrollY: 0,
                    kicker: 'Шапка редактора',
                    callouts: [
                        {
                            target: '[data-onboarding-target="open-answer-title"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 24,
                            variant: 'open-answer-compact',
                            title: 'Название задания',
                            body: 'В шапке видно, какое задание открыто и в каком редакторе вы работаете.'
                        },
                        {
                            target: '[data-onboarding-target="open-answer-save-status"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 64,
                            gap: 34,
                            hideArrow: true,
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="open-answer-save-status"]',
                                    placement: 'line',
                                    startX: 286,
                                    startY: 24,
                                    targetAnchorX: 'left',
                                    targetAnchorY: 'bottom',
                                    offsetX: 8,
                                    offsetY: -4
                                }
                            ],
                            variant: 'open-answer-compact',
                            title: 'Статус изменений',
                            body: 'Индикатор показывает, сохранены ли текущие правки.'
                        },
                        {
                            target: '[data-onboarding-target="open-answer-save-action"]',
                            placement: 'bottom-end',
                            offsetX: 0,
                            offsetY: 14,
                            gap: 24,
                            variant: 'open-answer-compact',
                            title: 'Сохранить',
                            body: 'Перед сохранением редактор проверит вопрос, эталонный ответ и выбранные ключевые слова.'
                        }
                    ]
                },
                {
                    id: 'open-answer-question',
                    targets: [
                        '[data-onboarding-target="open-answer-question-block"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="open-answer-question-text"]',
                    scrollTarget: '[data-onboarding-target="open-answer-question-block"]',
                    scrollBlock: 'center',
                    kicker: 'Формулировка',
                    callouts: [
                        {
                            target: '[data-onboarding-target="open-answer-question-block"]',
                            placement: 'bottom-start',
                            offsetX: 18,
                            offsetY: 16,
                            gap: 22,
                            variant: 'open-answer-wide',
                            title: 'Вопрос',
                            body: 'Здесь формулируется задача для ответа своими словами. Делайте вопрос так, чтобы в эталоне можно было выделить один или несколько обязательных смысловых признаков: именно выбранные ключевые слова затем проверяются в ответе.'
                        }
                    ]
                },
                {
                    id: 'open-answer-reference',
                    targets: [
                        '[data-onboarding-target="open-answer-reference-block"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="open-answer-reference-text"]',
                    scrollTarget: '[data-onboarding-target="open-answer-reference-block"]',
                    scrollBlock: 'center',
                    kicker: 'Эталон',
                    callouts: [
                        {
                            target: '[data-onboarding-target="open-answer-reference-block"]',
                            placement: 'bottom-start',
                            offsetX: 18,
                            offsetY: 16,
                            gap: 22,
                            variant: 'open-answer-wide',
                            title: 'Эталонный ответ',
                            body: 'Это правильный смысловой ответ. По нему редактор подготавливает слова и фразы, которые затем можно отметить как обязательные.'
                        },
                        {
                            target: '[data-onboarding-target="open-answer-split-keywords"]',
                            placement: 'bottom-end',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 22,
                            variant: 'open-answer-compact',
                            title: 'Разбить на ключевые слова',
                            body: 'Кнопка извлекает кандидаты из эталонного ответа. После этого выберите, какие из них действительно важны для проверки.'
                        }
                    ]
                },
                {
                    id: 'open-answer-keywords-hint',
                    targets: [
                        '[data-onboarding-target="open-answer-keywords-hint-block"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="open-answer-keywords-container"]',
                    scrollTarget: '[data-onboarding-target="open-answer-keywords-hint-block"]',
                    scrollBlock: 'center',
                    kicker: 'Проверка ответа',
                    callouts: [
                        {
                            target: '[data-onboarding-target="open-answer-keywords-container"]',
                            placement: 'top-start',
                            offsetX: 0,
                            offsetY: 12,
                            gap: 26,
                            variant: 'open-answer-wide',
                            title: 'Ключевые слова',
                            body: 'Нажатие на слово включает или выключает его как обязательное. Счётчик показывает, сколько признаков ответа выбрано для проверки.'
                        },
                        {
                            target: '[data-onboarding-target="open-answer-hint-block"]',
                            placement: 'right',
                            offsetX: 18,
                            offsetY: -150,
                            gap: 30,
                            hideArrow: true,
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="open-answer-hint-block"]',
                                    placement: 'line',
                                    startX: 24,
                                    startY: 112,
                                    targetAnchorX: 'right',
                                    targetAnchorY: 'center',
                                    offsetX: -2,
                                    offsetY: 0
                                }
                            ],
                            variant: 'open-answer-compact',
                            title: 'Подсказка',
                            body: 'Подсказка необязательна. Она помогает пользователю вспомнить направление ответа, не раскрывая полностью эталон.'
                        }
                    ]
                },
                {
                    id: 'open-answer-sidebar',
                    targets: [
                        '[data-onboarding-target="open-answer-sidebar"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="open-answer-requirements"]',
                    skipAutoScroll: true,
                    scrollTarget: '[data-onboarding-target="open-answer-sidebar"]',
                    scrollBlock: 'center',
                    kicker: 'Дополнительные условия',
                    callouts: [
                        {
                            target: '[data-onboarding-target="open-answer-requirements"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -8,
                            gap: 30,
                            variant: 'open-answer-compact',
                            title: 'Требования к ответу',
                            body: 'Можно требовать порядок ключевых слов и ограничить максимальную длину ответа. Если лимит задан, в тренажёре появится ограничение ввода.'
                        },
                        {
                            target: '[data-onboarding-target="open-answer-images-panel"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 8,
                            gap: 30,
                            variant: 'open-answer-compact',
                            title: 'Изображения',
                            body: 'К открытому ответу можно прикрепить до трёх изображений. Они сохраняются вместе с заданием и помогают задать контекст.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'click-editor-authoring',
            version: 1,
            referenceCategory: 'Создаем задания',
            referenceTags: ["click","клик","области","изображение"],
            referenceOrder: 120,
            route: ['/editor/Point_Annotation.html', '/Editor/Point_Annotation.html'],
            autoStart: false,
            autoStartDelay: 900,
            totalStates: 6,
            persistControl: true,
            title: 'Редактор Click',
            summary: 'Как собрать задание, где пользователь кликом отмечает нужные области на изображении.',
            steps: [
                {
                    id: 'click-header-save',
                    targets: [
                        '[data-onboarding-target="click-header"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-save-action"]',
                    scrollY: 0,
                    kicker: 'Шапка редактора',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-title"]',
                            positionTarget: '[data-onboarding-target="click-header"]',
                            rowGroup: 'click-header-state-1',
                            placement: 'bottom',
                            rowInset: 24,
                            offsetX: 0,
                            offsetY: 14,
                            gap: 22,
                            hideArrow: true,
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="click-title"]',
                                    placement: 'diagonal',
                                    targetAnchorX: 'center',
                                    targetAnchorY: 'bottom',
                                    startY: 8
                                }
                            ],
                            variant: 'click-header-row',
                            title: 'Название задания',
                            body: 'В шапке видно, какое Click-задание открыто для редактирования.'
                        },
                        {
                            target: '[data-onboarding-target="click-mode-switch"]',
                            positionTarget: '[data-onboarding-target="click-header"]',
                            rowGroup: 'click-header-state-1',
                            placement: 'bottom',
                            rowInset: 24,
                            offsetX: 0,
                            offsetY: 14,
                            gap: 22,
                            variant: 'click-header-row',
                            title: 'Режим задания',
                            body: 'Режим Click используется для разметки областей на изображении. Режим ошибок открывает отдельный сценарий проверки текста.'
                        },
                        {
                            target: '[data-onboarding-target="click-save-action"]',
                            positionTarget: '[data-onboarding-target="click-header"]',
                            rowGroup: 'click-header-state-1',
                            placement: 'bottom',
                            rowInset: 24,
                            offsetX: 0,
                            offsetY: 14,
                            gap: 22,
                            variant: 'click-header-row',
                            title: 'Сохранить',
                            body: 'Перед сохранением редактор проверит изображение, формулировку и количество нужных контуров.'
                        }
                    ]
                },
                {
                    id: 'click-prompt-rules',
                    targets: [
                        '[data-onboarding-target="click-sidebar"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-prompt"]',
                    skipAutoScroll: true,
                    kicker: 'Условие задания',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-prompt"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 4,
                            gap: 30,
                            variant: 'click-wide',
                            title: 'Формулировка',
                            body: 'Здесь пишется инструкция для пользователя: что именно нужно найти и отметить на изображении.'
                        },
                        {
                            target: '[data-onboarding-target="click-required-correct"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 8,
                            gap: 30,
                            variant: 'click-compact',
                            title: 'Критерий успеха',
                            body: 'Поле задаёт, сколько правильных областей пользователь должен отметить, чтобы ответ был засчитан.'
                        }
                    ]
                },
                {
                    id: 'click-image-workspace',
                    targets: [
                        '#canvas-stage',
                        '[data-onboarding-target="click-change-image"]',
                        '[data-onboarding-target="click-zoom-controls"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-canvas"]',
                    skipAutoScroll: true,
                    kicker: 'Рабочая область',
                    callouts: [
                        {
                            target: '#canvas-stage',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 48,
                            gap: 28,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: 'Изображение',
                            body: 'На холсте размещается изображение, по которому пользователь будет выполнять клик-задание.'
                        },
                        {
                            target: '[data-onboarding-target="click-change-image"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 22,
                            keepPlacement: true,
                            variant: 'click-narrow',
                            title: 'Сменить / добавить изображение',
                            body: 'Этой кнопкой добавляют первую картинку задания или заменяют текущую.'
                        },
                        {
                            target: '[data-onboarding-target="click-zoom-controls"]',
                            placement: 'right',
                            offsetX: 0,
                            offsetY: -200,
                            gap: 22,
                            keepPlacement: true,
                            hideArrow: true,
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="click-zoom-controls"]',
                                    placement: 'diagonal',
                                    targetAnchorX: 'right',
                                    targetAnchorY: 'top',
                                    offsetX: -32,
                                    offsetY: -8,
                                    startX: -4,
                                    startY: 124
                                }
                            ],
                            variant: 'click-narrow',
                            title: 'Масштаб',
                            body: 'Плюс и минус помогают приблизить картинку, чтобы аккуратно поставить контур.'
                        }
                    ]
                },
                {
                    id: 'click-drawing-tools',
                    targets: [
                        '[data-onboarding-target="click-toolbar"]',
                        '[data-onboarding-target="click-drawing-status"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-tool-choice"]',
                    skipAutoScroll: true,
                    kicker: 'Инструменты разметки',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-tool-choice"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 22,
                            variant: 'click-compact',
                            title: 'Способ разметки',
                            body: 'Лассо строит контур по точкам, свободное рисование позволяет провести линию рукой.'
                        },
                        {
                            target: '[data-onboarding-target="click-polygon-actions"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 22,
                            variant: 'click-wide',
                            title: 'Работа с контуром',
                            body: 'Текущий контур завершают кнопкой или двойным кликом левой кнопкой мыши. Здесь же удаляют последнюю точку или отменяют незавершённую разметку.'
                        }
                    ]
                },
                {
                    id: 'click-annotations-manage',
                    targets: [
                        '#canvas-stage',
                        '[data-onboarding-target="click-annotations-panel"]',
                        '[data-onboarding-target="click-additional-materials"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-left',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-annotations-panel"]',
                    scrollTarget: '[data-onboarding-target="click-additional-materials"]',
                    scrollBlock: 'start',
                    scrollBehavior: 'smooth',
                    scrollWaitMs: 360,
                    forceAutoScroll: true,
                    kicker: 'Сопровождение задания',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-annotations-panel"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -180,
                            gap: 30,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: 'Список контуров',
                            body: 'После разметки здесь появляются все области. Контуры можно переименовывать прямо в списке; кнопка «Подсветить» временно выделяет область на изображении, а «Подпись» управляет отображением её названия.'
                        },
                        {
                            target: '[data-onboarding-target="click-selected-annotation"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: -10,
                            gap: 26,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: 'Редактирование точек',
                            body: 'При выборе контура на изображении появляются его точки, и каждую точку можно сдвинуть, чтобы аккуратно поправить границу.'
                        },
                        {
                            target: '[data-onboarding-target="click-additional-materials"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 8,
                            gap: 30,
                            variant: 'click-compact',
                            title: 'Дополнительные материалы',
                            body: 'Можно добавить текст или изображения, если для Click-задания нужен контекст.'
                        }
                    ]
                },
                {
                    id: 'click-difficulty-levels',
                    targets: [
                        '#editor-difficulty-authoring',
                        '#editor-difficulty-authoring .difficulty-authoring__mode-card',
                        '#editor-difficulty-authoring .difficulty-authoring__level-card'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-left',
                    controlPlacementLocked: true,
                    readySelector: '#editor-difficulty-authoring .difficulty-authoring__level-card',
                    scrollTarget: '#editor-difficulty-authoring',
                    scrollBlock: 'start',
                    scrollBehavior: 'smooth',
                    scrollWaitMs: 360,
                    scrollContainerOffsetY: -12,
                    forceAutoScroll: true,
                    kicker: 'Финальная настройка',
                    callouts: [
                        {
                            target: '#editor-difficulty-authoring',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -300,
                            gap: 30,
                            skipOverlapPush: true,
                            variant: 'click-compact',
                            title: 'Уровни сложности',
                            body: 'В обычном комплексе 3 итерации. Уровни помогают разложить одно задание по этой траектории: от простого шага в начале к более сложному в конце.'
                        },
                        {
                            target: '#editor-difficulty-authoring .difficulty-authoring__mode-card',
                            targetAll: true,
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 0,
                            gap: 30,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: 'Все или выборочно',
                            body: '«Все уровни типа» оставляет задание во всех итерациях Click. «Только выбранные» ограничивает, где оно появится: например, только в ранней тренировке или только в финальной проверке.'
                        },
                        {
                            target: '#editor-difficulty-authoring .difficulty-authoring__level-card',
                            targetAll: true,
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 105,
                            gap: 30,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: 'Что делает пользователь',
                            body: 'L1: нажать готовую область. L2: выбрать название найденной области. L3: обвести область и ввести название.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'draw-editor-authoring',
            version: 1,
            referenceCategory: 'Создаем задания',
            referenceTags: ["рисование","контур","области","изображение"],
            referenceOrder: 130,
            route: ['/editor/Point_Annotation.html', '/Editor/Point_Annotation.html'],
            autoStart: false,
            autoStartDelay: 900,
            totalStates: 6,
            persistControl: true,
            title: 'Редактор «Рисование»',
            summary: 'Как собрать задание, где пользователь сам обводит области на изображении.',
            steps: [
                {
                    id: 'draw-header-save',
                    targets: [
                        '[data-onboarding-target="click-header"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-save-action"]',
                    scrollY: 0,
                    kicker: 'Шапка редактора',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-title"]',
                            positionTarget: '[data-onboarding-target="click-header"]',
                            rowGroup: 'draw-header-state-1',
                            placement: 'bottom',
                            rowInset: 24,
                            offsetX: 0,
                            offsetY: 14,
                            gap: 22,
                            hideArrow: true,
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="click-title"]',
                                    placement: 'diagonal',
                                    targetAnchorX: 'center',
                                    targetAnchorY: 'bottom',
                                    startY: 8
                                }
                            ],
                            variant: 'click-header-row',
                            title: 'Название задания',
                            body: 'Здесь видно, какое задание «Рисование» открыто для редактирования.'
                        },
                        {
                            target: '[data-onboarding-target="click-save-action"]',
                            positionTarget: '[data-onboarding-target="click-header"]',
                            rowGroup: 'draw-header-state-1',
                            placement: 'bottom',
                            rowInset: 24,
                            offsetX: 0,
                            offsetY: 14,
                            gap: 22,
                            variant: 'click-header-row',
                            title: 'Сохранить',
                            body: 'Перед сохранением редактор проверит изображение, формулировку, контуры и подписи областей.'
                        }
                    ]
                },
                {
                    id: 'draw-prompt-rules',
                    targets: [
                        '[data-onboarding-target="click-sidebar"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-prompt"]',
                    skipAutoScroll: true,
                    kicker: 'Условие задания',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-prompt"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 4,
                            gap: 30,
                            variant: 'click-wide',
                            title: 'Формулировка',
                            body: 'Напишите, что пользователь должен обвести. Если подпись нужна только на отдельном уровне, укажите это отдельно, а не как обязательное действие для всех.'
                        },
                        {
                            target: '[data-onboarding-target="click-required-correct"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 8,
                            gap: 30,
                            variant: 'click-compact',
                            title: 'Критерий успеха',
                            body: 'Поле задаёт, сколько правильно размеченных областей нужно для зачёта.'
                        }
                    ]
                },
                {
                    id: 'draw-image-workspace',
                    targets: [
                        '#canvas-stage',
                        '[data-onboarding-target="click-change-image"]',
                        '[data-onboarding-target="click-zoom-controls"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-canvas"]',
                    skipAutoScroll: true,
                    kicker: 'Рабочая область',
                    callouts: [
                        {
                            target: '#canvas-stage',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 48,
                            gap: 28,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: 'Изображение',
                            body: 'На этом холсте пользователь будет обводить нужные области. Чем чище изображение, тем точнее получится разметка.'
                        },
                        {
                            target: '[data-onboarding-target="click-change-image"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 22,
                            keepPlacement: true,
                            variant: 'click-narrow',
                            title: 'Сменить изображение',
                            body: 'Этой кнопкой добавляют основу задания или заменяют текущую картинку.'
                        },
                        {
                            target: '[data-onboarding-target="click-zoom-controls"]',
                            placement: 'right',
                            offsetX: 0,
                            offsetY: -200,
                            gap: 22,
                            keepPlacement: true,
                            hideArrow: true,
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="click-zoom-controls"]',
                                    placement: 'diagonal',
                                    targetAnchorX: 'right',
                                    targetAnchorY: 'top',
                                    offsetX: -32,
                                    offsetY: -8,
                                    startX: -4,
                                    startY: 124
                                }
                            ],
                            variant: 'click-narrow',
                            title: 'Масштаб',
                            body: 'Приближайте изображение, чтобы аккуратно попасть в границы области.'
                        }
                    ]
                },
                {
                    id: 'draw-tools',
                    targets: [
                        '[data-onboarding-target="click-toolbar"]',
                        '[data-onboarding-target="click-drawing-status"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-tool-choice"]',
                    skipAutoScroll: true,
                    kicker: 'Инструменты рисования',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-tool-choice"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 22,
                            variant: 'click-compact',
                            title: 'Способ обведения',
                            body: 'Прямолинейное лассо ставит точки по границе. Свободное рисование ведёт контур движением мыши.'
                        },
                        {
                            target: '[data-onboarding-target="click-polygon-actions"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 22,
                            variant: 'click-wide',
                            title: 'Работа с контуром',
                            body: 'Контур можно завершить, удалить последнюю точку или отменить незавершённое рисование.'
                        }
                    ]
                },
                {
                    id: 'draw-regions-manage',
                    targets: [
                        '#canvas-stage',
                        '[data-onboarding-target="click-annotations-panel"]',
                        '[data-onboarding-target="click-additional-materials"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-left',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-annotations-panel"]',
                    scrollTarget: '[data-onboarding-target="click-additional-materials"]',
                    scrollBlock: 'start',
                    scrollBehavior: 'smooth',
                    scrollWaitMs: 360,
                    forceAutoScroll: true,
                    kicker: 'Области и подписи',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-annotations-panel"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -180,
                            gap: 30,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: 'Список областей',
                            body: 'Каждый нарисованный контур попадает сюда. Названия можно править прямо в списке.'
                        },
                        {
                            target: '[data-onboarding-target="click-selected-annotation"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: -10,
                            gap: 26,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: 'Редактирование границы',
                            body: 'Выберите область на изображении: появятся точки контура, которые можно сдвинуть для более точной границы.'
                        },
                        {
                            target: '[data-onboarding-target="click-additional-materials"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 8,
                            gap: 30,
                            variant: 'click-compact',
                            title: 'Дополнительные материалы',
                            body: 'Здесь можно оставить контекст для автора: текст или изображение-подсказку.'
                        }
                    ]
                },
                {
                    id: 'draw-difficulty-levels',
                    targets: [
                        '#editor-difficulty-authoring',
                        '#editor-difficulty-authoring .difficulty-authoring__mode-card',
                        '#editor-difficulty-authoring .difficulty-authoring__level-card'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-left',
                    controlPlacementLocked: true,
                    readySelector: '#editor-difficulty-authoring .difficulty-authoring__level-card',
                    scrollTarget: '#editor-difficulty-authoring',
                    scrollBlock: 'start',
                    scrollBehavior: 'smooth',
                    scrollWaitMs: 360,
                    scrollContainerOffsetY: -12,
                    forceAutoScroll: true,
                    kicker: 'Финальная настройка',
                    callouts: [
                        {
                            target: '#editor-difficulty-authoring',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -230,
                            gap: 30,
                            skipOverlapPush: true,
                            variant: 'click-compact',
                            title: 'Уровни сложности',
                            body: 'В обычном комплексе 3 итерации. Для рисования уровни помогают выбрать, где появится задание: в тренировке границ или в проверке с подписью.'
                        },
                        {
                            target: '#editor-difficulty-authoring .difficulty-authoring__mode-card',
                            targetAll: true,
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 0,
                            gap: 30,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: 'Все или выборочно',
                            body: 'Оставьте все уровни, если задание подходит для любой итерации рисования. Выберите отдельные уровни, если оно нужно только для обведения или только для обведения с названием.'
                        },
                        {
                            target: '#editor-difficulty-authoring .difficulty-authoring__level-card',
                            targetAll: true,
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 80,
                            gap: 30,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: 'Что делает пользователь',
                            body: 'L1: обвести нужную область. L2: обвести область и подписать её.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'click-editor-errors-authoring',
            version: 1,
            referenceCategory: 'Создаем задания',
            referenceTags: ["click","ошибки","текст","референс"],
            referenceOrder: 140,
            route: ['/editor/Point_Annotation.html', '/Editor/Point_Annotation.html'],
            autoStart: false,
            totalStates: 4,
            persistControl: true,
            returnTourId: 'click-editor-authoring',
            returnLabel: 'К Click',
            title: 'Режим ошибок Click',
            summary: 'Как настроить Click-задание, где пользователь ищет ошибочные фрагменты внутри текста.',
            steps: [
                {
                    id: 'click-errors-overview',
                    targets: [
                        '[data-onboarding-target="click-errors-mode-button"]',
                        '[data-onboarding-target="click-errors-kind-switch"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-errors-kind-switch"]',
                    scrollY: 0,
                    skipAutoScroll: true,
                    beacons: [
                        {
                            target: '[data-onboarding-target="click-errors-texts-mode"]',
                            startTourId: 'click-editor-errors-texts-authoring',
                            label: 'Перейти к обучению режима «Тексты»',
                            placement: 'right',
                            gap: 8,
                            offsetX: 0,
                            offsetY: 0
                        }
                    ],
                    kicker: 'Режим ошибок',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-errors-mode-button"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 24,
                            variant: 'click-compact',
                            title: 'Режим ошибок',
                            body: 'Этот сценарий превращает Click-редактор в задание на поиск ошибок в тексте.'
                        },
                        {
                            target: '[data-onboarding-target="click-errors-kind-switch"]',
                            placement: 'bottom',
                            offsetX: 160,
                            offsetY: 18,
                            gap: 24,
                            variant: 'click-wide',
                            title: 'Слова и тексты',
                            body: 'Сначала разберём режим «Слова»: пользователь ищет ошибочные фрагменты внутри одного текста. К режиму «Тексты» можно перейти после этого блока.'
                        }
                    ]
                },
                {
                    id: 'click-errors-words-workflow',
                    targets: [
                        '[data-onboarding-target="click-errors-primary-tab"]',
                        '[data-onboarding-target="click-errors-reference-tab"]',
                        '[data-onboarding-target="click-errors-text-card"]',
                        '[data-onboarding-target="click-errors-add-span"]',
                        '[data-onboarding-target="click-errors-span-list"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-errors-span-list"]',
                    skipAutoScroll: true,
                    kicker: 'Слова',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-errors-primary-tab"], [data-onboarding-target="click-errors-reference-tab"]',
                            targetAll: true,
                            placement: 'left',
                            offsetX: 6,
                            offsetY: -85,
                            gap: 18,
                            skipOverlapPush: true,
                            variant: 'click-compact',
                            title: 'Основной текст и референс',
                            body: 'В «Основном тексте» размечаются ошибки. Во вкладке «Референс» хранится эталон или подсказочные фрагменты.'
                        },
                        {
                            target: '[data-onboarding-target="click-errors-text-card"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 18,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: 'Текст с ошибками',
                            body: 'Здесь вводится текст, где пользователь должен найти ошибочные фрагменты.'
                        },
                        {
                            target: '[data-onboarding-target="click-errors-add-span"]',
                            placement: 'left',
                            offsetX: 6,
                            offsetY: 0,
                            gap: 18,
                            skipOverlapPush: true,
                            keepPlacement: true,
                            variant: 'click-narrow',
                            width: 220,
                            title: 'Отметить ошибку',
                            body: 'Выделите фрагмент текста и нажмите кнопку, чтобы сохранить его как ошибку.'
                        },
                        {
                            target: '[data-onboarding-target="click-errors-span-list"]',
                            placement: 'bottom-end',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 18,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: 'Список ошибок',
                            body: 'После отметки фрагменты попадают сюда. В списке видно каждую найденную ошибку, её подпись и действия для перехода или удаления.'
                        }
                    ]
                },
                {
                    id: 'click-errors-reference',
                    targets: [
                        '[data-onboarding-target="click-errors-reference-section"]',
                        '[data-onboarding-target="click-errors-reference-title"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-errors-reference-section"]',
                    skipAutoScroll: true,
                    kicker: 'Референс',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-errors-reference-title"]',
                            placement: 'left',
                            offsetX: 0,
                            offsetY: -28,
                            arrowLengthExtra: -8,
                            gap: 32,
                            skipOverlapPush: true,
                            variant: 'click-narrow',
                            width: 210,
                            title: 'Референс',
                            body: 'Референс хранит эталонный текст и важные фрагменты. Его можно заполнить вручную или скопировать из основного текста, затем отметить опорные места.'
                        }
                    ]
                },
                {
                    id: 'click-errors-rules-instruction',
                    targets: [
                        '[data-onboarding-target="click-errors-threshold"]',
                        '[data-onboarding-target="click-errors-instruction"]',
                        '[data-onboarding-target="click-errors-instruction-title"]'
                    ],
                    placement: 'top',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-errors-instruction"]',
                    scrollTarget: '[data-onboarding-target="click-errors-instruction"]',
                    scrollBlock: 'center',
                    scrollBehavior: 'smooth',
                    scrollWaitMs: 120,
                    scrollContainerOffsetY: 34,
                    kicker: 'Проверка и инструкция',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-errors-threshold"]',
                            placement: 'top-end',
                            offsetX: -120,
                            offsetY: 12,
                            gap: 24,
                            variant: 'click-wide',
                            title: 'Условие прохождения',
                            body: 'Можно требовать найти все ошибки или указать минимальное количество для зачёта.'
                        },
                        {
                            target: '[data-onboarding-target="click-errors-instruction"]',
                            placement: 'left',
                            offsetX: 0,
                            offsetY: -8,
                            arrowLengthExtra: -8,
                            gap: 34,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            variant: 'click-narrow',
                            width: 250,
                            title: 'Инструкция',
                            body: 'Инструкция задаёт текст задания для пользователя. Если оставить её пустой, редактор подставит стандартную формулировку для поиска ошибок.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'click-editor-errors-texts-authoring',
            version: 1,
            referenceCategory: 'Создаем задания',
            referenceTags: ["click","тексты","варианты","ошибки"],
            referenceOrder: 150,
            route: ['/editor/Point_Annotation.html', '/Editor/Point_Annotation.html'],
            autoStart: false,
            totalStates: 2,
            persistControl: true,
            returnTourId: 'click-editor-authoring',
            returnLabel: 'К Click',
            title: 'Режим «Тексты» Click',
            summary: 'Как настроить Click-задание, где пользователь выбирает правильный текст из вариантов.',
            steps: [
                {
                    id: 'click-errors-texts-mode',
                    targets: [
                        '[data-onboarding-target="click-errors-texts-options"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-errors-texts-options"]',
                    skipAutoScroll: true,
                    kicker: 'Режим «Тексты»',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-errors-texts-options"]',
                            placement: 'left',
                            offsetX: 0,
                            offsetY: -24,
                            gap: 24,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            variant: 'click-narrow',
                            width: 220,
                            title: 'Варианты текстов',
                            body: 'После переключения в «Тексты» создаются варианты текста. Один вариант отмечается правильным, остальные остаются ошибочными.'
                        },
                        {
                            target: '[data-choice-add-option]',
                            placement: 'left',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 24,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            variant: 'click-narrow',
                            width: 220,
                            title: 'Добавить вариант',
                            body: 'Нажмите, чтобы добавить ещё один вариант текста.'
                        }
                    ]
                },
                {
                    id: 'click-errors-texts-instruction',
                    targets: [
                        '[data-onboarding-target="click-errors-texts-instruction"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="click-errors-texts-instruction"]',
                    scrollTarget: '[data-onboarding-target="click-errors-texts-instruction"]',
                    scrollBlock: 'center',
                    scrollBehavior: 'smooth',
                    scrollWaitMs: 320,
                    kicker: 'РРЅСЃС‚СЂСѓРєС†РёСЏ РґР»СЏ РІС‹Р±РѕСЂР°',
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-errors-texts-instruction"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 24,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            variant: 'click-narrow',
                            width: 280,
                            title: 'Инструкция для выбора',
                            body: 'Эта инструкция объясняет пользователю, как выбрать верный текст. Если оставить её пустой, редактор подставит стандартную формулировку.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'sequence-editor-authoring',
            version: 1,
            referenceCategory: 'Создаем задания',
            referenceTags: ["последовательность","уровни","шаги","порядок"],
            referenceOrder: 160,
            route: ['/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 5,
            persistControl: true,
            title: 'Редактор последовательности',
            summary: 'Как собрать задание, где элементы раскладываются по уровням и при необходимости упорядочиваются.',
            steps: [
                {
                    id: 'sequence-header-save',
                    targets: [
                        '[data-onboarding-target="sequence-header"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="sequence-save-action"]',
                    scrollY: 0,
                    kicker: 'Шапка редактора',
                    callouts: [
                        {
                            target: '[data-onboarding-target="sequence-title"]',
                            positionTarget: '[data-onboarding-target="sequence-header"]',
                            rowGroup: 'sequence-header-state-1',
                            placement: 'bottom',
                            rowInset: 24,
                            offsetX: 0,
                            offsetY: 14,
                            gap: 22,
                            hideArrow: true,
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="sequence-title"]',
                                    placement: 'diagonal',
                                    targetAnchorX: 'center',
                                    targetAnchorY: 'bottom',
                                    startY: 8
                                }
                            ],
                            variant: 'sequence-header-row',
                            title: 'Название задания',
                            body: 'В шапке видно, какая последовательность открыта для редактирования.'
                        },
                        {
                            target: '[data-onboarding-target="sequence-history-actions"]',
                            positionTarget: '[data-onboarding-target="sequence-header"]',
                            rowGroup: 'sequence-header-state-1',
                            placement: 'bottom',
                            rowInset: 24,
                            offsetX: 0,
                            offsetY: 14,
                            gap: 22,
                            hideArrow: true,
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="sequence-history-actions"]',
                                    placement: 'diagonal',
                                    targetAnchorX: 'center',
                                    targetAnchorY: 'bottom',
                                    startX: 128,
                                    startY: 8
                                }
                            ],
                            variant: 'sequence-header-row',
                            title: 'Отмена и повтор',
                            body: 'Кнопки помогают откатить правки или вернуть отменённое действие при работе с уровнями и шагами.'
                        },
                        {
                            target: '[data-onboarding-target="sequence-save-action"]',
                            positionTarget: '[data-onboarding-target="sequence-header"]',
                            rowGroup: 'sequence-header-state-1',
                            placement: 'bottom',
                            rowInset: 24,
                            offsetX: 0,
                            offsetY: 14,
                            gap: 22,
                            variant: 'sequence-header-row',
                            title: 'Сохранить',
                            body: 'Перед сохранением редактор проверит текст задания, уровни и минимум два заполненных шага.'
                        }
                    ]
                },
                {
                    id: 'sequence-prompt',
                    targets: [
                        '[data-onboarding-target="sequence-prompt-block"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="sequence-prompt-text"]',
                    scrollTarget: '[data-onboarding-target="sequence-prompt-block"]',
                    scrollBlock: 'center',
                    kicker: 'Формулировка',
                    callouts: [
                        {
                            target: '[data-onboarding-target="sequence-prompt-block"]',
                            placement: 'bottom-start',
                            offsetX: 18,
                            offsetY: 16,
                            gap: 22,
                            variant: 'open-answer-wide',
                            title: 'Текст задания',
                            body: 'Здесь описывается, что пользователь должен собрать: процесс, этапы, классификацию или порядок действий.'
                        }
                    ]
                },
                {
                    id: 'sequence-levels',
                    targets: [
                        '[data-onboarding-target="sequence-first-level"]',
                        '[data-onboarding-target="sequence-add-level"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="sequence-add-level"]',
                    scrollTarget: '[data-onboarding-target="sequence-add-level"]',
                    scrollBlock: 'nearest',
                    scrollContainerOffsetY: 24,
                    kicker: 'Уровни',
                    callouts: [
                        {
                            target: '[data-onboarding-target="sequence-first-level-title-edge"]',
                            placement: 'top',
                            offsetX: 120,
                            offsetY: 0,
                            gap: 18,
                            skipOverlapPush: true,
                            keepPlacement: true,
                            variant: 'sequence-narrow',
                            title: 'Название уровня',
                            body: 'Уровень задаёт группу или этап. В тренажёре пользователь раскладывает элементы по этим уровням.'
                        },
                        {
                            target: '[data-onboarding-target="sequence-add-level"]',
                            placement: 'top-end',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 18,
                            skipOverlapPush: true,
                            variant: 'sequence-narrow',
                            title: 'Добавить уровень',
                            body: 'Кнопка создаёт ещё одну группу для элементов. Уровней может быть несколько, если задача требует классификации или этапов.'
                        }
                    ]
                },
                {
                    id: 'sequence-steps',
                    targets: [
                        '[data-onboarding-target="sequence-first-step"]',
                        '[data-onboarding-target="sequence-first-step-actions"]',
                        '[data-onboarding-target="sequence-first-level-add-step"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="sequence-first-step"]',
                    scrollTarget: '[data-onboarding-target="sequence-first-level"]',
                    scrollBlock: 'center',
                    kicker: 'Шаги',
                    callouts: [
                        {
                            target: '[data-onboarding-target="sequence-first-step"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 20,
                            variant: 'open-answer-wide',
                            title: 'Элемент последовательности',
                            body: 'Каждая карточка — отдельный шаг. Текст карточки сохраняется как элемент, который пользователь будет размещать в ответе.'
                        },
                        {
                            target: '[data-onboarding-target="sequence-first-step-actions"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 26,
                            variant: 'open-answer-compact',
                            title: 'Порядок внутри уровня',
                            body: 'Кнопки перемещают шаги влево и вправо. Если порядок внутри уровня важен, именно эта последовательность будет проверяться.'
                        },
                        {
                            target: '[data-onboarding-target="sequence-first-level-add-step"]',
                            placement: 'right',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 22,
                            variant: 'open-answer-compact',
                            title: 'Добавить шаг',
                            body: 'Плюс добавляет новый элемент в текущий уровень. Для сохранения нужно минимум два заполненных элемента.'
                        }
                    ]
                },
                {
                    id: 'sequence-sidebar-settings',
                    targets: [
                        '[data-onboarding-target="sequence-sidebar"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="sequence-settings-block"]',
                    skipAutoScroll: true,
                    kicker: 'Проверка',
                    callouts: [
                        {
                            target: '[data-onboarding-target="sequence-logic-info"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -4,
                            gap: 30,
                            variant: 'open-answer-compact',
                            title: 'Логика проверки',
                            body: 'Ответ оценивается по тому, попали ли элементы в нужные уровни и соблюдён ли включённый порядок.'
                        },
                        {
                            target: '[data-onboarding-target="sequence-settings-block"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 18,
                            gap: 30,
                            variant: 'open-answer-wide',
                            title: 'Настройки порядка',
                            body: 'Можно отдельно включить проверку порядка шагов внутри уровня и порядка самих уровней. Подсказка ниже сразу объясняет выбранную комбинацию.'
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'editor-dashboard-authoring',
            version: 1,
            referenceCategory: 'Создаем задания',
            referenceTags: ["редактор","модули","темы","задания"],
            referenceOrder: 90,
            route: ['/editor', '/editor/Main_Dashboard.html'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 5,
            persistControl: true,
            title: 'Редактор заданий: рабочий центр',
            summary: 'Как устроены модули, темы, задания, поиск, импорт и создание нового задания.',
            steps: [
                {
                    id: 'editor-dashboard-structure',
                    targets: [
                        '[data-onboarding-target="editor-module-tree"]',
                        '[data-onboarding-target="editor-active-topic"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="editor-module-tree"]',
                    skipAutoScroll: true,
                    kicker: 'Структура материалов',
                    callouts: [
                        {
                            target: '[data-onboarding-target="editor-task-limit-badge"]',
                            placement: 'right',
                            offsetX: 18,
                            offsetY: -50,
                            gap: 24,
                            title: 'Лимит заданий',
                            body: 'Счётчик показывает, сколько личных заданий уже создано. В Premium лимита нет.'
                        },
                        {
                            target: '[data-onboarding-target="editor-active-topic"]',
                            placement: 'right',
                            offsetX: 10,
                            offsetY: -4,
                            gap: 24,
                            title: 'Текущий раздел',
                            body: 'Активная тема подсвечена в дереве. Именно в неё по умолчанию попадёт новое задание.'
                        },
                        {
                            target: '[data-onboarding-target="editor-module-tree"]',
                            placement: 'right',
                            offsetX: 24,
                            offsetY: 66,
                            gap: 24,
                            title: 'Модули и темы',
                            body: 'Задания лежат внутри тем, а темы внутри модулей. Выбор темы меняет список заданий в рабочей области.'
                        }
                    ]
                },
                {
                    id: 'editor-dashboard-author-tools',
                    targets: [
                        '[data-onboarding-target="editor-new-module-action"]',
                        '[data-onboarding-target="editor-import-action"]',
                        '[data-onboarding-target="editor-analysis-action"]',
                        '[data-onboarding-target="editor-drafts-action"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="editor-new-module-action"]',
                    skipAutoScroll: true,
                    kicker: 'Инструменты автора',
                    callouts: [
                        {
                            target: '[data-onboarding-target="editor-new-module-action"]',
                            placement: 'right',
                            offsetX: 10,
                            offsetY: 0,
                            gap: 24,
                            variant: 'action-list',
                            items: [
                                {
                                    title: 'Новый модуль',
                                    body: 'Добавляет раздел курса, где затем создаются темы и задания.'
                                },
                                {
                                    title: 'Импорт заданий',
                                    body: 'Загружает файл, показывает список заданий и добавляет выбранные в библиотеку.'
                                },
                                {
                                    title: 'Анализ теории',
                                    body: 'Даёт промпт для внешнего ИИ: пользователь открывает ИИ-сервис, вставляет ответ сюда, а редактор строит учебные единицы, карту покрытия и рекомендации.'
                                },
                                {
                                    title: 'Черновики',
                                    body: 'Показывает автосохранённые черновики заданий: открыть или удалить.'
                                }
                            ],
                            extraArrows: [
                                { target: '[data-onboarding-target="editor-import-action"]', placement: 'left' },
                                { target: '[data-onboarding-target="editor-analysis-action"]', placement: 'left' },
                                { target: '[data-onboarding-target="editor-drafts-action"]', placement: 'left' }
                            ]
                        }
                    ]
                },
                {
                    id: 'editor-dashboard-search-and-sort',
                    targets: [
                        '[data-onboarding-target="editor-workspace-toolbar"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="editor-workspace-toolbar"]',
                    skipAutoScroll: true,
                    kicker: 'Навигация по заданиям',
                    callouts: [
                        {
                            target: '[data-onboarding-target="editor-breadcrumbs"]',
                            positionTarget: '[data-onboarding-target="editor-workspace-toolbar"]',
                            placement: 'bottom-start',
                            offsetX: 24,
                            offsetY: 0,
                            gap: 22,
                            variant: 'toolbar-breadcrumbs',
                            title: 'Хлебные крошки',
                            body: 'Верхняя строка показывает, какой модуль и тема сейчас открыты, и позволяет быстро вернуться выше.'
                        },
                        {
                            target: '[data-onboarding-target="editor-search"]',
                            positionTarget: '[data-onboarding-target="editor-workspace-toolbar"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            rightOffset: 320,
                            offsetY: 0,
                            gap: 22,
                            variant: 'toolbar-search',
                            title: 'Поиск',
                            body: 'Поиск помогает найти задание, модуль или файл без ручного просмотра всей структуры.'
                        },
                        {
                            target: '[data-onboarding-target="editor-sort"]',
                            positionTarget: '[data-onboarding-target="editor-workspace-toolbar"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            rightOffset: 24,
                            offsetY: 0,
                            gap: 22,
                            variant: 'toolbar-sort',
                            title: 'Сортировка',
                            body: 'Список можно упорядочить по дате изменения, алфавиту или типу задания.'
                        }
                    ]
                },
                {
                    id: 'editor-dashboard-task-grid',
                    targets: [
                        '[data-onboarding-target="editor-existing-task-card"]',
                        '[data-onboarding-target="editor-task-favorite-action"]',
                        '[data-onboarding-target="editor-create-task-card"]'
                    ],
                    placement: 'top',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="editor-existing-task-card"]',
                    scrollTarget: '[data-onboarding-target="editor-task-grid"]',
                    scrollBlock: 'nearest',
                    kicker: 'Рабочая область',
                    callouts: [
                        {
                            target: '[data-onboarding-target="editor-existing-task-card"]',
                            targetAll: true,
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 10,
                            gap: 26,
                            title: 'Сохранённые задания',
                            body: 'Карточки открывают созданные задания для просмотра или редактирования. Звёздочка добавляет задание в избранное.'
                        },
                        {
                            target: '[data-onboarding-target="editor-create-task-card"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 10,
                            gap: 26,
                            title: 'Новое задание',
                            body: 'Эта карточка запускает создание задания в выбранной теме.'
                        }
                    ]
                },
                {
                    id: 'editor-dashboard-create-task',
                    targets: [
                        '[data-onboarding-target="editor-create-task-dialog"]',
                        '[data-onboarding-target="editor-create-task-context"]',
                        '[data-onboarding-target="editor-create-task-topic"]',
                        '[data-onboarding-target="editor-create-task-name"]',
                        '[data-onboarding-target="editor-create-task-type"]',
                        '[data-onboarding-target="editor-create-task-submit"]'
                    ],
                    placement: 'top',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="editor-create-task-modal"]',
                    skipAutoScroll: true,
                    kicker: 'Создание задания',
                    callouts: [
                        {
                            target: '[data-onboarding-target="editor-create-task-context"]',
                            positionTarget: '[data-onboarding-target="editor-create-task-dialog"]',
                            placement: 'right',
                            offsetX: 18,
                            offsetY: -150,
                            gap: 30,
                            variant: 'create-task-context',
                            title: 'Контекст задания',
                            body: 'Перед созданием выбираются модуль, тема и понятное название, чтобы задание сразу попало в нужное место.'
                        },
                        {
                            target: '[data-onboarding-target="editor-create-task-type"]',
                            positionTarget: '[data-onboarding-target="editor-create-task-dialog"]',
                            placement: 'right',
                            offsetX: 18,
                            offsetY: 122,
                            gap: 30,
                            variant: 'create-task-type',
                            title: 'Тип задания',
                            body: 'Тип определяет, какой рабочий редактор откроется дальше: тест, клик, рисунок, последовательность или открытый ответ.'
                        },
                        {
                            target: '[data-onboarding-target="editor-create-task-submit"]',
                            positionTarget: '[data-onboarding-target="editor-create-task-dialog"]',
                            placement: 'left',
                            offsetX: 18,
                            offsetY: 132,
                            gap: 30,
                            arrowOffsetY: 34,
                            variant: 'create-task-training',
                            title: 'Обучение по типам',
                            body: 'Подробные подсказки для конкретных типов заданий не запускаются принудительно. Их можно открыть из справочника или кнопки помощи внутри выбранного редактора.'
                        }
                    ]
                }
            ]
        }
    ];
})();
