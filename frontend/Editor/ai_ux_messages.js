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

    const EN = {
        theory_report: {
            fallback: {
                renderer_error: 'The structural report is currently unavailable. A basic version from the analysis data is shown.',
                missing_blocks: 'Structural report blocks not found. A basic version from the analysis data is shown.',
                lint_recommended: 'The report layout looks unstable. A basic version from the analysis data is shown.',
            },
            bridge: {
                no_ai_run: 'Open an analysis first to pass context to the editor.',
                saved_context: 'Analysis context saved for the editor.',
                saved_block_context: 'Report block context saved for the editor.',
                block_not_found: 'Could not find the selected report block. Try saving the full analysis context.',
            },
        },
        p8: {
            soft: {
                no_links_ok: 'The task has no links to sections or fragments of the current analysis yet — this is fine.',
                saved_weak_grounding: 'The saved link looks weak; if needed, refine the sections and fragments manually.',
                coverage_weak_grounding: 'Coverage for this task indicates a weak link to the material. Check manually.',
                run_mismatch: 'The task is linked to a different analysis; it may be counted separately in current coverage.',
                bridge_refs_available: 'The report context already has ready-made links. They can be applied in one click.',
            },
            coverage: {
                ignored_for_topic: 'Coverage for this analysis is hidden in this topic. This does not affect the editor.',
                ignored_toggle_on: 'Coverage for the selected analysis is hidden in this topic.',
                ignored_toggle_off: 'Coverage for the selected analysis is enabled again in this topic.',
                not_loaded_yet: 'Coverage data will appear after selecting an analysis.',
            },
            trust: {
                normal_label: 'Normal trust',
                low_trust_label: 'Low trust',
                normal_hint: 'Use coverage data and remarks as working hints.',
                low_trust_hint: 'Use this analysis selectively: coverage data and remarks may be especially inaccurate.',
                saved_normal: 'Normal trust level set for the analysis.',
                saved_low_trust: 'Analysis marked as low trust. Hints will be softer.',
            },
            bridge: {
                context_not_found: 'Context from the report not found. You can select an analysis manually.',
                context_loaded: 'Report context loaded into the analysis link panel.',
            },
            analysis: {
                loaded: 'Analysis opened for manual linking.',
                list_load_failed: 'Could not load the analysis list. You can retry later.',
                open_failed: 'Could not open the analysis. You can select another or continue without it.',
            },
            link: {
                apply_success: 'Link to sections and fragments updated. Save the task when ready.',
            },
        },
        ai_common: {
            network_error: 'Could not perform the action due to a network error. Please try again.',
        },
    };

    const UK = {
        theory_report: {
            fallback: {
                renderer_error: 'Структурний звіт зараз недоступний. Показано базову версію з даних аналізу.',
                missing_blocks: 'Структурні блоки звіту не знайдено. Показано базову версію з даних аналізу.',
                lint_recommended: 'Макет звіту виглядає нестабільним. Показано базову версію з даних аналізу.',
            },
            bridge: {
                no_ai_run: 'Спочатку відкрийте аналіз, щоб передати контекст у редактор.',
                saved_context: 'Контекст аналізу збережено для редактора.',
                saved_block_context: 'Контекст блоку звіту збережено для редактора.',
                block_not_found: 'Не вдалося знайти вибраний блок звіту. Спробуйте зберегти контекст аналізу повністю.',
            },
        },
        p8: {
            soft: {
                no_links_ok: 'У задачі поки немає прив\'язки до розділів і фрагментів поточного аналізу — це допустимо.',
                saved_weak_grounding: 'Збережена прив\'язка виглядає слабкою; за потреби уточніть розділи та фрагменти вручну.',
                coverage_weak_grounding: 'Покриття цієї задачі вказує на слабку прив\'язку до матеріалу. Перевірте вручну.',
                run_mismatch: 'Задача пов\'язана з іншим аналізом; у поточному покритті вона може враховуватись окремо.',
                bridge_refs_available: 'У контексті звіту вже є готові прив\'язки. Їх можна застосувати в один клік.',
            },
            coverage: {
                ignored_for_topic: 'Покриття для цього аналізу приховано в цій темі. Це не впливає на роботу редактора.',
                ignored_toggle_on: 'Покриття для вибраного аналізу приховано в цій темі.',
                ignored_toggle_off: 'Покриття для вибраного аналізу знову увімкнено в цій темі.',
                not_loaded_yet: 'Дані про покриття з\'являться після вибору аналізу.',
            },
            trust: {
                normal_label: 'Звичайна довіра',
                low_trust_label: 'Низька довіра',
                normal_hint: 'Використовуйте дані про покриття та зауваження як робочі підказки.',
                low_trust_hint: 'Використовуйте цей аналіз вибірково: дані про покриття та зауваження можуть бути особливо неточними.',
                saved_normal: 'Для аналізу встановлено звичайний рівень довіри.',
                saved_low_trust: 'Аналіз позначено як низька довіра. Підказки будуть м\'якшими.',
            },
            bridge: {
                context_not_found: 'Контекст зі звіту не знайдено. Можна вибрати аналіз вручну.',
                context_loaded: 'Контекст звіту завантажено в панель зв\'язку з аналізом.',
            },
            analysis: {
                loaded: 'Аналіз відкрито для ручного прив\'язування.',
                list_load_failed: 'Не вдалося завантажити список аналізів. Можна повторити пізніше.',
                open_failed: 'Не вдалося відкрити аналіз. Можна вибрати інший або продовжити без нього.',
            },
            link: {
                apply_success: 'Прив\'язку до розділів і фрагментів оновлено. Збережіть задачу, коли будете готові.',
            },
        },
        ai_common: {
            network_error: 'Не вдалося виконати дію через мережеву помилку. Спробуйте ще раз.',
        },
    };

    const api = {
        locale: (typeof window !== 'undefined' && window.i18n && window.i18n.locale) ? window.i18n.locale : 'ru',
        dict: { ru: RU, en: EN, uk: UK },
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
