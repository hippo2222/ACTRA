(function () {
    'use strict';

    function wt(key, fallback) {
        if (!window.i18n || typeof window.i18n.t !== 'function') return fallback;
        var v = window.i18n.t(key);
        return v !== key ? v : fallback;
    }

    window.ACTRA_ONBOARDING_TOURS = [
        {
            tourId: 'main-dashboard-work-contour',
            version: 1,
            referenceCategory: 'intro',
            referenceTags: ["главная","быстрый доступ","комплексы","старт"],
            referenceOrder: 10,
            route: ['/main'],
            autoStart: true,
            autoStartDelay: 1500,
            totalStates: 3,
            title: wt('tours.main_dashboard_work_contour.title', 'Главная: основной рабочий контур'),
            summary: wt('tours.main_dashboard_work_contour.summary', 'Первое знакомство с блоками, через которые пользователь начинает обучение.'),
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
                    kicker: wt('tours.main_dashboard_work_contour.work_contour.kicker', 'С чего начать'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="main-catalog-card"]',
                            placement: 'bottom',
                            keepPlacement: true,
                            offsetX: -80,
                            offsetY: 10,
                            title: wt('tours.main_dashboard_work_contour.work_contour.c0_title', 'Каталог учебных материалов'),
                            body: wt('tours.main_dashboard_work_contour.work_contour.c0_body', 'Здесь можно смотреть открытые материалы других авторов, выбирать подходящие комплексы или теорию и добавлять их в свою библиотеку.')
                        },
                        {
                            target: '[data-onboarding-target="main-complexes-card"]',
                            placement: 'bottom',
                            offsetX: 60,
                            offsetY: 18,
                            title: wt('tours.main_dashboard_work_contour.work_contour.c1_title', 'Проходить комплексы'),
                            body: wt('tours.main_dashboard_work_contour.work_contour.c1_body', 'Это основной рабочий раздел: здесь видно, какие комплексы уже есть в библиотеке, что можно запустить, продолжить или повторить.')
                        },
                        {
                            target: '[data-onboarding-target="main-microcards-card"]',
                            placement: 'right',
                            offsetX: 24,
                            offsetY: -10,
                            title: wt('tours.main_dashboard_work_contour.work_contour.c2_title', 'Микрокарточки'),
                            body: wt('tours.main_dashboard_work_contour.work_contour.c2_body', 'Быстрый режим повторения через карточки и пары вроде "термин - определение". Раздел ещё дорабатывается.')
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
                    kicker: wt('tours.main_dashboard_work_contour.author_tools.kicker', 'Инструменты авторов'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="main-author-task-editor-card"]',
                            placement: 'bottom',
                            rowGroup: 'main-author-tools',
                            rowInset: 12,
                            width: 260,
                            offsetX: 0,
                            offsetY: 20,
                            title: wt('tours.main_dashboard_work_contour.author_tools.c0_title', 'Редактор заданий'),
                            body: wt('tours.main_dashboard_work_contour.author_tools.c0_body', 'В редакторе заданий создаются учебные задачи: тесты, клики, открытые ответы и другие форматы для будущих комплексов.')
                        },
                        {
                            target: '[data-onboarding-target="main-author-complex-editor-card"]',
                            placement: 'bottom',
                            rowGroup: 'main-author-tools',
                            rowInset: 12,
                            width: 225,
                            offsetX: 0,
                            offsetY: 20,
                            title: wt('tours.main_dashboard_work_contour.author_tools.c1_title', 'Редактор комплексов'),
                            body: wt('tours.main_dashboard_work_contour.author_tools.c1_body', 'Редактор комплексов собирает задания в полноценный сценарий обучения: порядок, повторы, связанная теория и публикация.')
                        },
                        {
                            target: '[data-onboarding-target="main-author-theory-center-card"]',
                            placement: 'bottom',
                            rowGroup: 'main-author-tools',
                            rowInset: 12,
                            width: 270,
                            offsetX: 18,
                            offsetY: 20,
                            title: wt('tours.main_dashboard_work_contour.author_tools.c2_title', 'Центр теории'),
                            body: wt('tours.main_dashboard_work_contour.author_tools.c2_body', 'Центр теории помогает хранить материалы, связывать их с темами и прикреплять к комплексам как учебный контекст.')
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
                    kicker: wt('tours.main_dashboard_work_contour.activity_widgets.kicker', 'После первых действий'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="main-stats-card"]',
                            placement: 'left',
                            offsetX: 36,
                            offsetY: -136,
                            body: wt('tours.main_dashboard_work_contour.activity_widgets.c0_body', 'Календарь и статистика оживают после учебной активности: здесь появятся план на день, повторы, точность, динамика и слабые места.')
                        },
                        {
                            target: '[data-onboarding-target="main-quick-access-card"]',
                            placement: 'left',
                            keepPlacement: true,
                            width: 320,
                            offsetX: 36,
                            offsetY: -18,
                            body: wt('tours.main_dashboard_work_contour.activity_widgets.c1_body', 'Быстрый доступ собирает комплексы, к которым пользователь возвращается чаще всего: закреплённые, недавние и активные.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'complexes-library-navigation',
            version: 1,
            referenceCategory: 'practice',
            referenceTags: ["комплексы","поиск","фильтры","библиотека"],
            referenceOrder: 20,
            route: ['/complexes'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 3,
            title: wt('tours.complexes_library_navigation.title', 'Комплексы: поиск и фильтрация'),
            summary: wt('tours.complexes_library_navigation.summary', 'Первое знакомство с библиотекой комплексов: поиск, фильтры, сортировка и текущая сводка.'),
            steps: [
                {
                    id: 'search-and-filters',
                    targets: [
                        '[data-onboarding-target="complexes-library-navigation"]'
                    ],
                    placement: 'bottom',
                    kicker: wt('tours.complexes_library_navigation.search_and_filters.kicker', 'Навигация по комплексам'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="complexes-search"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: -18,
                            gap: 22,
                            title: wt('tours.complexes_library_navigation.search_and_filters.c0_title', 'Поиск по библиотеке'),
                            body: wt('tours.complexes_library_navigation.search_and_filters.c0_body', 'Поиск помогает быстро найти комплекс по названию, описанию или конкретному заданию внутри него.')
                        },
                        {
                            target: '.cx-controls-section--combined',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 18,
                            title: wt('tours.complexes_library_navigation.search_and_filters.c1_title', 'Фильтры и сортировка'),
                            body: wt('tours.complexes_library_navigation.search_and_filters.c1_body', 'Оставьте нужные комплексы: авторские, из каталога, на паузе или для повтора. Рядом сортировка и сводка результата.')
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
                    kicker: wt('tours.complexes_library_navigation.complex_card_actions.kicker', 'Карточка комплекса'),
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
                            title: wt('tours.complexes_library_navigation.complex_card_actions.c0_title', 'Учебный сценарий'),
                            body: wt('tours.complexes_library_navigation.complex_card_actions.c0_body', 'Карточка показывает, что это за комплекс: описание, количество заданий, статус обучения, пауза и связь с теорией.')
                        },
                        {
                            target: '[data-onboarding-target="complexes-start-action"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 22,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            title: wt('tours.complexes_library_navigation.complex_card_actions.c1_title', 'Запуск или продолжение'),
                            body: wt('tours.complexes_library_navigation.complex_card_actions.c1_body', 'Главная кнопка запускает новый прогон. Если комплекс уже на паузе, она возвращает пользователя в сохранённую сессию.')
                        },
                        {
                            target: '[data-onboarding-target="complexes-card-secondary-actions"]',
                            placement: 'bottom-end',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 22,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            title: wt('tours.complexes_library_navigation.complex_card_actions.c2_title', 'Рабочие действия'),
                            body: wt('tours.complexes_library_navigation.complex_card_actions.c2_body', 'Здесь комплекс можно закрепить в быстром доступе, экспортировать, открыть для редактирования или удалить из библиотеки.')
                        }
                    ]
                },
                {
                    id: 'complex-library-actions',
                    targets: [
                        '[data-onboarding-target="complexes-toolbar-actions"]'
                    ],
                    placement: 'bottom',
                    kicker: wt('tours.complexes_library_navigation.complex_library_actions.kicker', 'Пополнение библиотеки'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="complexes-create"]',
                            placement: 'bottom',
                            offsetX: 48,
                            offsetY: 18,
                            title: wt('tours.complexes_library_navigation.complex_library_actions.c0_title', 'Создать комплекс'),
                            body: wt('tours.complexes_library_navigation.complex_library_actions.c0_body', 'Создание открывает редактор комплексов, где задания собираются в учебный маршрут с теорией, порядком прохождения и публикацией.')
                        },
                        {
                            target: '[data-onboarding-target="complexes-add-by-code"]',
                            placement: 'bottom',
                            offsetX: -320,
                            offsetY: 56,
                            title: wt('tours.complexes_library_navigation.complex_library_actions.c1_title', 'Импорт и код доступа'),
                            body: wt('tours.complexes_library_navigation.complex_library_actions.c1_body', 'Импорт переносит комплекс из файла. Код доступа добавляет закрытую публикацию из каталога прямо в библиотеку.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'complex-editor-authoring',
            version: 1,
            referenceCategory: 'assemble',
            referenceTags: ["редактор комплексов","комплекс","теория","публикация"],
            referenceOrder: 70,
            route: ['/complexes/create'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 5,
            persistControl: true,
            title: wt('tours.complex_editor_authoring.title', 'Редактор комплексов: сценарий обучения'),
            summary: wt('tours.complex_editor_authoring.summary', 'Как собрать комплекс из заданий, добавить теорию, настроить порядок прохождения, связать задания в сцепки, проверить готовность и сохранить результат.'),
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
                    kicker: wt('tours.complex_editor_authoring.complex_editor_core_info.kicker', 'Основа комплекса'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="complex-editor-info"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 24,
                            keepPlacement: true,
                            title: wt('tours.complex_editor_authoring.complex_editor_core_info.c0_title', 'Название и описание'),
                            body: wt('tours.complex_editor_authoring.complex_editor_core_info.c0_body', 'Это карточка сценария: название помогает найти комплекс в библиотеке, а описание объясняет, чему он учит и когда его запускать.')
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-header"]',
                            placement: 'bottom',
                            offsetX: 520,
                            offsetY: 36,
                            gap: 22,
                            keepPlacement: true,
                            title: wt('tours.complex_editor_authoring.complex_editor_core_info.c1_title', 'Панель редактора'),
                            body: wt('tours.complex_editor_authoring.complex_editor_core_info.c1_body', 'Верхняя панель показывает статус работы, готовность состава, публикацию и сохранение текущей версии комплекса.')
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
                    kicker: wt('tours.complex_editor_authoring.complex_editor_theory_context.kicker', 'Теория как контекст'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="complex-editor-theory"]',
                            placement: 'right',
                            offsetX: 24,
                            offsetY: -76,
                            gap: 24,
                            title: wt('tours.complex_editor_authoring.complex_editor_theory_context.c0_title', 'Связанная теория'),
                            body: wt('tours.complex_editor_authoring.complex_editor_theory_context.c0_body', 'Комплекс может наследовать теорию из тем, привязать существующий материал или создать отдельный текст. Это даёт ученику контекст для задач.')
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-theory-source"]',
                            placement: 'right',
                            offsetX: 24,
                            offsetY: 0,
                            gap: 24,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            title: wt('tours.complex_editor_authoring.complex_editor_theory_context.c1_title', 'Источник теории'),
                            body: wt('tours.complex_editor_authoring.complex_editor_theory_context.c1_body', 'Здесь выбирается, откуда брать теорию: из тем комплекса, из существующего материала или из нового текста внутри редактора.')
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-theory-content"]',
                            placement: 'right',
                            offsetX: 24,
                            offsetY: 18,
                            gap: 24,
                            keepPlacement: true,
                            title: wt('tours.complex_editor_authoring.complex_editor_theory_context.c2_title', 'Содержимое теории'),
                            body: wt('tours.complex_editor_authoring.complex_editor_theory_context.c2_body', 'В демо показан вариант с новой теорией: можно задать заголовок, оформить текст, добавить изображения и сохранить всё вместе с комплексом.')
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
                    kicker: wt('tours.complex_editor_authoring.complex_editor_task_selection.kicker', 'Сборка задач'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="complex-editor-selected-tasks"]',
                            placement: 'top',
                            offsetX: -240,
                            offsetY: 10,
                            gap: 28,
                            keepPlacement: true,
                            title: wt('tours.complex_editor_authoring.complex_editor_task_selection.c0_title', 'Задания в комплексе'),
                            body: wt('tours.complex_editor_authoring.complex_editor_task_selection.c0_body', 'Здесь собирается рабочий маршрут. Порядок и состав важны: комплекс должен вести ученика от проверки базовых вещей к закреплению.')
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-complexes-tab"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 44,
                            keepPlacement: true,
                            width: 560,
                            body: wt('tours.complex_editor_authoring.complex_editor_task_selection.c1_body', 'Во вкладке «Комплексы» можно выбрать уже созданный комплекс и открыть его для редактирования.')
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-task-library"]',
                            placement: 'left',
                            offsetX: 28,
                            offsetY: -250,
                            gap: 28,
                            keepPlacement: true,
                            title: wt('tours.complex_editor_authoring.complex_editor_task_selection.c2_title', 'Библиотека заданий'),
                            body: wt('tours.complex_editor_authoring.complex_editor_task_selection.c2_body', 'Справа выбираются задания из рабочей библиотеки. Поиск помогает быстро найти нужный модуль, тему, ID или тег.')
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-add-selected"]',
                            placement: 'left',
                            offsetX: 30,
                            offsetY: 250,
                            gap: 28,
                            keepPlacement: true,
                            title: wt('tours.complex_editor_authoring.complex_editor_task_selection.c3_title', 'Добавить выбранные'),
                            body: wt('tours.complex_editor_authoring.complex_editor_task_selection.c3_body', 'После выбора задания попадают в комплекс. Счётчик показывает, сколько элементов будет добавлено за один шаг.')
                        }
                    ],
                    beacons: [
                        {
                            target: '[data-onboarding-target="complex-editor-test-mode-control"]',
                            stepVariant: 'test-mode-control',
                            label: wt('tours.complex_editor_authoring.complex_editor_task_selection.c4_label', 'Показать подсказку про режим тестового задания'),
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
                    variantBackLabel: wt('tours.complex_editor_authoring.complex_editor_task_selection.variantBackLabel', 'К сборке'),
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
                                title: wt('tours.complex_editor_authoring.complex_editor_task_selection.c5_title', 'Вместе / Вразброс'),
                                body: wt('tours.complex_editor_authoring.complex_editor_task_selection.c5_body', '«Вместе» означает, что все вопросы тестового задания будут идти рядом друг с другом. «Вразброс» замешивает вопросы теста между другими заданиями комплекса. Если тест входит в сцепку, вопросы принудительно идут вместе, чтобы связанный блок не распадался.')
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
                    kicker: wt('tours.complex_editor_authoring.complex_editor_chains.kicker', 'Сцепки'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="complex-editor-selected-tasks"]',
                            placement: 'right',
                            offsetX: 18,
                            offsetY: -80,
                            gap: 26,
                            keepPlacement: true,
                            width: 420,
                            title: wt('tours.complex_editor_authoring.complex_editor_chains.c0_title', 'Связанные задания'),
                            body: wt('tours.complex_editor_authoring.complex_editor_chains.c0_body', 'Сцепка влияет не только на разметку в редакторе: при запуске комплекса эти задания попадут в очередь как один блок, а не как разрозненные элементы.')
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-chains"]',
                            placement: 'right',
                            offsetX: 24,
                            offsetY: 0,
                            gap: 24,
                            keepPlacement: true,
                            width: 430,
                            title: wt('tours.complex_editor_authoring.complex_editor_chains.c1_title', 'Порядок внутри сцепки'),
                            body: wt('tours.complex_editor_authoring.complex_editor_chains.c1_body', 'Генератор очереди сначала группирует сцепку в chunk, а уже потом балансирует очередь. Поэтому порядок внутри блока сохраняется при прохождении.')
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
                    kicker: wt('tours.complex_editor_authoring.complex_editor_readiness_and_release.kicker', 'Готовность и выпуск'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="complex-editor-quality"]',
                            placement: 'bottom',
                            offsetX: -220,
                            offsetY: 12,
                            gap: 22,
                            title: wt('tours.complex_editor_authoring.complex_editor_readiness_and_release.c0_title', 'Готовность состава'),
                            body: wt('tours.complex_editor_authoring.complex_editor_readiness_and_release.c0_body', 'Индикатор проверяет, достаточно ли заданий, типов и структуры для нормального прохождения. Это быстрый контроль перед сохранением.')
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-publish"]',
                            placement: 'bottom',
                            offsetX: -80,
                            offsetY: 12,
                            gap: 22,
                            title: wt('tours.complex_editor_authoring.complex_editor_readiness_and_release.c1_title', 'Публикация'),
                            body: wt('tours.complex_editor_authoring.complex_editor_readiness_and_release.c1_body', 'Публикация делает комплекс доступным через каталог или выбранный режим доступа. Черновик можно продолжать редактировать отдельно.')
                        },
                        {
                            target: '[data-onboarding-target="complex-editor-save"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 12,
                            gap: 22,
                            title: wt('tours.complex_editor_authoring.complex_editor_readiness_and_release.c2_title', 'Сохранение'),
                            body: wt('tours.complex_editor_authoring.complex_editor_readiness_and_release.c2_body', 'Сохранение фиксирует текущую версию редактора: название, теорию, выбранные задания, порядок и сцепки.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'calendar-daily-plan',
            version: 1,
            referenceCategory: 'practice',
            referenceTags: ["календарь","план","повторение","память"],
            referenceOrder: 30,
            route: ['/calendar'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 3,
            persistControl: true,
            title: wt('tours.calendar_daily_plan.title', 'Календарь: план обучения'),
            summary: wt('tours.calendar_daily_plan.summary', 'Как читать дневной план, расписание, активность и здоровье памяти.'),
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
                    kicker: wt('tours.calendar_daily_plan.calendar_today_plan.kicker', 'Что делать сегодня'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="calendar-daily-mix-card"]',
                            placement: 'bottom',
                            offsetX: -32,
                            offsetY: 18,
                            title: 'Daily Mix',
                            body: wt('tours.calendar_daily_plan.calendar_today_plan.c0_body', 'Короткая подборка повторов: ошибки, слабые места и материал, который пора освежить.')
                        },
                        {
                            target: '[data-onboarding-target="calendar-main-focus-card"]',
                            placement: 'bottom',
                            offsetX: 20,
                            offsetY: 18,
                            title: wt('tours.calendar_daily_plan.calendar_today_plan.c1_title', 'Фокус дня'),
                            body: wt('tours.calendar_daily_plan.calendar_today_plan.c1_body', 'Главный комплекс на сегодня. Он помогает не выбирать вручную, что учить дальше.')
                        },
                        {
                            target: '[data-onboarding-target="calendar-time-controller"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 18,
                            title: wt('tours.calendar_daily_plan.calendar_today_plan.c2_title', 'Лимит времени'),
                            body: wt('tours.calendar_daily_plan.calendar_today_plan.c2_body', 'План подстраивается под доступные минуты и не предлагает больше, чем реально пройти.')
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
                    kicker: wt('tours.calendar_daily_plan.calendar_rhythm.kicker', 'Ритм недели'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="calendar-schedule-panel"]',
                            placement: 'top',
                            offsetX: 260,
                            offsetY: 22,
                            title: wt('tours.calendar_daily_plan.calendar_rhythm.c0_title', 'Ближайшие дни'),
                            body: wt('tours.calendar_daily_plan.calendar_rhythm.c0_body', 'Лента показывает, где стоят повторы и сколько учебных действий запланировано на неделю.')
                        },
                        {
                            target: '[data-onboarding-target="calendar-activity-panel"]',
                            placement: 'right',
                            offsetX: 28,
                            offsetY: -6,
                            title: wt('tours.calendar_daily_plan.calendar_rhythm.c1_title', 'Активность'),
                            body: wt('tours.calendar_daily_plan.calendar_rhythm.c1_body', 'Тепловая карта быстро показывает регулярность: где был темп, а где появились пропуски.')
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
                    kicker: wt('tours.calendar_daily_plan.calendar_memory_health.kicker', 'Что проседает'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="calendar-memory-notification"]',
                            placement: 'top',
                            offsetX: -120,
                            offsetY: 18,
                            title: wt('tours.calendar_daily_plan.calendar_memory_health.c0_title', 'Сигнал к повтору'),
                            body: wt('tours.calendar_daily_plan.calendar_memory_health.c0_body', 'Если комплекс проседает, календарь сразу показывает, что лучше освежить сегодня.')
                        },
                        {
                            target: '[data-onboarding-target="calendar-memory-health-panel"]',
                            placement: 'left',
                            offsetX: 24,
                            offsetY: 0,
                            gap: 28,
                            keepPlacement: true,
                            title: wt('tours.calendar_daily_plan.calendar_memory_health.c1_title', 'Здоровье памяти'),
                            body: wt('tours.calendar_daily_plan.calendar_memory_health.c1_body', 'Здесь видно, какие комплексы держатся уверенно, а какие лучше повторить первыми.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'microcards-library-overview',
            version: 1,
            referenceCategory: 'practice',
            referenceTags: ["микрокарточки", "повторение", "колоды", "интервальные повторения", "уровень колоды"],
            referenceOrder: 25,
            route: ['/microcards'],
            autoStart: true,
            autoStartDelay: 1200,
            totalStates: 5,
            persistControl: true,
            title: wt('tours.microcards_library_overview.title', 'Микрокарточки: колоды и повторение'),
            summary: wt('tours.microcards_library_overview.summary', 'Короткие карточки для интервального повторения: где видеть долги, как устроена колода и какие режимы обучения у неё есть.'),
            steps: [
                {
                    id: 'library-pulse',
                    targets: [
                        '[data-onboarding-target="microcards-library-stats"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: wt('tours.microcards_library_overview.library_pulse.kicker', 'Пульс повторения'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="microcards-library-stats"]',
                            placement: 'bottom',
                            offsetY: 18,
                            title: wt('tours.microcards_library_overview.library_pulse.c0_title', 'Что требует внимания сегодня'),
                            body: wt('tours.microcards_library_overview.library_pulse.c0_body', '"К повтору" - карточки, по которым подошёл срок повторения: чем дольше их откладывать, тем быстрее забывается материал. "Новых" - карточки, которые вы ещё не изучали. Эти цифры важнее общего числа колод.')
                        }
                    ]
                },
                {
                    id: 'library-find',
                    targets: [
                        '[data-onboarding-target="microcards-search"]',
                        '[data-onboarding-target="microcards-sort"]',
                        '[data-onboarding-target="microcards-create-actions"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: wt('tours.microcards_library_overview.library_find.kicker', 'Найти и создать'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="microcards-search"]',
                            placement: 'bottom',
                            offsetY: 18,
                            title: wt('tours.microcards_library_overview.library_find.c0_title', 'Поиск и порядок'),
                            body: wt('tours.microcards_library_overview.library_find.c0_body', 'Поиск находит колоду по названию, а сортировка рядом помогает поднять наверх то, что важно сейчас, - например, колоды с долгами по повторению.')
                        },
                        {
                            target: '[data-onboarding-target="microcards-create-actions"]',
                            placement: 'left',
                            keepPlacement: true,
                            offsetX: 0,
                            offsetY: 0,
                            title: wt('tours.microcards_library_overview.library_find.c1_title', 'Новые колоды'),
                            body: wt('tours.microcards_library_overview.library_find.c1_body', 'Колоду можно создать с нуля или получить готовую: по коду доступа от автора либо из каталога учебных материалов.')
                        }
                    ]
                },
                {
                    id: 'library-deck-card',
                    targets: [
                        '[data-onboarding-target="microcards-deck-card"]',
                        '[data-onboarding-target="microcards-decks-grid"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: wt('tours.microcards_library_overview.library_deck_card.kicker', 'Карточка колоды'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="microcards-deck-card"]',
                            placement: 'top',
                            offsetY: -10,
                            title: wt('tours.microcards_library_overview.library_deck_card.c0_title', 'Колода в библиотеке'),
                            body: wt('tours.microcards_library_overview.library_deck_card.c0_body', 'На карточке видно размер колоды и сколько карточек ждёт повторения. Клик открывает страницу колоды с режимами обучения и списком карточек.')
                        }
                    ]
                },
                {
                    id: 'deck-mastery',
                    targets: [
                        '[data-onboarding-target="microcards-deck-mastery"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: wt('tours.microcards_library_overview.deck_mastery.kicker', 'Внутри колоды'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="microcards-deck-mastery"]',
                            placement: 'bottom',
                            offsetY: 12,
                            title: wt('tours.microcards_library_overview.deck_mastery.c0_title', 'Уровень колоды'),
                            body: wt('tours.microcards_library_overview.deck_mastery.c0_body', 'Каждое занятие приносит синаптический вес (SW) и поднимает уровень колоды. Без повторений вес постепенно тает - так видно, какие колоды держатся в памяти, а какие пора освежить.')
                        }
                    ]
                },
                {
                    id: 'study-modes',
                    targets: [
                        '[data-onboarding-target="microcards-study-modes"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    scrollBlock: 'start',
                    forceAutoScroll: true,
                    kicker: wt('tours.microcards_library_overview.study_modes.kicker', 'Режимы обучения'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="microcards-study-modes"]',
                            placement: 'bottom',
                            keepPlacement: true,
                            offsetX: 0,
                            offsetY: 0,
                            title: wt('tours.microcards_library_overview.study_modes.c0_title', 'Режимы обучения'),
                            body: wt('tours.microcards_library_overview.study_modes.c0_body', 'Прохождения - изучение всей колоды: Уровень 1 в формате "знаю / не знаю", Уровень 2 с вводом ответа. "Повторение" - ежедневная работа с долгами, "Просмотр" - свободное листание. Подсказки по самой сессии появятся при первом запуске, а позже их можно найти в справочнике.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'microcards-review-session',
            version: 1,
            referenceCategory: 'practice',
            referenceTags: ["микрокарточки", "повторение", "сессия", "оценка знаю не знаю", "очередь ошибок", "синаптический вес"],
            referenceOrder: 26,
            route: ['/microcards'],
            autoStart: false,
            autoStartDelay: 900,
            totalStates: 4,
            persistControl: true,
            title: wt('tours.microcards_review_session.title', 'Микрокарточки: сессия повторения'),
            summary: wt('tours.microcards_review_session.summary', 'Как проходит сессия: показать ответ, честно оценить себя, вернуть ошибки и прочитать итоги.'),
            steps: [
                {
                    id: 'session-card',
                    targets: [
                        '[data-onboarding-target="microcards-session-card"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: wt('tours.microcards_review_session.session_card.kicker', 'Карточка'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="microcards-session-card"]',
                            placement: 'bottom',
                            offsetY: 14,
                            title: wt('tours.microcards_review_session.session_card.c0_title', 'Лицевая сторона'),
                            body: wt('tours.microcards_review_session.session_card.c0_body', 'Сначала показывается вопрос. Карточка переворачивается на ответ. В «обратных» колодах вопрос и ответ меняются местами, поэтому полезно знать обе стороны.')
                        },
                        {
                            target: '[data-onboarding-target="microcards-session-card"]',
                            placement: 'top',
                            offsetY: -14,
                            title: wt('tours.microcards_review_session.session_reveal.c0_title', 'Сначала вспомните сами'),
                            body: wt('tours.microcards_review_session.session_reveal.c0_body', 'Попробуйте вспомнить ответ, затем откройте обратную сторону. В колодах с вводом ответа здесь будет поле для печати — ответ проверится автоматически.')
                        }
                    ]
                },
                {
                    id: 'session-grade',
                    targets: [
                        '[data-onboarding-target="microcards-session-rail-no"]',
                        '[data-onboarding-target="microcards-session-card"]',
                        '[data-onboarding-target="microcards-session-rail-yes"]'
                    ],
                    placement: 'top',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: wt('tours.microcards_review_session.session_grade.kicker', 'Оценка'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="microcards-session-card"]',
                            placement: 'top',
                            offsetY: -16,
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="microcards-session-rail-no"]',
                                    placement: 'left',
                                    sameAxis: true
                                },
                                {
                                    target: '[data-onboarding-target="microcards-session-rail-yes"]',
                                    placement: 'right',
                                    sameAxis: true
                                }
                            ],
                            title: wt('tours.microcards_review_session.session_grade.c0_title', 'Знаю или не знаю'),
                            body: wt('tours.microcards_review_session.session_grade.c0_body', 'После ответа честно оцените себя — это единственная оценка, по ней планируется следующее повторение карточки.')
                        }
                    ]
                },
                {
                    id: 'session-queue',
                    targets: [
                        '[data-onboarding-target="microcards-session-hud"]',
                        '[data-onboarding-target="microcards-session-progress"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: wt('tours.microcards_review_session.session_queue.kicker', 'Прогресс и ошибки'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="microcards-session-hud"]',
                            placement: 'bottom',
                            offsetY: 14,
                            extraArrows: [
                                { target: '#comboChip', placement: 'bottom', sameAxis: true },
                                { target: '#mcRepeatChip', placement: 'bottom', sameAxis: true },
                                { target: '#xpChip', placement: 'bottom', sameAxis: true }
                            ],
                            title: wt('tours.microcards_review_session.session_queue.c0_title', 'SW, серия и возвраты'),
                            body: wt('tours.microcards_review_session.session_queue.c0_body', 'Здесь виден набранный синаптический вес (SW) и серия правильных ответов подряд. Значок повтора показывает карточки с ошибкой — они вернутся в этой же сессии, пока вы не ответите верно.')
                        },
                        {
                            target: '[data-onboarding-target="microcards-session-progress"]',
                            placement: 'bottom',
                            offsetY: 14,
                            title: wt('tours.microcards_review_session.session_queue.c1_title', 'Полоса прогресса'),
                            body: wt('tours.microcards_review_session.session_queue.c1_body', 'Полоса считает освоенные карточки, а не пройденные подряд, поэтому при ошибке она не откатывается назад.')
                        }
                    ]
                },
                {
                    id: 'session-summary',
                    targets: [
                        '[data-onboarding-target="microcards-summary-result"]',
                        '[data-onboarding-target="microcards-summary-errors"]',
                        '[data-onboarding-target="microcards-summary-errors-title"]'
                    ],
                    placement: 'right',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    kicker: wt('tours.microcards_review_session.session_summary.kicker', 'Итоги'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="microcards-summary-result"]',
                            placement: 'right',
                            offsetX: 24,
                            title: wt('tours.microcards_review_session.session_summary.c0_title', 'Результат сессии'),
                            body: wt('tours.microcards_review_session.session_summary.c0_body', 'Итоги показывают точность с первой попытки, набранный SW и лучшую серию. Отсюда можно вернуться к колодам или пройти повторение ещё раз.')
                        },
                        {
                            target: '[data-onboarding-target="microcards-summary-errors-title"]',
                            placement: 'right',
                            offsetX: 16,
                            title: wt('tours.microcards_review_session.session_summary.c1_title', 'Что потребовало повтора'),
                            body: wt('tours.microcards_review_session.session_summary.c1_body', 'Карточки, которые вернулись через очередь ошибок, собраны отдельно — это подсказка, что повторить в следующий раз.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'statistics-learning-signals',
            version: 1,
            referenceCategory: 'stats',
            referenceTags: ["статистика","метрики","ритм","прогресс"],
            referenceOrder: 40,
            route: ['/statistics'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 3,
            persistControl: true,
            title: wt('tours.statistics_learning_signals.title', 'Статистика: сигналы обучения'),
            summary: wt('tours.statistics_learning_signals.summary', 'Как читать общие метрики и отличать полезные учебные сигналы от справочных цифр.'),
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
                    kicker: wt('tours.statistics_learning_signals.statistics_overall_metrics.kicker', 'Общие метрики'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="statistics-metrics-progress-anchor"]',
                            placement: 'bottom',
                            offsetX: -80,
                            offsetY: 18,
                            title: wt('tours.statistics_learning_signals.statistics_overall_metrics.c0_title', 'Сколько уже сделано'),
                            body: wt('tours.statistics_learning_signals.statistics_overall_metrics.c0_body', 'Здесь видно, сколько задач освоено и сколько времени ушло на обучение. Это общий прогресс, но он сам по себе не говорит, что учить дальше.')
                        },
                        {
                            target: '[data-onboarding-target="statistics-metrics-repeat-anchor"]',
                            placement: 'bottom',
                            offsetX: 80,
                            offsetY: 18,
                            title: wt('tours.statistics_learning_signals.statistics_overall_metrics.c1_title', 'Как держится ритм'),
                            body: wt('tours.statistics_learning_signals.statistics_overall_metrics.c1_body', 'Карточки показывают точность коротких повторов, а серия - занимались ли вы регулярно. Эти метрики помогают понять, где стоит освежить материал.')
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
                    kicker: wt('tours.statistics_learning_signals.statistics_time_dynamics.kicker', 'Динамика времени'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="statistics-time-dynamics-card"]',
                            placement: 'right',
                            offsetX: 0,
                            offsetY: 80,
                            gap: 28,
                            title: wt('tours.statistics_learning_signals.statistics_time_dynamics.c0_title', 'Ритм по дням'),
                            body: wt('tours.statistics_learning_signals.statistics_time_dynamics.c0_body', 'График показывает, в какие дни было обучение. Смотрите на регулярность, а не только на самый высокий столбик.')
                        },
                        {
                            target: '[data-onboarding-target="statistics-chart-controls"]',
                            placement: 'top',
                            offsetX: 70,
                            offsetY: 18,
                            title: wt('tours.statistics_learning_signals.statistics_time_dynamics.c1_title', 'Переключатели графика'),
                            body: wt('tours.statistics_learning_signals.statistics_time_dynamics.c1_body', 'Здесь можно выбрать, что смотреть: время или активность, а потом сравнить период за 7, 30 или 90 дней.')
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
                    kicker: wt('tours.statistics_learning_signals.statistics_performance_and_complexes.kicker', 'Детальная статистика'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="statistics-performance-card"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -72,
                            gap: 28,
                            title: wt('tours.statistics_learning_signals.statistics_performance_and_complexes.c0_title', 'Производительность'),
                            body: wt('tours.statistics_learning_signals.statistics_performance_and_complexes.c0_body', 'Здесь видно, какие типы задач даются легче или сложнее. Низкий процент подсказывает, что этот формат стоит потренировать.')
                        },
                        {
                            target: '[data-onboarding-target="statistics-recent-complex-card"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 34,
                            gap: 28,
                            title: wt('tours.statistics_learning_signals.statistics_performance_and_complexes.c1_title', 'Последние комплексы'),
                            body: wt('tours.statistics_learning_signals.statistics_performance_and_complexes.c1_body', 'Здесь видны недавние прохождения комплексов. Так проще понять, что закрепилось, а к чему стоит вернуться.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'catalog-discovery-library',
            version: 3,
            referenceCategory: 'find',
            referenceTags: ["каталог","поиск","материалы","библиотека"],
            referenceOrder: 50,
            route: ['/catalog'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 2,
            persistControl: true,
            title: wt('tours.catalog_discovery_library.title', 'Каталог: поиск и отбор материалов'),
            summary: wt('tours.catalog_discovery_library.summary', 'Как найти публикацию, отсортировать выдачу, оценить детали и добавить подходящий материал в свою библиотеку.'),
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
                    kicker: wt('tours.catalog_discovery_library.catalog_search_and_filters.kicker', 'Поиск, фильтры и порядок'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="catalog-search"]',
                            placement: 'top',
                            keepPlacement: true,
                            offsetX: 0,
                            offsetY: 0,
                            gap: 22,
                            title: wt('tours.catalog_discovery_library.catalog_search_and_filters.c0_title', 'Поиск по каталогу'),
                            body: wt('tours.catalog_discovery_library.catalog_search_and_filters.c0_body', 'Введите название, тему или автора. Поиск сужает выдачу без смены раздела: удобно быстро проверить, есть ли готовый материал под текущую задачу.')
                        },
                        {
                            target: '[data-onboarding-target="catalog-filters"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 12,
                            gap: 26,
                            title: wt('tours.catalog_discovery_library.catalog_search_and_filters.c1_title', 'Тип материала'),
                            body: wt('tours.catalog_discovery_library.catalog_search_and_filters.c1_body', 'Фильтры разделяют все публикации, комплексы, теории и уже сохранённые материалы. Это первый грубый отсев перед сортировкой и просмотром карточек.')
                        },
                        {
                            target: '[data-onboarding-target="catalog-sort-toggle"]',
                            placement: 'bottom-end',
                            offsetX: 0,
                            offsetY: 12,
                            arrowOffsetX: 70,
                            gap: 26,
                            title: wt('tours.catalog_discovery_library.catalog_search_and_filters.c2_title', 'Сортировка'),
                            body: wt('tours.catalog_discovery_library.catalog_search_and_filters.c2_body', 'Сортировка меняет порядок карточек: сначала новые, по алфавиту, по типу контента или по объёму. Рядом сводка показывает, сколько публикаций осталось после поиска и фильтров.')
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
                    kicker: wt('tours.catalog_discovery_library.catalog_card_and_detail.kicker', 'Выбор'),
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
                            title: wt('tours.catalog_discovery_library.catalog_card_and_detail.c0_title', 'Карточка и детали'),
                            body: wt('tours.catalog_discovery_library.catalog_card_and_detail.c0_body', 'Карточка даёт быстрый обзор, а панель деталей показывает состав, связанные материалы и помогает решить, стоит ли сохранять публикацию.')
                        },
                        {
                            target: '[data-onboarding-target="catalog-add-action"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 12,
                            gap: 24,
                            title: wt('tours.catalog_discovery_library.catalog_card_and_detail.c1_title', 'Добавить в библиотеку'),
                            body: wt('tours.catalog_discovery_library.catalog_card_and_detail.c1_body', 'Каталог не запускает обучение напрямую. Сначала сохраните материал: комплекс появится в комплексах, а теория - в центре теории.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'theory-center-library',
            version: 1,
            referenceCategory: 'theory',
            referenceTags: ["теория","центр теории","связи","материалы"],
            referenceOrder: 60,
            route: ['/theory-center', '/editor/Theory_Center.html'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 2,
            persistControl: true,
            title: wt('tours.theory_center_library.title', 'Центр теории: библиотека и связи'),
            summary: wt('tours.theory_center_library.summary', 'Как найти теорию, проверить привязки к темам и комплексам и быстро открыть нужный материал.'),
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
                    kicker: wt('tours.theory_center_library.theory_center_find_and_filter.kicker', 'Поиск и срезы'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="theory-summary-grid"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 18,
                            title: wt('tours.theory_center_library.theory_center_find_and_filter.c0_title', 'Быстрые подборки'),
                            body: wt('tours.theory_center_library.theory_center_find_and_filter.c0_body', 'Верхний блок собирает проблемные и полезные срезы: темы без теории, комплексы с одной теорией, подборки и материалы без привязки.')
                        },
                        {
                            target: '[data-onboarding-target="theory-search"]',
                            placement: 'bottom',
                            offsetX: 12,
                            offsetY: 12,
                            gap: 24,
                            title: wt('tours.theory_center_library.theory_center_find_and_filter.c1_title', 'Поиск по центру'),
                            body: wt('tours.theory_center_library.theory_center_find_and_filter.c1_body', 'Поиск работает по названиям тем, комплексов и теорий. Это самый быстрый способ проверить, есть ли уже нужный материал.')
                        },
                        {
                            target: '[data-onboarding-target="theory-scope-filters"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 12,
                            gap: 24,
                            title: wt('tours.theory_center_library.theory_center_find_and_filter.c2_title', 'Разделы и фильтры'),
                            body: wt('tours.theory_center_library.theory_center_find_and_filter.c2_body', 'Переключатели меняют тип выдачи: все теории, темы, комплексы, материалы без привязки и теории только с заголовком.')
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
                    kicker: wt('tours.theory_center_library.theory_center_card_and_actions.kicker', 'Карточка теории'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="theory-selected-row"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 8,
                            gap: 28,
                            title: wt('tours.theory_center_library.theory_center_card_and_actions.c0_title', 'Связи и статус'),
                            body: wt('tours.theory_center_library.theory_center_card_and_actions.c0_body', 'Карточка показывает автора, публикацию в каталоге, связи с темами и комплексами, а также дату обновления.')
                        },
                        {
                            target: '[data-onboarding-target="theory-open-action"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 24,
                            title: wt('tours.theory_center_library.theory_center_card_and_actions.c1_title', 'Открыть материал'),
                            body: wt('tours.theory_center_library.theory_center_card_and_actions.c1_body', 'Кнопка открывает теорию: свои материалы попадают в редактор, а теории других авторов из каталога открываются в режиме просмотра.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'theory-editor-authoring',
            version: 1,
            referenceCategory: 'theory',
            referenceTags: ["редактор теории","материал","изображения","публикация"],
            referenceOrder: 80,
            route: ['/theory-editor', '/editor/Theory_Editor.html'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 3,
            persistControl: true,
            title: wt('tours.theory_editor_authoring.title', 'Редактор теории: создание материала'),
            summary: wt('tours.theory_editor_authoring.summary', 'Как выбрать теорию, оформить текст, добавить изображения, сохранить и подготовить материал к публикации.'),
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
                    kicker: wt('tours.theory_editor_authoring.theory_editor_library_and_title.kicker', 'Выбор материала'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="theory-editor-library-panel"]',
                            placement: 'right',
                            offsetX: 0,
                            offsetY: -24,
                            gap: 26,
                            title: wt('tours.theory_editor_authoring.theory_editor_library_and_title.c0_title', 'Библиотека теорий'),
                            body: wt('tours.theory_editor_authoring.theory_editor_library_and_title.c0_body', 'Слева список ваших теорий. Можно быстро найти материал по названию или ID и переключиться между сохранёнными теориями.')
                        },
                        {
                            target: '[data-onboarding-target="theory-editor-header"]',
                            placement: 'bottom',
                            offsetX: 360,
                            offsetY: 10,
                            gap: 22,
                            title: wt('tours.theory_editor_authoring.theory_editor_library_and_title.c1_title', 'Статусы выбранной теории'),
                            body: wt('tours.theory_editor_authoring.theory_editor_library_and_title.c1_body', 'Верхняя панель относится к теории, выбранной в библиотеке: здесь видны публикация, лимит библиотеки, быстрые переходы, создание новой теории и сохранение.')
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
                    kicker: wt('tours.theory_editor_authoring.theory_editor_body_and_text_tools.kicker', 'Текст теории'),
                    variantBackVariants: ['image-tools'],
                    callouts: [
                        {
                            target: '[data-onboarding-target="theory-editor-toolbar"]',
                            placement: 'left',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 24,
                            title: wt('tours.theory_editor_authoring.theory_editor_body_and_text_tools.c0_title', 'Инструменты текста'),
                            body: wt('tours.theory_editor_authoring.theory_editor_body_and_text_tools.c0_body', 'Пока выбран текст, здесь доступны жирность, курсив, заголовки, списки, выравнивание, цвет и кнопка добавления изображения.')
                        },
                        {
                            target: '[data-onboarding-target="theory-editor-content"]',
                            placement: 'left',
                            offsetX: 0,
                            offsetY: -10,
                            gap: 28,
                            title: wt('tours.theory_editor_authoring.theory_editor_body_and_text_tools.c1_title', 'Текстовое поле'),
                            body: wt('tours.theory_editor_authoring.theory_editor_body_and_text_tools.c1_body', 'В этой области пишется основной материал. В тексте можно смешивать заголовки, списки, пояснения и изображения теории.')
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
                                title: wt('tours.theory_editor_authoring.theory_editor_body_and_text_tools.c2_title', 'Выбранное изображение'),
                                body: wt('tours.theory_editor_authoring.theory_editor_body_and_text_tools.c2_body', 'После клика изображение получает рамку выделения. Теперь изменения из панели инструментов применяются именно к нему.')
                            },
                            {
                                target: '[data-onboarding-target="theory-editor-image-controls"]',
                                placement: 'top',
                                offsetX: 0,
                                offsetY: 0,
                                gap: 24,
                                title: wt('tours.theory_editor_authoring.theory_editor_body_and_text_tools.c3_title', 'Инструменты изображения'),
                                body: wt('tours.theory_editor_authoring.theory_editor_body_and_text_tools.c3_body', 'Здесь можно менять размер, выравнивание, обтекание, поворот и отражение изображения прямо внутри материала.')
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
                    kicker: wt('tours.theory_editor_authoring.theory_editor_save_and_publish.kicker', 'Сохранение'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="theory-editor-save-action"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 14,
                            gap: 24,
                            title: wt('tours.theory_editor_authoring.theory_editor_save_and_publish.c0_title', 'Сохранить'),
                            body: wt('tours.theory_editor_authoring.theory_editor_save_and_publish.c0_body', 'Сохранение обновляет личную версию теории. Если есть несохранённые изменения, кнопка заметно подсвечивается.')
                        },
                        {
                            target: '[data-onboarding-target="theory-editor-publish-action"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 14,
                            gap: 24,
                            title: wt('tours.theory_editor_authoring.theory_editor_save_and_publish.c1_title', 'Публикация'),
                            body: wt('tours.theory_editor_authoring.theory_editor_save_and_publish.c1_body', 'После сохранения можно управлять публикацией: оставить теорию личной, открыть для всех или выдать доступ по коду.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'test-editor-authoring',
            version: 1,
            referenceCategory: 'create',
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
            title: wt('tours.test_editor_authoring.title', 'Редактор теста: вопросы и ответы'),
            summary: wt('tours.test_editor_authoring.summary', 'Как собрать тест: добавить вопросы, написать формулировку, отметить правильные ответы, настроить обратную связь и сохранить.'),
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
                    kicker: wt('tours.test_editor_authoring.test_editor_question_structure.kicker', 'Структура теста'),
                    variantBackVariants: ['import-tools'],
                    variantBackLabel: wt('tours.test_editor_authoring.test_editor_question_structure.variantBackLabel', 'Вернуться к 1/5'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="test-editor-active-question"]',
                            placement: 'right',
                            offsetX: 14,
                            offsetY: 0,
                            gap: 24,
                            variant: 'test-editor-compact',
                            title: wt('tours.test_editor_authoring.test_editor_question_structure.c0_title', 'Список вопросов'),
                            body: wt('tours.test_editor_authoring.test_editor_question_structure.c0_body', 'Слева видны все вопросы теста. Активный вопрос открыт в рабочей области, а индикатор показывает готовность ответа.')
                        },
                        {
                            target: '[data-onboarding-target="test-editor-add-question"], [data-onboarding-target="test-editor-import-export"]',
                            targetAll: true,
                            placement: 'right',
                            offsetX: 14,
                            offsetY: 6,
                            gap: 24,
                            variant: 'test-editor-compact',
                            title: wt('tours.test_editor_authoring.test_editor_question_structure.c1_title', 'Добавление и импорт'),
                            body: wt('tours.test_editor_authoring.test_editor_question_structure.c1_body', 'Новый вопрос добавляется вручную. Импорт открывает окно загрузки вопросов из файла или текста. Экспорт без отдельного окна сразу сохраняет текущее тестовое задание в файл.')
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
                                title: wt('tours.test_editor_authoring.test_editor_question_structure.c2_title', 'Способ импорта'),
                                body: wt('tours.test_editor_authoring.test_editor_question_structure.c2_body', 'Вверху выберите источник: файл с вопросами или текстовую заготовку. Активная вкладка подсвечивает, какой сценарий сейчас открыт.')
                            },
                            {
                                target: '[data-onboarding-target="test-editor-import-parse-panel"], [data-onboarding-target="test-editor-import-choose-file"]',
                                targetAll: true,
                                placement: 'right',
                                offsetX: 20,
                                offsetY: -6,
                                gap: 28,
                                variant: 'test-editor-import-branch',
                                title: wt('tours.test_editor_authoring.test_editor_question_structure.c3_title', 'Проверка данных'),
                                body: wt('tours.test_editor_authoring.test_editor_question_structure.c3_body', 'Здесь показываются выбранный файл, количество найденных вопросов, статус разбора и предпросмотр. Кнопка «Выбрать файл» запускает загрузку.')
                            },
                            {
                                target: '[data-onboarding-target="test-editor-import-preview"], [data-onboarding-target="test-editor-import-mode"], [data-onboarding-target="test-editor-import-modal-actions"]',
                                targetAll: true,
                                placement: 'right',
                                offsetX: 20,
                                offsetY: 4,
                                gap: 28,
                                variant: 'test-editor-import-branch',
                                title: wt('tours.test_editor_authoring.test_editor_question_structure.c4_title', 'Применение к тесту'),
                                body: wt('tours.test_editor_authoring.test_editor_question_structure.c4_body', 'После проверки выберите, добавить вопросы к текущим или заменить тест целиком, затем подтвердите импорт нижней кнопкой.')
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
                    kicker: wt('tours.test_editor_authoring.test_editor_question_body.kicker', 'Формулировка вопроса'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="test-editor-question-text"]',
                            positionTarget: '[data-onboarding-target="test-editor-question-card"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 24,
                            variant: 'test-editor-wide',
                            title: wt('tours.test_editor_authoring.test_editor_question_body.c0_title', 'Текст вопроса'),
                            body: wt('tours.test_editor_authoring.test_editor_question_body.c0_body', 'Здесь пишется сама формулировка. Лучше делать её короткой и проверять один конкретный факт, правило или различие.')
                        },
                        {
                            target: '[data-onboarding-target="test-editor-question-image"]',
                            positionTarget: '[data-onboarding-target="test-editor-question-card"]',
                            placement: 'bottom-end',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 24,
                            variant: 'test-editor-compact',
                            title: wt('tours.test_editor_authoring.test_editor_question_body.c1_title', 'Изображение к вопросу'),
                            body: wt('tours.test_editor_authoring.test_editor_question_body.c1_body', 'К вопросу можно прикрепить до трёх иллюстраций. Они относятся только к текущему вопросу.')
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
                    kicker: wt('tours.test_editor_authoring.test_editor_options.kicker', 'Варианты ответа'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="test-editor-first-option"]',
                            placement: 'top-start',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 76,
                            variant: 'test-editor-wide',
                            title: wt('tours.test_editor_authoring.test_editor_options.c0_title', 'Варианты ответа'),
                            body: wt('tours.test_editor_authoring.test_editor_options.c0_body', 'Каждая строка — отдельный вариант ответа. Вариант может содержать текст, изображение или оба элемента сразу; кнопка справа добавляет изображение именно к этому варианту.')
                        },
                        {
                            target: '[data-onboarding-target="test-editor-correct-toggle"]',
                            placement: 'top-start',
                            offsetX: -120,
                            offsetY: 4,
                            gap: 84,
                            variant: 'test-editor-compact',
                            title: wt('tours.test_editor_authoring.test_editor_options.c1_title', 'Правильный ответ'),
                            body: wt('tours.test_editor_authoring.test_editor_options.c1_body', 'Нажатие на букву варианта делает его правильным или снимает отметку. Если отметить несколько букв, вопрос автоматически становится вопросом с несколькими правильными ответами.')
                        },
                        {
                            target: '[data-onboarding-target="test-editor-add-option"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 8,
                            gap: 20,
                            variant: 'test-editor-compact',
                            title: wt('tours.test_editor_authoring.test_editor_options.c2_title', 'Добавить вариант'),
                            body: wt('tours.test_editor_authoring.test_editor_options.c2_body', 'Эта кнопка добавляет ещё один вариант ответа к текущему вопросу.')
                        },
                        {
                            target: '[data-onboarding-target="test-editor-image-bank"]',
                            placement: 'top-end',
                            offsetX: 22,
                            offsetY: 0,
                            gap: 18,
                            variant: 'test-editor-compact',
                            title: wt('tours.test_editor_authoring.test_editor_options.c3_title', 'Банк изображений'),
                            body: wt('tours.test_editor_authoring.test_editor_options.c3_body', 'Здесь собраны изображения задания. Уже загруженную картинку можно повторно использовать в других вопросах и вариантах.')
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
                    kicker: wt('tours.test_editor_authoring.test_editor_inspector.kicker', 'Инспектор вопроса'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="test-editor-answer-type"]',
                            placement: 'left',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 28,
                            variant: 'test-editor-compact',
                            title: wt('tours.test_editor_authoring.test_editor_inspector.c0_title', 'Тип ответа'),
                            body: wt('tours.test_editor_authoring.test_editor_inspector.c0_body', 'Определяется автоматически: один правильный вариант — одиночный выбор, несколько — множественный.')
                        },
                        {
                            target: '[data-onboarding-target="test-editor-feedback"]',
                            placement: 'left',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 28,
                            variant: 'test-editor-compact',
                            title: wt('tours.test_editor_authoring.test_editor_inspector.c1_title', 'Обратная связь'),
                            body: wt('tours.test_editor_authoring.test_editor_inspector.c1_body', 'Комментарий показывается после ответа и помогает объяснить, почему ответ верный.')
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
                                title: wt('tours.test_editor_authoring.test_editor_inspector.c2_title', 'Тип ответа'),
                                body: wt('tours.test_editor_authoring.test_editor_inspector.c2_body', 'Один правильный вариант — одиночный выбор, несколько — множественный.')
                            },
                            {
                                target: '[data-onboarding-target="test-editor-feedback"]',
                                placement: 'left',
                                offsetX: 8,
                                offsetY: 0,
                                gap: 30,
                                variant: 'test-editor-compact',
                                title: wt('tours.test_editor_authoring.test_editor_inspector.c3_title', 'Обратная связь'),
                                body: wt('tours.test_editor_authoring.test_editor_inspector.c3_body', 'Комментарий показывается после ответа и объясняет, почему ответ верный.')
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
                    kicker: wt('tours.test_editor_authoring.test_editor_save.kicker', 'Сохранение'),
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
                            title: wt('tours.test_editor_authoring.test_editor_save.c0_title', 'Отмена и повтор'),
                            body: wt('tours.test_editor_authoring.test_editor_save.c0_body', 'Кнопки работают с историей редактора: можно откатить добавленные элементы и вернуть отменённое действие.')
                        },
                        {
                            target: '[data-onboarding-target="test-editor-save-action"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 14,
                            gap: 24,
                            variant: 'test-editor-save-row',
                            title: wt('tours.test_editor_authoring.test_editor_save.c1_title', 'Сохранить тест'),
                            body: wt('tours.test_editor_authoring.test_editor_save.c1_body', 'Перед сохранением редактор проверит, что есть текст вопроса, минимум два варианта и хотя бы один правильный ответ.')
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
                            title: wt('tours.test_editor_authoring.test_editor_save.c2_title', 'Статус изменений'),
                            body: wt('tours.test_editor_authoring.test_editor_save.c2_body', 'Индикатор показывает, сохранён ли тест или есть несохранённые правки.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'open-answer-authoring',
            version: 1,
            referenceCategory: 'create',
            referenceTags: ["открытый ответ","эталон","ключевые слова","редактор заданий"],
            referenceOrder: 110,
            route: ['/editor/Open%20Answer%20Editor%20Textual%20Reasoning.html'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 5,
            persistControl: true,
            title: wt('tours.open_answer_authoring.title', 'Редактор открытого ответа'),
            summary: wt('tours.open_answer_authoring.summary', 'Как собрать задание со свободным ответом: вопрос, эталон, ключевые слова, подсказка, требования и изображения.'),
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
                    kicker: wt('tours.open_answer_authoring.open_answer_header_save.kicker', 'Шапка редактора'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="open-answer-title"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 24,
                            variant: 'open-answer-compact',
                            title: wt('tours.open_answer_authoring.open_answer_header_save.c0_title', 'Название задания'),
                            body: wt('tours.open_answer_authoring.open_answer_header_save.c0_body', 'В шапке видно, какое задание открыто и в каком редакторе вы работаете.')
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
                            title: wt('tours.open_answer_authoring.open_answer_header_save.c1_title', 'Статус изменений'),
                            body: wt('tours.open_answer_authoring.open_answer_header_save.c1_body', 'Индикатор показывает, сохранены ли текущие правки.')
                        },
                        {
                            target: '[data-onboarding-target="open-answer-save-action"]',
                            placement: 'bottom-end',
                            offsetX: 0,
                            offsetY: 14,
                            gap: 24,
                            variant: 'open-answer-compact',
                            title: wt('tours.open_answer_authoring.open_answer_header_save.c2_title', 'Сохранить'),
                            body: wt('tours.open_answer_authoring.open_answer_header_save.c2_body', 'Перед сохранением редактор проверит вопрос, эталонный ответ и выбранные ключевые слова.')
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
                    kicker: wt('tours.open_answer_authoring.open_answer_question.kicker', 'Формулировка'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="open-answer-question-block"]',
                            placement: 'bottom-start',
                            offsetX: 18,
                            offsetY: 16,
                            gap: 22,
                            variant: 'open-answer-wide',
                            title: wt('tours.open_answer_authoring.open_answer_question.c0_title', 'Вопрос'),
                            body: wt('tours.open_answer_authoring.open_answer_question.c0_body', 'Здесь формулируется задача для ответа своими словами. Делайте вопрос так, чтобы в эталоне можно было выделить один или несколько обязательных смысловых признаков: именно выбранные ключевые слова затем проверяются в ответе.')
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
                    kicker: wt('tours.open_answer_authoring.open_answer_reference.kicker', 'Эталон'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="open-answer-reference-block"]',
                            placement: 'bottom-start',
                            offsetX: 18,
                            offsetY: 16,
                            gap: 22,
                            variant: 'open-answer-wide',
                            title: wt('tours.open_answer_authoring.open_answer_reference.c0_title', 'Эталонный ответ'),
                            body: wt('tours.open_answer_authoring.open_answer_reference.c0_body', 'Это правильный смысловой ответ. По нему редактор подготавливает слова и фразы, которые затем можно отметить как обязательные.')
                        },
                        {
                            target: '[data-onboarding-target="open-answer-split-keywords"]',
                            placement: 'bottom-end',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 22,
                            variant: 'open-answer-compact',
                            title: wt('tours.open_answer_authoring.open_answer_reference.c1_title', 'Разбить на ключевые слова'),
                            body: wt('tours.open_answer_authoring.open_answer_reference.c1_body', 'Кнопка извлекает кандидаты из эталонного ответа. После этого выберите, какие из них действительно важны для проверки.')
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
                    kicker: wt('tours.open_answer_authoring.open_answer_keywords_hint.kicker', 'Проверка ответа'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="open-answer-keywords-container"]',
                            placement: 'top-start',
                            offsetX: 0,
                            offsetY: 12,
                            gap: 26,
                            variant: 'open-answer-wide',
                            title: wt('tours.open_answer_authoring.open_answer_keywords_hint.c0_title', 'Ключевые слова'),
                            body: wt('tours.open_answer_authoring.open_answer_keywords_hint.c0_body', 'Нажатие на слово включает или выключает его как обязательное. Счётчик показывает, сколько признаков ответа выбрано для проверки.')
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
                            title: wt('tours.open_answer_authoring.open_answer_keywords_hint.c1_title', 'Подсказка'),
                            body: wt('tours.open_answer_authoring.open_answer_keywords_hint.c1_body', 'Подсказка необязательна. Она помогает пользователю вспомнить направление ответа, не раскрывая полностью эталон.')
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
                    kicker: wt('tours.open_answer_authoring.open_answer_sidebar.kicker', 'Дополнительные условия'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="open-answer-requirements"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -8,
                            gap: 30,
                            variant: 'open-answer-compact',
                            title: wt('tours.open_answer_authoring.open_answer_sidebar.c0_title', 'Требования к ответу'),
                            body: wt('tours.open_answer_authoring.open_answer_sidebar.c0_body', 'Можно требовать порядок ключевых слов и ограничить максимальную длину ответа. Если лимит задан, в тренажёре появится ограничение ввода.')
                        },
                        {
                            target: '[data-onboarding-target="open-answer-images-panel"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 8,
                            gap: 30,
                            variant: 'open-answer-compact',
                            title: wt('tours.open_answer_authoring.open_answer_sidebar.c1_title', 'Изображения'),
                            body: wt('tours.open_answer_authoring.open_answer_sidebar.c1_body', 'К открытому ответу можно прикрепить до трёх изображений. Они сохраняются вместе с заданием и помогают задать контекст.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'click-editor-authoring',
            version: 1,
            referenceCategory: 'create',
            referenceTags: ["click","клик","области","изображение"],
            referenceOrder: 120,
            route: ['/editor/Point_Annotation.html', '/Editor/Point_Annotation.html'],
            autoStart: false,
            autoStartDelay: 900,
            totalStates: 6,
            persistControl: true,
            title: wt('tours.click_editor_authoring.title', 'Редактор Click'),
            summary: wt('tours.click_editor_authoring.summary', 'Как собрать задание, где пользователь кликом отмечает нужные области на изображении.'),
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
                    kicker: wt('tours.click_editor_authoring.click_header_save.kicker', 'Шапка редактора'),
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
                            title: wt('tours.click_editor_authoring.click_header_save.c0_title', 'Название задания'),
                            body: wt('tours.click_editor_authoring.click_header_save.c0_body', 'В шапке видно, какое Click-задание открыто для редактирования.')
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
                            title: wt('tours.click_editor_authoring.click_header_save.c1_title', 'Режим задания'),
                            body: wt('tours.click_editor_authoring.click_header_save.c1_body', 'Режим Click используется для разметки областей на изображении. Режим ошибок открывает отдельный сценарий проверки текста.')
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
                            title: wt('tours.click_editor_authoring.click_header_save.c2_title', 'Сохранить'),
                            body: wt('tours.click_editor_authoring.click_header_save.c2_body', 'Перед сохранением редактор проверит изображение, формулировку и количество нужных контуров.')
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
                    kicker: wt('tours.click_editor_authoring.click_prompt_rules.kicker', 'Условие задания'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-prompt"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 4,
                            gap: 30,
                            variant: 'click-wide',
                            title: wt('tours.click_editor_authoring.click_prompt_rules.c0_title', 'Формулировка'),
                            body: wt('tours.click_editor_authoring.click_prompt_rules.c0_body', 'Здесь пишется инструкция для пользователя: что именно нужно найти и отметить на изображении.')
                        },
                        {
                            target: '[data-onboarding-target="click-required-correct"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 8,
                            gap: 30,
                            variant: 'click-compact',
                            title: wt('tours.click_editor_authoring.click_prompt_rules.c1_title', 'Критерий успеха'),
                            body: wt('tours.click_editor_authoring.click_prompt_rules.c1_body', 'Поле задаёт, сколько правильных областей пользователь должен отметить, чтобы ответ был засчитан.')
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
                    kicker: wt('tours.click_editor_authoring.click_image_workspace.kicker', 'Рабочая область'),
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
                            title: wt('tours.click_editor_authoring.click_image_workspace.c0_title', 'Изображение'),
                            body: wt('tours.click_editor_authoring.click_image_workspace.c0_body', 'На холсте размещается изображение, по которому пользователь будет выполнять клик-задание.')
                        },
                        {
                            target: '[data-onboarding-target="click-change-image"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 22,
                            keepPlacement: true,
                            variant: 'click-narrow',
                            title: wt('tours.click_editor_authoring.click_image_workspace.c1_title', 'Сменить / добавить изображение'),
                            body: wt('tours.click_editor_authoring.click_image_workspace.c1_body', 'Этой кнопкой добавляют первую картинку задания или заменяют текущую.')
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
                            title: wt('tours.click_editor_authoring.click_image_workspace.c2_title', 'Масштаб'),
                            body: wt('tours.click_editor_authoring.click_image_workspace.c2_body', 'Плюс и минус помогают приблизить картинку, чтобы аккуратно поставить контур.')
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
                    kicker: wt('tours.click_editor_authoring.click_drawing_tools.kicker', 'Инструменты разметки'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-tool-choice"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 22,
                            variant: 'click-compact',
                            title: wt('tours.click_editor_authoring.click_drawing_tools.c0_title', 'Способ разметки'),
                            body: wt('tours.click_editor_authoring.click_drawing_tools.c0_body', 'Лассо строит контур по точкам, свободное рисование позволяет провести линию рукой.')
                        },
                        {
                            target: '[data-onboarding-target="click-polygon-actions"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 22,
                            variant: 'click-wide',
                            title: wt('tours.click_editor_authoring.click_drawing_tools.c1_title', 'Работа с контуром'),
                            body: wt('tours.click_editor_authoring.click_drawing_tools.c1_body', 'Текущий контур завершают кнопкой или двойным кликом левой кнопкой мыши. Здесь же удаляют последнюю точку или отменяют незавершённую разметку.')
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
                    kicker: wt('tours.click_editor_authoring.click_annotations_manage.kicker', 'Сопровождение задания'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-annotations-panel"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -180,
                            gap: 30,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: wt('tours.click_editor_authoring.click_annotations_manage.c0_title', 'Список контуров'),
                            body: wt('tours.click_editor_authoring.click_annotations_manage.c0_body', 'После разметки здесь появляются все области. Контуры можно переименовывать прямо в списке; кнопка «Подсветить» временно выделяет область на изображении, а «Подпись» управляет отображением её названия.')
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
                            title: wt('tours.click_editor_authoring.click_annotations_manage.c1_title', 'Редактирование точек'),
                            body: wt('tours.click_editor_authoring.click_annotations_manage.c1_body', 'При выборе контура на изображении появляются его точки, и каждую точку можно сдвинуть, чтобы аккуратно поправить границу.')
                        },
                        {
                            target: '[data-onboarding-target="click-additional-materials"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 8,
                            gap: 30,
                            variant: 'click-compact',
                            title: wt('tours.click_editor_authoring.click_annotations_manage.c2_title', 'Дополнительные материалы'),
                            body: wt('tours.click_editor_authoring.click_annotations_manage.c2_body', 'Можно добавить текст или изображения, если для Click-задания нужен контекст.')
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
                    kicker: wt('tours.click_editor_authoring.click_difficulty_levels.kicker', 'Финальная настройка'),
                    callouts: [
                        {
                            target: '#editor-difficulty-authoring',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -300,
                            gap: 30,
                            skipOverlapPush: true,
                            variant: 'click-compact',
                            title: wt('tours.click_editor_authoring.click_difficulty_levels.c0_title', 'Уровни сложности'),
                            body: wt('tours.click_editor_authoring.click_difficulty_levels.c0_body', 'В обычном комплексе 3 итерации. Уровни помогают разложить одно задание по этой траектории: от простого шага в начале к более сложному в конце.')
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
                            title: wt('tours.click_editor_authoring.click_difficulty_levels.c1_title', 'Все или выборочно'),
                            body: wt('tours.click_editor_authoring.click_difficulty_levels.c1_body', '«Все уровни типа» оставляет задание во всех итерациях Click. «Только выбранные» ограничивает, где оно появится: например, только в ранней тренировке или только в финальной проверке.')
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
                            title: wt('tours.click_editor_authoring.click_difficulty_levels.c2_title', 'Что делает пользователь'),
                            body: wt('tours.click_editor_authoring.click_difficulty_levels.c2_body', 'L1: нажать готовую область. L2: выбрать название найденной области. L3: обвести область и ввести название.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'draw-editor-authoring',
            version: 1,
            referenceCategory: 'create',
            referenceTags: ["рисование","контур","области","изображение"],
            referenceOrder: 130,
            route: ['/editor/Point_Annotation.html', '/Editor/Point_Annotation.html'],
            autoStart: false,
            autoStartDelay: 900,
            totalStates: 6,
            persistControl: true,
            title: wt('tours.draw_editor_authoring.title', 'Редактор «Рисование»'),
            summary: wt('tours.draw_editor_authoring.summary', 'Как собрать задание, где пользователь сам обводит области на изображении.'),
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
                    kicker: wt('tours.draw_editor_authoring.draw_header_save.kicker', 'Шапка редактора'),
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
                            title: wt('tours.draw_editor_authoring.draw_header_save.c0_title', 'Название задания'),
                            body: wt('tours.draw_editor_authoring.draw_header_save.c0_body', 'Здесь видно, какое задание «Рисование» открыто для редактирования.')
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
                            title: wt('tours.draw_editor_authoring.draw_header_save.c1_title', 'Сохранить'),
                            body: wt('tours.draw_editor_authoring.draw_header_save.c1_body', 'Перед сохранением редактор проверит изображение, формулировку, контуры и подписи областей.')
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
                    kicker: wt('tours.draw_editor_authoring.draw_prompt_rules.kicker', 'Условие задания'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-prompt"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 4,
                            gap: 30,
                            variant: 'click-wide',
                            title: wt('tours.draw_editor_authoring.draw_prompt_rules.c0_title', 'Формулировка'),
                            body: wt('tours.draw_editor_authoring.draw_prompt_rules.c0_body', 'Напишите, что пользователь должен обвести. Если подпись нужна только на отдельном уровне, укажите это отдельно, а не как обязательное действие для всех.')
                        },
                        {
                            target: '[data-onboarding-target="click-required-correct"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 8,
                            gap: 30,
                            variant: 'click-compact',
                            title: wt('tours.draw_editor_authoring.draw_prompt_rules.c1_title', 'Критерий успеха'),
                            body: wt('tours.draw_editor_authoring.draw_prompt_rules.c1_body', 'Поле задаёт, сколько правильно размеченных областей нужно для зачёта.')
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
                    kicker: wt('tours.draw_editor_authoring.draw_image_workspace.kicker', 'Рабочая область'),
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
                            title: wt('tours.draw_editor_authoring.draw_image_workspace.c0_title', 'Изображение'),
                            body: wt('tours.draw_editor_authoring.draw_image_workspace.c0_body', 'На этом холсте пользователь будет обводить нужные области. Чем чище изображение, тем точнее получится разметка.')
                        },
                        {
                            target: '[data-onboarding-target="click-change-image"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 22,
                            keepPlacement: true,
                            variant: 'click-narrow',
                            title: wt('tours.draw_editor_authoring.draw_image_workspace.c1_title', 'Сменить изображение'),
                            body: wt('tours.draw_editor_authoring.draw_image_workspace.c1_body', 'Этой кнопкой добавляют основу задания или заменяют текущую картинку.')
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
                            title: wt('tours.draw_editor_authoring.draw_image_workspace.c2_title', 'Масштаб'),
                            body: wt('tours.draw_editor_authoring.draw_image_workspace.c2_body', 'Приближайте изображение, чтобы аккуратно попасть в границы области.')
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
                    kicker: wt('tours.draw_editor_authoring.draw_tools.kicker', 'Инструменты рисования'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-tool-choice"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 22,
                            variant: 'click-compact',
                            title: wt('tours.draw_editor_authoring.draw_tools.c0_title', 'Способ обведения'),
                            body: wt('tours.draw_editor_authoring.draw_tools.c0_body', 'Прямолинейное лассо ставит точки по границе. Свободное рисование ведёт контур движением мыши.')
                        },
                        {
                            target: '[data-onboarding-target="click-polygon-actions"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 22,
                            variant: 'click-wide',
                            title: wt('tours.draw_editor_authoring.draw_tools.c1_title', 'Работа с контуром'),
                            body: wt('tours.draw_editor_authoring.draw_tools.c1_body', 'Контур можно завершить, удалить последнюю точку или отменить незавершённое рисование.')
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
                    kicker: wt('tours.draw_editor_authoring.draw_regions_manage.kicker', 'Области и подписи'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-annotations-panel"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -180,
                            gap: 30,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: wt('tours.draw_editor_authoring.draw_regions_manage.c0_title', 'Список областей'),
                            body: wt('tours.draw_editor_authoring.draw_regions_manage.c0_body', 'Каждый нарисованный контур попадает сюда. Названия можно править прямо в списке.')
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
                            title: wt('tours.draw_editor_authoring.draw_regions_manage.c1_title', 'Редактирование границы'),
                            body: wt('tours.draw_editor_authoring.draw_regions_manage.c1_body', 'Выберите область на изображении: появятся точки контура, которые можно сдвинуть для более точной границы.')
                        },
                        {
                            target: '[data-onboarding-target="click-additional-materials"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 8,
                            gap: 30,
                            variant: 'click-compact',
                            title: wt('tours.draw_editor_authoring.draw_regions_manage.c2_title', 'Дополнительные материалы'),
                            body: wt('tours.draw_editor_authoring.draw_regions_manage.c2_body', 'Здесь можно оставить контекст для автора: текст или изображение-подсказку.')
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
                    kicker: wt('tours.draw_editor_authoring.draw_difficulty_levels.kicker', 'Финальная настройка'),
                    callouts: [
                        {
                            target: '#editor-difficulty-authoring',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -230,
                            gap: 30,
                            skipOverlapPush: true,
                            variant: 'click-compact',
                            title: wt('tours.draw_editor_authoring.draw_difficulty_levels.c0_title', 'Уровни сложности'),
                            body: wt('tours.draw_editor_authoring.draw_difficulty_levels.c0_body', 'В обычном комплексе 3 итерации. Для рисования уровни помогают выбрать, где появится задание: в тренировке границ или в проверке с подписью.')
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
                            title: wt('tours.draw_editor_authoring.draw_difficulty_levels.c1_title', 'Все или выборочно'),
                            body: wt('tours.draw_editor_authoring.draw_difficulty_levels.c1_body', 'Оставьте все уровни, если задание подходит для любой итерации рисования. Выберите отдельные уровни, если оно нужно только для обведения или только для обведения с названием.')
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
                            title: wt('tours.draw_editor_authoring.draw_difficulty_levels.c2_title', 'Что делает пользователь'),
                            body: wt('tours.draw_editor_authoring.draw_difficulty_levels.c2_body', 'L1: обвести нужную область. L2: обвести область и подписать её.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'click-editor-errors-authoring',
            version: 1,
            referenceCategory: 'create',
            referenceTags: ["click","ошибки","текст","референс"],
            referenceOrder: 140,
            route: ['/editor/Point_Annotation.html', '/Editor/Point_Annotation.html'],
            autoStart: false,
            totalStates: 4,
            persistControl: true,
            returnTourId: 'click-editor-authoring',
            returnLabel: wt('tours.click_editor_errors_authoring.returnLabel', 'К Click'),
            title: wt('tours.click_editor_errors_authoring.title', 'Режим ошибок Click'),
            summary: wt('tours.click_editor_errors_authoring.summary', 'Как настроить Click-задание, где пользователь ищет ошибочные фрагменты внутри текста.'),
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
                            label: wt('tours.click_editor_errors_authoring.click_errors_overview.c0_label', 'Перейти к обучению режима «Тексты»'),
                            placement: 'right',
                            gap: 8,
                            offsetX: 0,
                            offsetY: 0
                        }
                    ],
                    kicker: wt('tours.click_editor_errors_authoring.click_errors_overview.kicker', 'Режим ошибок'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-errors-mode-button"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 24,
                            variant: 'click-compact',
                            title: wt('tours.click_editor_errors_authoring.click_errors_overview.c1_title', 'Режим ошибок'),
                            body: wt('tours.click_editor_errors_authoring.click_errors_overview.c1_body', 'Этот сценарий превращает Click-редактор в задание на поиск ошибок в тексте.')
                        },
                        {
                            target: '[data-onboarding-target="click-errors-kind-switch"]',
                            placement: 'bottom',
                            offsetX: 160,
                            offsetY: 18,
                            gap: 24,
                            variant: 'click-wide',
                            title: wt('tours.click_editor_errors_authoring.click_errors_overview.c2_title', 'Слова и тексты'),
                            body: wt('tours.click_editor_errors_authoring.click_errors_overview.c2_body', 'Сначала разберём режим «Слова»: пользователь ищет ошибочные фрагменты внутри одного текста. К режиму «Тексты» можно перейти после этого блока.')
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
                    kicker: wt('tours.click_editor_errors_authoring.click_errors_words_workflow.kicker', 'Слова'),
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
                            title: wt('tours.click_editor_errors_authoring.click_errors_words_workflow.c0_title', 'Основной текст и референс'),
                            body: wt('tours.click_editor_errors_authoring.click_errors_words_workflow.c0_body', 'В «Основном тексте» размечаются ошибки. Во вкладке «Референс» хранится эталон или подсказочные фрагменты.')
                        },
                        {
                            target: '[data-onboarding-target="click-errors-text-card"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 18,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: wt('tours.click_editor_errors_authoring.click_errors_words_workflow.c1_title', 'Текст с ошибками'),
                            body: wt('tours.click_editor_errors_authoring.click_errors_words_workflow.c1_body', 'Здесь вводится текст, где пользователь должен найти ошибочные фрагменты.')
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
                            title: wt('tours.click_editor_errors_authoring.click_errors_words_workflow.c2_title', 'Отметить ошибку'),
                            body: wt('tours.click_editor_errors_authoring.click_errors_words_workflow.c2_body', 'Выделите фрагмент текста и нажмите кнопку, чтобы сохранить его как ошибку.')
                        },
                        {
                            target: '[data-onboarding-target="click-errors-span-list"]',
                            placement: 'bottom-end',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 18,
                            skipOverlapPush: true,
                            variant: 'click-wide',
                            title: wt('tours.click_editor_errors_authoring.click_errors_words_workflow.c3_title', 'Список ошибок'),
                            body: wt('tours.click_editor_errors_authoring.click_errors_words_workflow.c3_body', 'После отметки фрагменты попадают сюда. В списке видно каждую найденную ошибку, её подпись и действия для перехода или удаления.')
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
                    kicker: wt('tours.click_editor_errors_authoring.click_errors_reference.kicker', 'Референс'),
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
                            title: wt('tours.click_editor_errors_authoring.click_errors_reference.c0_title', 'Референс'),
                            body: wt('tours.click_editor_errors_authoring.click_errors_reference.c0_body', 'Референс хранит эталонный текст и важные фрагменты. Его можно заполнить вручную или скопировать из основного текста, затем отметить опорные места.')
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
                    kicker: wt('tours.click_editor_errors_authoring.click_errors_rules_instruction.kicker', 'Проверка и инструкция'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="click-errors-threshold"]',
                            placement: 'top-end',
                            offsetX: -120,
                            offsetY: 12,
                            gap: 24,
                            variant: 'click-wide',
                            title: wt('tours.click_editor_errors_authoring.click_errors_rules_instruction.c0_title', 'Условие прохождения'),
                            body: wt('tours.click_editor_errors_authoring.click_errors_rules_instruction.c0_body', 'Можно требовать найти все ошибки или указать минимальное количество для зачёта.')
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
                            title: wt('tours.click_editor_errors_authoring.click_errors_rules_instruction.c1_title', 'Инструкция'),
                            body: wt('tours.click_editor_errors_authoring.click_errors_rules_instruction.c1_body', 'Инструкция задаёт текст задания для пользователя. Если оставить её пустой, редактор подставит стандартную формулировку для поиска ошибок.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'click-editor-errors-texts-authoring',
            version: 1,
            referenceCategory: 'create',
            referenceTags: ["click","тексты","варианты","ошибки"],
            referenceOrder: 150,
            route: ['/editor/Point_Annotation.html', '/Editor/Point_Annotation.html'],
            autoStart: false,
            totalStates: 2,
            persistControl: true,
            returnTourId: 'click-editor-authoring',
            returnLabel: wt('tours.click_editor_errors_texts_authoring.returnLabel', 'К Click'),
            title: wt('tours.click_editor_errors_texts_authoring.title', 'Режим «Тексты» Click'),
            summary: wt('tours.click_editor_errors_texts_authoring.summary', 'Как настроить Click-задание, где пользователь выбирает правильный текст из вариантов.'),
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
                    kicker: wt('tours.click_editor_errors_texts_authoring.click_errors_texts_mode.kicker', 'Режим «Тексты»'),
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
                            title: wt('tours.click_editor_errors_texts_authoring.click_errors_texts_mode.c0_title', 'Варианты текстов'),
                            body: wt('tours.click_editor_errors_texts_authoring.click_errors_texts_mode.c0_body', 'После переключения в «Тексты» создаются варианты текста. Один вариант отмечается правильным, остальные остаются ошибочными.')
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
                            title: wt('tours.click_editor_errors_texts_authoring.click_errors_texts_mode.c1_title', 'Добавить вариант'),
                            body: wt('tours.click_editor_errors_texts_authoring.click_errors_texts_mode.c1_body', 'Нажмите, чтобы добавить ещё один вариант текста.')
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
                    kicker: wt('tours.click_editor_errors_texts_authoring.click_errors_texts_instruction.kicker', 'Инструкция для выбора'),
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
                            title: wt('tours.click_editor_errors_texts_authoring.click_errors_texts_instruction.c0_title', 'Инструкция для выбора'),
                            body: wt('tours.click_editor_errors_texts_authoring.click_errors_texts_instruction.c0_body', 'Эта инструкция объясняет пользователю, как выбрать верный текст. Если оставить её пустой, редактор подставит стандартную формулировку.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'sequence-editor-authoring',
            version: 1,
            referenceCategory: 'create',
            referenceTags: ["последовательность","уровни","шаги","порядок"],
            referenceOrder: 160,
            route: ['/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 5,
            persistControl: true,
            title: wt('tours.sequence_editor_authoring.title', 'Редактор последовательности'),
            summary: wt('tours.sequence_editor_authoring.summary', 'Как собрать задание, где элементы раскладываются по уровням и при необходимости упорядочиваются.'),
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
                    kicker: wt('tours.sequence_editor_authoring.sequence_header_save.kicker', 'Шапка редактора'),
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
                            title: wt('tours.sequence_editor_authoring.sequence_header_save.c0_title', 'Название задания'),
                            body: wt('tours.sequence_editor_authoring.sequence_header_save.c0_body', 'В шапке видно, какая последовательность открыта для редактирования.')
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
                            title: wt('tours.sequence_editor_authoring.sequence_header_save.c1_title', 'Отмена и повтор'),
                            body: wt('tours.sequence_editor_authoring.sequence_header_save.c1_body', 'Кнопки помогают откатить правки или вернуть отменённое действие при работе с уровнями и шагами.')
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
                            title: wt('tours.sequence_editor_authoring.sequence_header_save.c2_title', 'Сохранить'),
                            body: wt('tours.sequence_editor_authoring.sequence_header_save.c2_body', 'Перед сохранением редактор проверит текст задания, уровни и минимум два заполненных шага.')
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
                    kicker: wt('tours.sequence_editor_authoring.sequence_prompt.kicker', 'Формулировка'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="sequence-prompt-block"]',
                            placement: 'bottom-start',
                            offsetX: 18,
                            offsetY: 16,
                            gap: 22,
                            variant: 'open-answer-wide',
                            title: wt('tours.sequence_editor_authoring.sequence_prompt.c0_title', 'Текст задания'),
                            body: wt('tours.sequence_editor_authoring.sequence_prompt.c0_body', 'Здесь описывается, что пользователь должен собрать: процесс, этапы, классификацию или порядок действий.')
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
                    kicker: wt('tours.sequence_editor_authoring.sequence_levels.kicker', 'Уровни'),
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
                            title: wt('tours.sequence_editor_authoring.sequence_levels.c0_title', 'Название уровня'),
                            body: wt('tours.sequence_editor_authoring.sequence_levels.c0_body', 'Уровень задаёт группу или этап. В тренажёре пользователь раскладывает элементы по этим уровням.')
                        },
                        {
                            target: '[data-onboarding-target="sequence-add-level"]',
                            placement: 'top-end',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 18,
                            skipOverlapPush: true,
                            variant: 'sequence-narrow',
                            title: wt('tours.sequence_editor_authoring.sequence_levels.c1_title', 'Добавить уровень'),
                            body: wt('tours.sequence_editor_authoring.sequence_levels.c1_body', 'Кнопка создаёт ещё одну группу для элементов. Уровней может быть несколько, если задача требует классификации или этапов.')
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
                    kicker: wt('tours.sequence_editor_authoring.sequence_steps.kicker', 'Шаги'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="sequence-first-step"]',
                            placement: 'top',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 20,
                            variant: 'open-answer-wide',
                            title: wt('tours.sequence_editor_authoring.sequence_steps.c0_title', 'Элемент последовательности'),
                            body: wt('tours.sequence_editor_authoring.sequence_steps.c0_body', 'Каждая карточка — отдельный шаг. Текст карточки сохраняется как элемент, который пользователь будет размещать в ответе.')
                        },
                        {
                            target: '[data-onboarding-target="sequence-first-step-actions"]',
                            placement: 'bottom-start',
                            offsetX: 0,
                            offsetY: 18,
                            gap: 26,
                            variant: 'open-answer-compact',
                            title: wt('tours.sequence_editor_authoring.sequence_steps.c1_title', 'Порядок внутри уровня'),
                            body: wt('tours.sequence_editor_authoring.sequence_steps.c1_body', 'Кнопки перемещают шаги влево и вправо. Если порядок внутри уровня важен, именно эта последовательность будет проверяться.')
                        },
                        {
                            target: '[data-onboarding-target="sequence-first-level-add-step"]',
                            placement: 'right',
                            offsetX: 0,
                            offsetY: 0,
                            gap: 22,
                            variant: 'open-answer-compact',
                            title: wt('tours.sequence_editor_authoring.sequence_steps.c2_title', 'Добавить шаг'),
                            body: wt('tours.sequence_editor_authoring.sequence_steps.c2_body', 'Плюс добавляет новый элемент в текущий уровень. Для сохранения нужно минимум два заполненных элемента.')
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
                    kicker: wt('tours.sequence_editor_authoring.sequence_sidebar_settings.kicker', 'Проверка'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="sequence-logic-info"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -4,
                            gap: 30,
                            variant: 'open-answer-compact',
                            title: wt('tours.sequence_editor_authoring.sequence_sidebar_settings.c0_title', 'Логика проверки'),
                            body: wt('tours.sequence_editor_authoring.sequence_sidebar_settings.c0_body', 'Ответ оценивается по тому, попали ли элементы в нужные уровни и соблюдён ли включённый порядок.')
                        },
                        {
                            target: '[data-onboarding-target="sequence-settings-block"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 18,
                            gap: 30,
                            variant: 'open-answer-wide',
                            title: wt('tours.sequence_editor_authoring.sequence_sidebar_settings.c1_title', 'Настройки порядка'),
                            body: wt('tours.sequence_editor_authoring.sequence_sidebar_settings.c1_body', 'Можно отдельно включить проверку порядка шагов внутри уровня и порядка самих уровней. Подсказка ниже сразу объясняет выбранную комбинацию.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'image-labeling-authoring',
            version: 1,
            referenceCategory: 'create',
            referenceTags: ["подписи","рисунок","изображение","области","прямоугольники","разметка"],
            referenceOrder: 125,
            route: ['/editor/Image%20Labeling%20Editor.html', '/editor/Image Labeling Editor.html', '/Editor/Image%20Labeling%20Editor.html', '/Editor/Image Labeling Editor.html'],
            autoStart: false,
            autoStartDelay: 900,
            totalStates: 5,
            persistControl: true,
            title: wt('tours.image_labeling_authoring.title', 'Редактор «Подписи на рисунке»'),
            summary: wt('tours.image_labeling_authoring.summary', 'Как загрузить изображение, разметить прямоугольные области, подписать их и настроить задание.'),
            steps: [
                {
                    id: 'image-labeling-header-step',
                    targets: [
                        '[data-onboarding-target="image-labeling-header"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="image-labeling-save-btn"]',
                    scrollY: 0,
                    kicker: wt('tours.image_labeling_authoring.header_step.kicker', 'Шапка редактора'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="image-labeling-title"]',
                            positionTarget: '[data-onboarding-target="image-labeling-header"]',
                            rowGroup: 'il-header-row',
                            placement: 'bottom',
                            rowInset: 24,
                            offsetX: 0,
                            offsetY: 14,
                            gap: 22,
                            hideArrow: true,
                            extraArrows: [
                                {
                                    target: '[data-onboarding-target="image-labeling-title"]',
                                    placement: 'diagonal',
                                    targetAnchorX: 'center',
                                    targetAnchorY: 'bottom',
                                    startY: 8
                                }
                            ],
                            variant: 'click-header-row',
                            title: wt('tours.image_labeling_authoring.header_step.c0_title', 'Название задания'),
                            body: wt('tours.image_labeling_authoring.header_step.c0_body', 'Здесь видно, какое задание «Подписи на рисунке» открыто для редактирования.')
                        },
                        {
                            target: '[data-onboarding-target="image-labeling-save-status"]',
                            positionTarget: '[data-onboarding-target="image-labeling-header"]',
                            rowGroup: 'il-header-row',
                            placement: 'bottom',
                            rowInset: 24,
                            offsetX: 0,
                            offsetY: 14,
                            gap: 22,
                            variant: 'click-header-row',
                            title: wt('tours.image_labeling_authoring.header_step.c1_title', 'Статус сохранения'),
                            body: wt('tours.image_labeling_authoring.header_step.c1_body', 'Индикатор показывает, сохранено задание или есть несохранённые изменения.')
                        },
                        {
                            target: '[data-onboarding-target="image-labeling-save-btn"]',
                            positionTarget: '[data-onboarding-target="image-labeling-header"]',
                            rowGroup: 'il-header-row',
                            placement: 'bottom',
                            rowInset: 24,
                            offsetX: 0,
                            offsetY: 14,
                            gap: 22,
                            variant: 'click-header-row',
                            title: wt('tours.image_labeling_authoring.header_step.c2_title', 'Сохранить'),
                            body: wt('tours.image_labeling_authoring.header_step.c2_body', 'Перед сохранением редактор проверит наличие изображения, формулировку и хотя бы одну размеченную область с подписью.')
                        }
                    ]
                },
                {
                    id: 'image-labeling-upload-step',
                    targets: [
                        '[data-onboarding-target="image-labeling-workspace"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="image-labeling-dropzone"]',
                    skipAutoScroll: true,
                    kicker: wt('tours.image_labeling_authoring.upload_step.kicker', 'Загрузка изображения'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="image-labeling-workspace"]',
                            positionTarget: '[data-onboarding-target="image-labeling-dropzone-content"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 16,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            variant: 'image-labeling-wide',
                            title: wt('tours.image_labeling_authoring.upload_step.c0_title', 'Зона загрузки'),
                            body: wt('tours.image_labeling_authoring.upload_step.c0_body', 'Перетащите изображение сюда, вставьте из буфера (Ctrl+V) или кликните, чтобы выбрать файл. Поддерживаются PNG и JPG до 10 МБ.')
                        }
                    ]
                },
                {
                    id: 'image-labeling-canvas-step',
                    targets: [
                        '[data-onboarding-target="image-labeling-viewport"]',
                        '[data-onboarding-target="image-labeling-sidebar"]'
                    ],
                    placement: 'bottom',
                    controlPlacement: 'bottom-right',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="image-labeling-viewport"]',
                    skipAutoScroll: true,
                    kicker: wt('tours.image_labeling_authoring.canvas_step.kicker', 'Рабочая область'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="image-labeling-viewport"]',
                            positionTarget: '[data-onboarding-target="image-labeling-viewport"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 16,
                            gap: 16,
                            keepPlacement: true,
                            skipOverlapPush: true,
                            variant: 'image-labeling-wide',
                            title: wt('tours.image_labeling_authoring.canvas_step.c0_title', 'Холст с изображением'),
                            body: wt('tours.image_labeling_authoring.canvas_step.c0_body', 'После загрузки изображение появляется здесь. Зажмите левую кнопку мыши и потяните, чтобы нарисовать прямоугольную область — она сразу появится на схеме и попадёт в список.')
                        },
                        {
                            target: '[data-onboarding-target="image-labeling-sidebar"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: -160,
                            gap: 28,
                            skipOverlapPush: true,
                            variant: 'click-compact',
                            title: wt('tours.image_labeling_authoring.canvas_step.c1_title', 'Панель настроек'),
                            body: wt('tours.image_labeling_authoring.canvas_step.c1_body', 'Справа — все настройки задания: формулировка, список областей и уровни сложности.')
                        }
                    ]
                },
                {
                    id: 'image-labeling-zones-step',
                    targets: [
                        '[data-onboarding-target="image-labeling-zones-block"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-left',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="image-labeling-zones-block"]',
                    skipAutoScroll: true,
                    kicker: wt('tours.image_labeling_authoring.zones_step.kicker', 'Список областей'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="image-labeling-zones-header"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 4,
                            gap: 30,
                            variant: 'click-compact',
                            title: wt('tours.image_labeling_authoring.zones_step.c0_title', 'Размеченные области'),
                            body: wt('tours.image_labeling_authoring.zones_step.c0_body', 'Каждый нарисованный прямоугольник появляется здесь. Счётчик показывает общее количество областей.')
                        },
                        {
                            target: '[data-onboarding-target="image-labeling-zones-list"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 8,
                            gap: 30,
                            variant: 'click-wide',
                            title: wt('tours.image_labeling_authoring.zones_step.c1_title', 'Подписи и управление'),
                            body: wt('tours.image_labeling_authoring.zones_step.c1_body', 'Для каждой области введите подпись — именно её будет проверять система. Также можно выбрать цвет заливки для области, а ненужную — удалить кнопкой рядом.')
                        }
                    ]
                },
                {
                    id: 'image-labeling-settings-step',
                    targets: [
                        '[data-onboarding-target="image-labeling-prompt"]',
                        '[data-onboarding-target="image-labeling-difficulty"]'
                    ],
                    placement: 'left',
                    controlPlacement: 'bottom-left',
                    controlPlacementLocked: true,
                    readySelector: '[data-onboarding-target="image-labeling-prompt"]',
                    skipAutoScroll: true,
                    kicker: wt('tours.image_labeling_authoring.settings_step.kicker', 'Настройки задания'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="image-labeling-prompt"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 4,
                            gap: 30,
                            variant: 'click-wide',
                            title: wt('tours.image_labeling_authoring.settings_step.c0_title', 'Формулировка'),
                            body: wt('tours.image_labeling_authoring.settings_step.c0_body', 'Напишите, что пользователь должен сделать: например «Подпишите все органы на схеме» или «Найдите и обозначьте элементы конструкции».')
                        },
                        {
                            target: '[data-onboarding-target="image-labeling-difficulty"]',
                            placement: 'left',
                            offsetX: 8,
                            offsetY: 8,
                            gap: 30,
                            variant: 'click-compact',
                            title: wt('tours.image_labeling_authoring.settings_step.c1_title', 'Уровни сложности'),
                            body: wt('tours.image_labeling_authoring.settings_step.c1_body', 'Задание можно включить в один или несколько уровней комплекса. Выберите, при каком уровне оно будет появляться в тренажёре.')
                        }
                    ]
                }
            ]
        },
        {
            tourId: 'editor-dashboard-authoring',
            version: 1,
            referenceCategory: 'create',
            referenceTags: ["редактор","модули","темы","задания"],
            referenceOrder: 90,
            route: ['/editor', '/editor/Main_Dashboard.html'],
            autoStart: true,
            autoStartDelay: 900,
            totalStates: 5,
            persistControl: true,
            title: wt('tours.editor_dashboard_authoring.title', 'Редактор заданий: рабочий центр'),
            summary: wt('tours.editor_dashboard_authoring.summary', 'Как устроены модули, темы, задания, поиск, импорт и создание нового задания.'),
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
                    kicker: wt('tours.editor_dashboard_authoring.editor_dashboard_structure.kicker', 'Структура материалов'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="editor-task-limit-badge"]',
                            placement: 'right',
                            offsetX: 18,
                            offsetY: -50,
                            gap: 24,
                            title: wt('tours.editor_dashboard_authoring.editor_dashboard_structure.c0_title', 'Лимит заданий'),
                            body: wt('tours.editor_dashboard_authoring.editor_dashboard_structure.c0_body', 'Счётчик показывает, сколько личных заданий уже создано. В Premium лимита нет.')
                        },
                        {
                            target: '[data-onboarding-target="editor-active-topic"]',
                            placement: 'right',
                            offsetX: 10,
                            offsetY: -4,
                            gap: 24,
                            title: wt('tours.editor_dashboard_authoring.editor_dashboard_structure.c1_title', 'Текущий раздел'),
                            body: wt('tours.editor_dashboard_authoring.editor_dashboard_structure.c1_body', 'Активная тема подсвечена в дереве. Именно в неё по умолчанию попадёт новое задание.')
                        },
                        {
                            target: '[data-onboarding-target="editor-module-tree"]',
                            placement: 'right',
                            offsetX: 24,
                            offsetY: 66,
                            gap: 24,
                            title: wt('tours.editor_dashboard_authoring.editor_dashboard_structure.c2_title', 'Модули и темы'),
                            body: wt('tours.editor_dashboard_authoring.editor_dashboard_structure.c2_body', 'Задания лежат внутри тем, а темы внутри модулей. Выбор темы меняет список заданий в рабочей области.')
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
                    kicker: wt('tours.editor_dashboard_authoring.editor_dashboard_author_tools.kicker', 'Инструменты автора'),
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
                                    title: wt('tours.editor_dashboard_authoring.editor_dashboard_author_tools.c0_title', 'Новый модуль'),
                                    body: wt('tours.editor_dashboard_authoring.editor_dashboard_author_tools.c0_body', 'Добавляет раздел курса, где затем создаются темы и задания.')
                                },
                                {
                                    title: wt('tours.editor_dashboard_authoring.editor_dashboard_author_tools.c0_title', 'Импорт заданий'),
                                    body: wt('tours.editor_dashboard_authoring.editor_dashboard_author_tools.c0_body', 'Загружает файл, показывает список заданий и добавляет выбранные в библиотеку.')
                                },
                                {
                                    title: wt('tours.editor_dashboard_authoring.editor_dashboard_author_tools.c0_title', 'Анализ теории'),
                                    body: wt('tours.editor_dashboard_authoring.editor_dashboard_author_tools.c0_body', 'Даёт промпт для внешнего ИИ: пользователь открывает ИИ-сервис, вставляет ответ сюда, а редактор строит учебные единицы, карту покрытия и рекомендации.')
                                },
                                {
                                    title: wt('tours.editor_dashboard_authoring.editor_dashboard_author_tools.c0_title', 'Черновики'),
                                    body: wt('tours.editor_dashboard_authoring.editor_dashboard_author_tools.c0_body', 'Показывает автосохранённые черновики заданий: открыть или удалить.')
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
                    kicker: wt('tours.editor_dashboard_authoring.editor_dashboard_search_and_sort.kicker', 'Навигация по заданиям'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="editor-breadcrumbs"]',
                            positionTarget: '[data-onboarding-target="editor-workspace-toolbar"]',
                            placement: 'bottom-start',
                            offsetX: 24,
                            offsetY: 0,
                            gap: 22,
                            variant: 'toolbar-breadcrumbs',
                            title: wt('tours.editor_dashboard_authoring.editor_dashboard_search_and_sort.c0_title', 'Хлебные крошки'),
                            body: wt('tours.editor_dashboard_authoring.editor_dashboard_search_and_sort.c0_body', 'Верхняя строка показывает, какой модуль и тема сейчас открыты, и позволяет быстро вернуться выше.')
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
                            title: wt('tours.editor_dashboard_authoring.editor_dashboard_search_and_sort.c1_title', 'Поиск'),
                            body: wt('tours.editor_dashboard_authoring.editor_dashboard_search_and_sort.c1_body', 'Поиск помогает найти задание, модуль или файл без ручного просмотра всей структуры.')
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
                            title: wt('tours.editor_dashboard_authoring.editor_dashboard_search_and_sort.c2_title', 'Сортировка'),
                            body: wt('tours.editor_dashboard_authoring.editor_dashboard_search_and_sort.c2_body', 'Список можно упорядочить по дате изменения, алфавиту или типу задания.')
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
                    kicker: wt('tours.editor_dashboard_authoring.editor_dashboard_task_grid.kicker', 'Рабочая область'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="editor-existing-task-card"]',
                            targetAll: true,
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 10,
                            gap: 26,
                            title: wt('tours.editor_dashboard_authoring.editor_dashboard_task_grid.c0_title', 'Сохранённые задания'),
                            body: wt('tours.editor_dashboard_authoring.editor_dashboard_task_grid.c0_body', 'Карточки открывают созданные задания для просмотра или редактирования. Звёздочка добавляет задание в избранное.')
                        },
                        {
                            target: '[data-onboarding-target="editor-create-task-card"]',
                            placement: 'bottom',
                            offsetX: 0,
                            offsetY: 10,
                            gap: 26,
                            title: wt('tours.editor_dashboard_authoring.editor_dashboard_task_grid.c1_title', 'Новое задание'),
                            body: wt('tours.editor_dashboard_authoring.editor_dashboard_task_grid.c1_body', 'Эта карточка запускает создание задания в выбранной теме.')
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
                    kicker: wt('tours.editor_dashboard_authoring.editor_dashboard_create_task.kicker', 'Создание задания'),
                    callouts: [
                        {
                            target: '[data-onboarding-target="editor-create-task-context"]',
                            positionTarget: '[data-onboarding-target="editor-create-task-dialog"]',
                            placement: 'right',
                            offsetX: 18,
                            offsetY: -150,
                            gap: 30,
                            variant: 'create-task-context',
                            title: wt('tours.editor_dashboard_authoring.editor_dashboard_create_task.c0_title', 'Контекст задания'),
                            body: wt('tours.editor_dashboard_authoring.editor_dashboard_create_task.c0_body', 'Перед созданием выбираются модуль, тема и понятное название, чтобы задание сразу попало в нужное место.')
                        },
                        {
                            target: '[data-onboarding-target="editor-create-task-type"]',
                            positionTarget: '[data-onboarding-target="editor-create-task-dialog"]',
                            placement: 'right',
                            offsetX: 18,
                            offsetY: 122,
                            gap: 30,
                            variant: 'create-task-type',
                            title: wt('tours.editor_dashboard_authoring.editor_dashboard_create_task.c1_title', 'Тип задания'),
                            body: wt('tours.editor_dashboard_authoring.editor_dashboard_create_task.c1_body', 'Тип определяет, какой рабочий редактор откроется дальше: тест, клик, рисунок, последовательность или открытый ответ.')
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
                            title: wt('tours.editor_dashboard_authoring.editor_dashboard_create_task.c2_title', 'Обучение по типам'),
                            body: wt('tours.editor_dashboard_authoring.editor_dashboard_create_task.c2_body', 'Подробные подсказки для конкретных типов заданий не запускаются принудительно. Их можно открыть из справочника или кнопки помощи внутри выбранного редактора.')
                        }
                    ]
                }
            ]
        }
    ];
})();