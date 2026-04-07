(function () {
    const RU = {
        theory_report: {
            fallback: {
                renderer_error: 'Структурный отчёт сейчас недоступен. Показана базовая версия из данных анализа.',
                missing_blocks: 'Структурные блоки отчёта не найдены. Показана базовая версия из данных анализа.',
                lint_recommended: 'Макет отчёта выглядит нестабильным. Показана базовая версия из данных анализа.',
            },
            bridge: {
                no_ai_run: 'Сначала откройте анализ, чтобы передать контекст в редактор.',
                saved_context: 'Контекст анализа сохранён для редактора.',
                saved_block_context: 'Контекст блока отчёта сохранён для редактора.',
                block_not_found: 'Не удалось найти выбранный блок отчёта. Попробуйте сохранить контекст анализа целиком.',
            },
        },
        p8: {
            soft: {
                no_links_ok: 'У задачи пока нет привязки к разделам и фрагментам текущего анализа — это допустимо.',
                saved_weak_grounding: 'Сохранённая привязка выглядит слабой; при необходимости уточните разделы и фрагменты вручную.',
                coverage_weak_grounding: 'Покрытие этой задачи указывает на слабую привязку к материалу. Проверьте вручную.',
                run_mismatch: 'Задача связана с другим анализом; в текущем покрытии она может учитываться отдельно.',
                bridge_refs_available: 'В контексте отчёта уже есть готовые привязки. Их можно применить в один клик.',
            },
            coverage: {
                ignored_for_topic: 'Покрытие для этого анализа скрыто в этой теме. Это не влияет на работу редактора.',
                ignored_toggle_on: 'Покрытие для выбранного анализа скрыто в этой теме.',
                ignored_toggle_off: 'Покрытие для выбранного анализа снова включено в этой теме.',
                not_loaded_yet: 'Данные о покрытии появятся после выбора анализа.',
            },
            trust: {
                normal_label: 'Обычное доверие',
                low_trust_label: 'Низкое доверие',
                normal_hint: 'Используйте данные о покрытии и замечания как рабочие подсказки.',
                low_trust_hint: 'Используйте этот анализ выборочно: данные о покрытии и замечания могут быть особенно неточными.',
                saved_normal: 'Для анализа установлен обычный уровень доверия.',
                saved_low_trust: 'Анализ помечен как низкое доверие. Подсказки будут подаваться мягче.',
            },
            bridge: {
                context_not_found: 'Контекст из отчёта не найден. Можно выбрать анализ вручную.',
                context_loaded: 'Контекст отчёта загружен в панель связи с анализом.',
            },
            analysis: {
                loaded: 'Анализ открыт для ручной привязки.',
                list_load_failed: 'Не удалось загрузить список анализов. Можно повторить позже.',
                open_failed: 'Не удалось открыть анализ. Можно выбрать другой или продолжить без него.',
            },
            link: {
                apply_success: 'Привязка к разделам и фрагментам обновлена. Сохраните задачу, когда будете готовы.',
            },
        },
        ai_common: {
            network_error: 'Не удалось выполнить действие из-за сетевой ошибки. Попробуйте ещё раз.',
        },
    };

    function resolve(obj, path) {
        const parts = String(path || '').split('.');
        let cur = obj;
        for (const part of parts) {
            if (!cur || typeof cur !== 'object' || !(part in cur)) return undefined;
            cur = cur[part];
        }
        return typeof cur === 'string' ? cur : undefined;
    }

    function format(template, params) {
        const data = (params && typeof params === 'object') ? params : {};
        return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
            const value = data[key];
            return value == null ? '' : String(value);
        });
    }

    const api = {
        locale: 'ru',
        dict: { ru: RU },
        t(key, params, fallback) {
            const locale = this.locale && this.dict[this.locale] ? this.locale : 'ru';
            const template = resolve(this.dict[locale], key) || fallback || key;
            return format(template, params);
        },
    };

    if (typeof window !== 'undefined') {
        window.RP_AI_UX = api;
    }
})();
